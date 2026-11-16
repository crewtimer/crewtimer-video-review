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

  /**
   * Returns the timestep to pass to interpolate() so that motion in the
   * result lands at `target` (fraction of the way from frameA to frameB).
   *
   * RIFE v4.6 does not place motion linearly in t: it never gets closer than
   * ~0.05 of a frame to either input frame, and it stalls around t=0.5 (the
   * position races ahead over 0.40-0.46 then barely moves until ~0.56). The
   * correction table was measured with native/rife/calibrate_rife.py and
   * only applies to rife_v4.6.onnx. Targets outside the reachable range
   * (~0.05..0.93) are clamped; use stacked half-frames to get near an
   * input frame.
   */
  static float timestepForTarget(double target);

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
