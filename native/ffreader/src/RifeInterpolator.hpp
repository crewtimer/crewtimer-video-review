#pragma once

#include <opencv2/core.hpp>

#include <memory>
#include <string>

/**
 * Wraps a RIFE v4.x ONNX Runtime session (rife_v4.6.onnx from vs-mlrt).
 * Prefers the CoreML execution provider, falling back to CPU if CoreML is
 * unavailable. One instance should be created per model path and reused
 * across calls so the (CoreML-compiled) session stays warm.
 */
class RifeInterpolator
{
public:
  explicit RifeInterpolator(const std::string &modelPath);
  ~RifeInterpolator();

  RifeInterpolator(const RifeInterpolator &) = delete;
  RifeInterpolator &operator=(const RifeInterpolator &) = delete;

  /**
   * Interpolates a frame at time t between frameA and frameB, restricted to
   * the given crop rect.
   *
   * @param frameA CV_8UC4 RGBA frame (full size).
   * @param frameB CV_8UC4 RGBA frame (full size, same dims as frameA).
   * @param t Fraction in (0, 1) from frameA to frameB.
   * @param crop Region to interpolate, already clamped to frame bounds.
   * @return CV_8UC4 RGBA image sized crop.width x crop.height.
   */
  cv::Mat interpolate(const cv::Mat &frameA, const cv::Mat &frameB, float t,
                      const cv::Rect &crop, int debugLevel = 0) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
