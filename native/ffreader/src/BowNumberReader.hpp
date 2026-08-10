#pragma once

#include <opencv2/core.hpp>

#include <memory>
#include <string>

struct BowNumberPrediction
{
  std::string text;
  float confidence = 0.0f;
};

/**
 * Wraps the CTC CRNN bow-number reader (bow_crnn.onnx). Given a single crop
 * covering the whole bow card (however many digits), reads the full number
 * in one forward pass and decodes it with greedy CTC (argmax per timestep,
 * collapse consecutive repeats, drop blank) -- there is no per-character
 * cropping or classification involved.
 */
class BowNumberReader
{
public:
  explicit BowNumberReader(const std::string &modelPath);
  ~BowNumberReader();

  BowNumberReader(const BowNumberReader &) = delete;
  BowNumberReader &operator=(const BowNumberReader &) = delete;

  /**
   * @param cardCrop BGR, BGRA, or grayscale crop of just the bow-card
   *                 region (plus some padding), NOT yet preprocessed.
   */
  BowNumberPrediction read(const cv::Mat &cardCrop) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
