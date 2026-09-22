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
 * covering the whole bow card, reads its 1-3 digits and, when the model supports
 * it, an optional A-Z prefix in one forward pass. The output class count selects
 * the numeric (11 classes) or alphanumeric (37 classes) vocabulary. It then
 * decodes with greedy CTC (argmax per timestep,
 * collapse consecutive repeats, drop blank). There is no per-character crop
 * or classification step.
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
