#include "RifeInterpolator.hpp"

#include <coreml_provider_factory.h>
#include <onnxruntime_cxx_api.h>

#include <opencv2/imgproc.hpp>

#include <array>
#include <chrono>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace
{
constexpr int PAD_MULTIPLE = 32; // RIFE v4 pyramid needs dims divisible by 32

int padAmount(int dim)
{
  int rem = dim % PAD_MULTIPLE;
  return rem == 0 ? 0 : PAD_MULTIPLE - rem;
}
} // namespace

struct RifeInterpolator::Impl
{
  Ort::Env env{ORT_LOGGING_LEVEL_WARNING, "rife"};
  Ort::Session session{nullptr};
  std::string inputName;
  std::string outputName;

  explicit Impl(const std::string &modelPath)
  {
    Ort::SessionOptions options;
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

    bool coreMlRequested = false;
    try
    {
      // CPU_AND_GPU (rather than ANE-only) since RIFE's grid-sample warp
      // isn't ANE-friendly; letting CoreML pick CPU/GPU per-op gets most of
      // the graph accelerated while still falling back per-node as needed.
      uint32_t coremlFlags = COREML_FLAG_USE_CPU_AND_GPU;
      Ort::ThrowOnError(OrtSessionOptionsAppendExecutionProvider_CoreML(
          options, coremlFlags));
      coreMlRequested = true;
    }
    catch (const Ort::Exception &e)
    {
      std::cerr << "RifeInterpolator: CoreML EP unavailable (" << e.what()
                << "), using CPU" << std::endl;
    }

    session = Ort::Session(env, modelPath.c_str(), options);

    Ort::AllocatorWithDefaultOptions allocator;
    auto inName = session.GetInputNameAllocated(0, allocator);
    auto outName = session.GetOutputNameAllocated(0, allocator);
    inputName = inName.get();
    outputName = outName.get();

    std::cerr << "RifeInterpolator: session ready for " << modelPath
              << " (CoreML " << (coreMlRequested ? "requested" : "unavailable")
              << "), input=" << inputName << " output=" << outputName
              << std::endl;
  }
};

RifeInterpolator::RifeInterpolator(const std::string &modelPath)
    : impl_(std::make_unique<Impl>(modelPath))
{
}

RifeInterpolator::~RifeInterpolator() = default;

cv::Mat RifeInterpolator::interpolate(const cv::Mat &frameA,
                                      const cv::Mat &frameB, float t,
                                      const cv::Rect &crop) const
{
  if (frameA.type() != CV_8UC4 || frameB.type() != CV_8UC4)
  {
    throw std::runtime_error("RifeInterpolator::interpolate requires CV_8UC4 RGBA frames");
  }

  using Clock = std::chrono::steady_clock;
  auto toMs = [](Clock::time_point a, Clock::time_point b)
  {
    return std::chrono::duration<double, std::milli>(b - a).count();
  };
  const auto tStart = Clock::now();

  cv::Mat rgbA, rgbB;
  cv::cvtColor(frameA(crop), rgbA, cv::COLOR_RGBA2RGB);
  cv::cvtColor(frameB(crop), rgbB, cv::COLOR_RGBA2RGB);
  rgbA.convertTo(rgbA, CV_32FC3, 1.0 / 255.0);
  rgbB.convertTo(rgbB, CV_32FC3, 1.0 / 255.0);

  const int h = rgbA.rows;
  const int w = rgbA.cols;
  const int padBottom = padAmount(h);
  const int padRight = padAmount(w);

  cv::Mat padA = rgbA;
  cv::Mat padB = rgbB;
  if (padBottom || padRight)
  {
    cv::copyMakeBorder(rgbA, padA, 0, padBottom, 0, padRight, cv::BORDER_REFLECT);
    cv::copyMakeBorder(rgbB, padB, 0, padBottom, 0, padRight, cv::BORDER_REFLECT);
  }
  const int ph = padA.rows;
  const int pw = padA.cols;
  const size_t planeSize = static_cast<size_t>(ph) * pw;

  std::vector<float> input(11 * planeSize);

  std::vector<cv::Mat> channelsA(3);
  std::vector<cv::Mat> channelsB(3);
  cv::split(padA, channelsA);
  cv::split(padB, channelsB);
  for (int c = 0; c < 3; c++)
  {
    cv::Mat contA = channelsA[c].isContinuous() ? channelsA[c] : channelsA[c].clone();
    cv::Mat contB = channelsB[c].isContinuous() ? channelsB[c] : channelsB[c].clone();
    std::memcpy(input.data() + c * planeSize, contA.ptr<float>(), planeSize * sizeof(float));
    std::memcpy(input.data() + (3 + c) * planeSize, contB.ptr<float>(), planeSize * sizeof(float));
  }

  std::fill(input.begin() + 6 * planeSize, input.begin() + 7 * planeSize, t);

  float *xgrid = input.data() + 7 * planeSize;
  float *ygrid = input.data() + 8 * planeSize;
  float *wconst = input.data() + 9 * planeSize;
  float *hconst = input.data() + 10 * planeSize;
  const float xstep = pw > 1 ? 2.0f / (pw - 1) : 0.0f;
  const float ystep = ph > 1 ? 2.0f / (ph - 1) : 0.0f;
  for (int y = 0; y < ph; y++)
  {
    const float yv = -1.0f + y * ystep;
    for (int x = 0; x < pw; x++)
    {
      xgrid[y * pw + x] = -1.0f + x * xstep;
      ygrid[y * pw + x] = yv;
    }
  }
  std::fill(wconst, wconst + planeSize, xstep);
  std::fill(hconst, hconst + planeSize, ystep);

  Ort::MemoryInfo memInfo =
      Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  std::array<int64_t, 4> inputShape{1, 11, ph, pw};
  Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
      memInfo, input.data(), input.size(), inputShape.data(), inputShape.size());

  const auto tPrepDone = Clock::now();

  const char *inputNames[] = {impl_->inputName.c_str()};
  const char *outputNames[] = {impl_->outputName.c_str()};
  auto outputTensors = impl_->session.Run(Ort::RunOptions{nullptr}, inputNames,
                                          &inputTensor, 1, outputNames, 1);

  const auto tRunDone = Clock::now();

  float *outData = outputTensors[0].GetTensorMutableData<float>();
  cv::Mat outR(ph, pw, CV_32FC1, outData + 0 * planeSize);
  cv::Mat outG(ph, pw, CV_32FC1, outData + 1 * planeSize);
  cv::Mat outB(ph, pw, CV_32FC1, outData + 2 * planeSize);
  std::vector<cv::Mat> outChannels{outR, outG, outB};
  cv::Mat merged;
  cv::merge(outChannels, merged);

  cv::Mat cropped = merged(cv::Rect(0, 0, w, h));
  cv::Mat clamped;
  cv::max(cropped, 0.0, clamped);
  cv::min(clamped, 1.0, clamped);

  cv::Mat rgb8;
  clamped.convertTo(rgb8, CV_8UC3, 255.0, 0.5);
  cv::Mat rgba8;
  cv::cvtColor(rgb8, rgba8, cv::COLOR_RGB2RGBA);

  const auto tEnd = Clock::now();
  std::cerr << "RifeInterpolator: t=" << t << " crop=(" << crop.x << ","
            << crop.y << "," << crop.width << "," << crop.height
            << ") padded=" << pw << "x" << ph
            << " prep=" << toMs(tStart, tPrepDone)
            << "ms infer=" << toMs(tPrepDone, tRunDone)
            << "ms post=" << toMs(tRunDone, tEnd)
            << "ms total=" << toMs(tStart, tEnd) << "ms" << std::endl;

  return rgba8;
}
