#pragma once

#include "BowNumberReader.hpp"
#include "YoloBoxDetector.hpp"

#include <opencv2/core.hpp>

#include <memory>
#include <string>

struct BowNumberDetection
{
  std::string text;
  float confidence = 0.0f;
  cv::Rect cardBox; // full-frame pixel coordinates; empty if nothing found
  cv::Rect boatBox; // full-frame pixel coordinates; empty if nothing found
};

/**
 * Orchestrates the three-stage bow-number pipeline:
 *
 *   1. Boat detector on the full frame -> candidate boat boxes.
 *      Pick the one nearest the caller's point of interest.
 *   2. Card detector on the (padded) boat crop -> the bow-number's box.
 *      Map it back to full-frame coordinates.
 *   3. BowNumberReader on the (padded) card crop -> the full digit string,
 *      via a single CTC forward pass -- not per-character classification
 *      glued together afterward.
 *
 * Replaces BowCardDetector's classical-CV blob detection + per-glyph
 * classify + geometric sequence-stitching approach entirely.
 */
class BowNumberPipeline
{
public:
  BowNumberPipeline(const std::string &boatModelPath,
                    const std::string &cardModelPath,
                    const std::string &numberModelPath);
  ~BowNumberPipeline();

  BowNumberPipeline(const BowNumberPipeline &) = delete;
  BowNumberPipeline &operator=(const BowNumberPipeline &) = delete;

  /**
   * @param frame          Full RGBA (or BGR/gray) video frame.
   * @param pointOfInterest Full-frame pixel coordinates near the bow the
   *                        caller clicked (used only to disambiguate
   *                        between multiple detected boats).
   */
  BowNumberDetection detect(const cv::Mat &frame,
                            const cv::Point &pointOfInterest) const;

private:
  std::unique_ptr<YoloBoxDetector> boatDetector_;
  std::unique_ptr<YoloBoxDetector> cardDetector_;
  std::unique_ptr<BowNumberReader> numberReader_;
};
