#include "YoloBoxDetector.hpp"
#include "OrtSessionUtils.hpp"

#include <onnxruntime_cxx_api.h>

#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace
{
constexpr int MODEL_SIZE = 640;
constexpr uint8_t PAD_VALUE = 114;

struct Letterbox
{
  cv::Mat image; // MODEL_SIZE x MODEL_SIZE, CV_32FC3, RGB, [0,1]
  float scale;
  int padX;
  int padY;
};

Letterbox letterbox(const cv::Mat &source)
{
  cv::Mat bgr;
  if (source.channels() == 1)
  {
    cv::cvtColor(source, bgr, cv::COLOR_GRAY2BGR);
  }
  else if (source.channels() == 4)
  {
    // Frames from FFReaderAPI are RGBA, not BGRA (see BowCardDetector's
    // historical use of COLOR_RGBA2GRAY for the same buffers).
    cv::cvtColor(source, bgr, cv::COLOR_RGBA2BGR);
  }
  else
  {
    bgr = source;
  }

  const float scale = std::min(static_cast<float>(MODEL_SIZE) / bgr.cols,
                               static_cast<float>(MODEL_SIZE) / bgr.rows);
  const int newW = std::max(1, static_cast<int>(std::round(bgr.cols * scale)));
  const int newH = std::max(1, static_cast<int>(std::round(bgr.rows * scale)));

  cv::Mat resized;
  cv::resize(bgr, resized, cv::Size(newW, newH), 0, 0, cv::INTER_LINEAR);

  const int padX = (MODEL_SIZE - newW) / 2;
  const int padY = (MODEL_SIZE - newH) / 2;
  cv::Mat padded(MODEL_SIZE, MODEL_SIZE, CV_8UC3,
                cv::Scalar(PAD_VALUE, PAD_VALUE, PAD_VALUE));
  resized.copyTo(padded(cv::Rect(padX, padY, newW, newH)));

  cv::Mat rgb;
  cv::cvtColor(padded, rgb, cv::COLOR_BGR2RGB);
  cv::Mat floatImg;
  rgb.convertTo(floatImg, CV_32FC3, 1.0 / 255.0);

  return {floatImg, scale, padX, padY};
}

float iou(const cv::Rect &a, const cv::Rect &b)
{
  const int interArea = (a & b).area();
  if (interArea == 0)
  {
    return 0.0f;
  }
  return static_cast<float>(interArea) /
        static_cast<float>(a.area() + b.area() - interArea);
}

std::vector<DetectedBox> nonMaxSuppress(std::vector<DetectedBox> boxes,
                                        float iouThreshold)
{
  std::sort(boxes.begin(), boxes.end(),
            [](const DetectedBox &a, const DetectedBox &b)
            { return a.confidence > b.confidence; });

  std::vector<DetectedBox> kept;
  std::vector<bool> suppressed(boxes.size(), false);
  for (size_t i = 0; i < boxes.size(); ++i)
  {
    if (suppressed[i])
    {
      continue;
    }
    kept.push_back(boxes[i]);
    for (size_t j = i + 1; j < boxes.size(); ++j)
    {
      if (!suppressed[j] && iou(boxes[i].box, boxes[j].box) > iouThreshold)
      {
        suppressed[j] = true;
      }
    }
  }
  return kept;
}
} // namespace

struct YoloBoxDetector::Impl
{
  Ort::Env env{ORT_LOGGING_LEVEL_WARNING, "yolo"};
  Ort::Session session{nullptr};
  std::string inputName;
  std::string outputName;

  explicit Impl(const std::string &modelPath)
      : session(createOrtSession(env, modelPath, "YoloBoxDetector"))
  {
    Ort::AllocatorWithDefaultOptions allocator;
    inputName = session.GetInputNameAllocated(0, allocator).get();
    outputName = session.GetOutputNameAllocated(0, allocator).get();
  }
};

YoloBoxDetector::YoloBoxDetector(const std::string &modelPath)
    : impl_(std::make_unique<Impl>(modelPath))
{
}

YoloBoxDetector::~YoloBoxDetector() = default;

std::vector<DetectedBox> YoloBoxDetector::detect(const cv::Mat &image,
                                                  float confidenceThreshold,
                                                  float nmsIouThreshold) const
{
  if (image.empty())
  {
    return {};
  }

  const Letterbox lb = letterbox(image);

  // HWC -> CHW
  std::vector<float> inputData(3 * MODEL_SIZE * MODEL_SIZE);
  std::vector<cv::Mat> channels(3);
  for (int c = 0; c < 3; ++c)
  {
    channels[c] = cv::Mat(MODEL_SIZE, MODEL_SIZE, CV_32F,
                          inputData.data() + c * MODEL_SIZE * MODEL_SIZE);
  }
  cv::split(lb.image, channels);

  const std::array<int64_t, 4> inputShape{1, 3, MODEL_SIZE, MODEL_SIZE};
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
  if (shape.size() != 3 || shape[1] != 5)
  {
    throw std::runtime_error("Unexpected YOLO output tensor shape");
  }
  const int64_t numAnchors = shape[2];
  const float *data = outputs[0].GetTensorData<float>();

  std::vector<DetectedBox> candidates;
  candidates.reserve(static_cast<size_t>(numAnchors));
  for (int64_t i = 0; i < numAnchors; ++i)
  {
    const float conf = data[4 * numAnchors + i];
    if (conf < confidenceThreshold)
    {
      continue;
    }
    const float cx = data[0 * numAnchors + i];
    const float cy = data[1 * numAnchors + i];
    const float w = data[2 * numAnchors + i];
    const float h = data[3 * numAnchors + i];

    // Undo letterbox: model-space -> source-image pixel space.
    const float x1 = (cx - w / 2 - lb.padX) / lb.scale;
    const float y1 = (cy - h / 2 - lb.padY) / lb.scale;
    const float x2 = (cx + w / 2 - lb.padX) / lb.scale;
    const float y2 = (cy + h / 2 - lb.padY) / lb.scale;

    cv::Rect box(cv::Point(static_cast<int>(std::round(x1)),
                          static_cast<int>(std::round(y1))),
                cv::Point(static_cast<int>(std::round(x2)),
                          static_cast<int>(std::round(y2))));
    box &= cv::Rect(0, 0, image.cols, image.rows);
    if (box.width <= 0 || box.height <= 0)
    {
      continue;
    }

    candidates.push_back({box, conf});
  }

  return nonMaxSuppress(std::move(candidates), nmsIouThreshold);
}
