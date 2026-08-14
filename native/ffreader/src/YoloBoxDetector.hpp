#pragma once

#include <opencv2/core.hpp>

#include <memory>
#include <string>
#include <vector>

struct DetectedBox
{
  cv::Rect box; // pixel coordinates within the image passed to detect()
  float confidence = 0.0f;
};

/**
 * Wraps a single-class YOLOv8-style ONNX export: input "images"
 * (1,3,640,640), letterboxed; output "output0" (1,C,anchors), where the
 * first five channels are [cx,cy,w,h,conf]. Any later pose-keypoint channels
 * are ignored. Coordinates are already decoded to model-input pixel space
 * by the exported graph. Shared by the boat detector
 * (crewtimer-boat-train.onnx) and the card detector (bow_card_detect.onnx)
 * -- same export shape, different weights.
 */
class YoloBoxDetector
{
public:
  explicit YoloBoxDetector(const std::string &modelPath);
  ~YoloBoxDetector();

  YoloBoxDetector(const YoloBoxDetector &) = delete;
  YoloBoxDetector &operator=(const YoloBoxDetector &) = delete;

  /**
   * Detects boxes in `image` (BGR or grayscale), returned in `image`'s
   * pixel coordinates, sorted by descending confidence after confidence
   * thresholding and NMS.
   */
  std::vector<DetectedBox> detect(const cv::Mat &image,
                                  float confidenceThreshold = 0.3f,
                                  float nmsIouThreshold = 0.45f) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
