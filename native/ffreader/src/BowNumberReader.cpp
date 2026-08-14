#include "BowNumberReader.hpp"
#include "OrtSessionUtils.hpp"

#include <onnxruntime_cxx_api.h>

#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <array>
#include <cmath>

namespace
{
// Must match CHARSET in train_bow_crnn.py: index 0 = CTC blank.
constexpr const char *CHARSET = "-0123456789";
constexpr int BLANK_IDX = 0;
constexpr int OUTPUT_HEIGHT = 48;
constexpr int OUTPUT_WIDTH = 60;

// Preprocess a raw card crop into the binary, polarity-normalised,
// fixed 48x60 image the CTC model was trained on.
// Mirrors extract_card_training_crops.py's normalize_card() exactly.
cv::Mat preprocessCardCrop(const cv::Mat &cardCrop)
{
  cv::Mat gray;
  if (cardCrop.channels() == 1)
  {
    gray = cardCrop;
  }
  else if (cardCrop.channels() == 4)
  {
    // Frames from FFReaderAPI are RGBA, not BGRA.
    cv::cvtColor(cardCrop, gray, cv::COLOR_RGBA2GRAY);
  }
  else
  {
    cv::cvtColor(cardCrop, gray, cv::COLOR_BGR2GRAY);
  }

  cv::Mat upscaled;
  cv::resize(gray, upscaled, cv::Size(), 10, 10, cv::INTER_LANCZOS4);

  cv::Mat blurred;
  cv::GaussianBlur(upscaled, blurred, cv::Size(), 1.0);

  cv::Mat sharpened;
  cv::addWeighted(upscaled, 2.5, blurred, -1.5, 0.0, sharpened);

  cv::Mat thresholded;
  cv::threshold(sharpened, thresholded, 0, 255,
                cv::THRESH_BINARY | cv::THRESH_OTSU);

  const cv::Rect cardCenter(
      static_cast<int>(std::round(thresholded.cols * 0.2)),
      static_cast<int>(std::round(thresholded.rows * 0.2)),
      static_cast<int>(std::round(thresholded.cols * 0.6)),
      static_cast<int>(std::round(thresholded.rows * 0.6)));
  cv::Mat normalized;
  if (cv::mean(thresholded(cardCenter))[0] > 128.0)
  {
    normalized = thresholded;
  }
  else
  {
    cv::bitwise_not(thresholded, normalized);
  }

  const int border =
      std::max(10, static_cast<int>(std::round(
                       std::min(normalized.rows, normalized.cols) * 0.05)));
  cv::copyMakeBorder(normalized, normalized, border, border, border, border,
                     cv::BORDER_CONSTANT, cv::Scalar(255));

  cv::Mat resized;
  cv::resize(normalized, resized, cv::Size(OUTPUT_WIDTH, OUTPUT_HEIGHT), 0, 0,
            cv::INTER_AREA);
  return resized;
}

// Greedy CTC decode: argmax per timestep, collapse consecutive repeats,
// drop blank. Confidence is the mean softmax probability of each emitted
// (non-blank, non-repeat) character.
BowNumberPrediction ctcGreedyDecode(const float *logits, int64_t seqLen,
                                    int64_t numClasses)
{
  BowNumberPrediction result;
  int previous = -1;
  double confidenceSum = 0.0;
  int emitted = 0;

  std::vector<float> probs(static_cast<size_t>(numClasses));
  for (int64_t t = 0; t < seqLen; ++t)
  {
    const float *row = logits + t * numClasses;
    const int best = static_cast<int>(
        std::max_element(row, row + numClasses) - row);

    if (best != previous && best != BLANK_IDX)
    {
      const float maxLogit = row[best];
      double denominator = 0.0;
      for (int64_t c = 0; c < numClasses; ++c)
      {
        denominator += std::exp(row[c] - maxLogit);
      }
      const double probability = 1.0 / denominator;

      result.text.push_back(CHARSET[best]);
      confidenceSum += probability;
      ++emitted;
    }
    previous = best;
  }

  result.confidence =
      emitted > 0 ? static_cast<float>(confidenceSum / emitted) : 0.0f;
  return result;
}
} // namespace

struct BowNumberReader::Impl
{
  Ort::Env env{ORT_LOGGING_LEVEL_WARNING, "bow_number_reader"};
  Ort::Session session{nullptr};
  std::string inputName;
  std::string outputName;

  explicit Impl(const std::string &modelPath)
      : session(createOrtSession(env, modelPath, "BowNumberReader"))
  {
    Ort::AllocatorWithDefaultOptions allocator;
    inputName = session.GetInputNameAllocated(0, allocator).get();
    outputName = session.GetOutputNameAllocated(0, allocator).get();
  }
};

BowNumberReader::BowNumberReader(const std::string &modelPath)
    : impl_(std::make_unique<Impl>(modelPath))
{
}

BowNumberReader::~BowNumberReader() = default;

BowNumberPrediction BowNumberReader::read(const cv::Mat &cardCrop) const
{
  if (cardCrop.empty())
  {
    return {};
  }

  const cv::Mat preprocessed = preprocessCardCrop(cardCrop);

  std::vector<float> inputData(
      static_cast<size_t>(preprocessed.rows) * preprocessed.cols);
  for (int y = 0; y < preprocessed.rows; ++y)
  {
    const uint8_t *row = preprocessed.ptr<uint8_t>(y);
    for (int x = 0; x < preprocessed.cols; ++x)
    {
      inputData[static_cast<size_t>(y) * preprocessed.cols + x] =
          row[x] / 255.0f;
    }
  }

  const std::array<int64_t, 4> inputShape{1, 1, preprocessed.rows,
                                          preprocessed.cols};
  Ort::MemoryInfo memInfo =
      Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
      memInfo, inputData.data(), inputData.size(), inputShape.data(),
      inputShape.size());

  auto &net = const_cast<Ort::Session &>(impl_->session);
  const char *inputNames[] = {impl_->inputName.c_str()};
  const char *outputNames[] = {impl_->outputName.c_str()};
  auto outputs = net.Run(Ort::RunOptions{nullptr}, inputNames, &inputTensor, 1,
                         outputNames, 1);

  const auto shape = outputs[0].GetTensorTypeAndShapeInfo().GetShape();
  if (shape.size() != 3 || shape[1] != 1)
  {
    throw std::runtime_error("Unexpected bow number reader output shape");
  }
  const int64_t seqLen = shape[0];
  const int64_t numClasses = shape[2];
  const float *logits = outputs[0].GetTensorData<float>();

  return ctcGreedyDecode(logits, seqLen, numClasses);
}
