#pragma once

#include "BowNumberReader.hpp"
#include "YoloBoxDetector.hpp"

#include <opencv2/core.hpp>

#include <memory>
#include <string>
#include <vector>

struct BowNumberDetection
{
  std::string text;
  float confidence = 0.0f;
  // Full-frame pixel coordinates; empty when no accepted card is found.
  cv::Rect cardBox;
  cv::Rect boatBox; // full-frame pixel coordinates; empty if nothing found
};

/**
 * Orchestrates the bow-number detection pipeline:
 *
 *   1. Boat detector on the full frame -> candidate boat boxes.
 *   2. Card detector on the (padded) boat crop -> the bow-number's box.
 *      Map it back to full-frame coordinates.
 *   3. If cards are found, select the most confident card and run
 *      BowNumberReader on its padded crop.
 *   4. If no card is found at 0.30 confidence, retry at 0.02, select the most
 *      confident candidate, and OCR its padded crop. Accept this fallback card
 *      and OCR result only at OCR confidence 0.80 or above.
 *
 * If no boats are found and detectCardsWithoutBoat is true, detect cards over
 * the full frame and OCR each padded card crop.
 * detectAll returns every result; detect selects the result nearest the caller's
 * point of interest after running the same sequence.
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
                            const cv::Point &pointOfInterest,
                            bool detectCardsWithoutBoat = false) const;

  /** Detect and read the bow number for every boat found in the frame. */
  std::vector<BowNumberDetection>
  detectAll(const cv::Mat &frame, bool detectCardsWithoutBoat = false) const;

private:
  std::unique_ptr<YoloBoxDetector> boatDetector_;
  std::unique_ptr<YoloBoxDetector> cardDetector_;
  std::unique_ptr<BowNumberReader> numberReader_;
};
