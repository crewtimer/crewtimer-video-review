#include "BowNumberPipeline.hpp"

#include <algorithm>
#include <cmath>

namespace
{
constexpr float BOAT_CONFIDENCE_THRESHOLD = 0.25f;
constexpr float CARD_CONFIDENCE_THRESHOLD = 0.3f;
constexpr double BOAT_PAD_FRACTION = 0.15;
constexpr double CARD_PAD_FRACTION = 0.15;
constexpr int MIN_PAD_PX = 4;

double distanceToBox(const cv::Point &point, const cv::Rect &box)
{
  const double dx = std::max(
      0.0, std::max(static_cast<double>(box.x - point.x),
                    static_cast<double>(point.x - (box.x + box.width))));
  const double dy = std::max(
      0.0, std::max(static_cast<double>(box.y - point.y),
                    static_cast<double>(point.y - (box.y + box.height))));
  return std::sqrt(dx * dx + dy * dy);
}

cv::Rect padAndClamp(const cv::Rect &box, double paddingFraction,
                     const cv::Size &bounds)
{
  const int padX =
      std::max(MIN_PAD_PX, static_cast<int>(std::round(box.width * paddingFraction)));
  const int padY =
      std::max(MIN_PAD_PX, static_cast<int>(std::round(box.height * paddingFraction)));
  const cv::Rect padded(box.x - padX, box.y - padY, box.width + 2 * padX,
                        box.height + 2 * padY);
  return padded & cv::Rect(0, 0, bounds.width, bounds.height);
}
} // namespace

BowNumberPipeline::BowNumberPipeline(const std::string &boatModelPath,
                                     const std::string &cardModelPath,
                                     const std::string &numberModelPath)
    : boatDetector_(std::make_unique<YoloBoxDetector>(boatModelPath)),
      cardDetector_(std::make_unique<YoloBoxDetector>(cardModelPath)),
      numberReader_(std::make_unique<BowNumberReader>(numberModelPath))
{
}

BowNumberPipeline::~BowNumberPipeline() = default;

BowNumberDetection BowNumberPipeline::detect(
    const cv::Mat &frame, const cv::Point &pointOfInterest) const
{
  BowNumberDetection result;
  if (frame.empty())
  {
    return result;
  }
  const cv::Size frameSize(frame.cols, frame.rows);

  // Stage 1: boat detector on the full frame; pick the boat nearest the
  // caller's point of interest (0 distance if the point is inside the box).
  const auto boats = boatDetector_->detect(frame, BOAT_CONFIDENCE_THRESHOLD);
  if (boats.empty())
  {
    return result;
  }
  const auto bestBoat = std::min_element(
      boats.begin(), boats.end(),
      [&pointOfInterest](const DetectedBox &a, const DetectedBox &b)
      {
        return distanceToBox(pointOfInterest, a.box) <
              distanceToBox(pointOfInterest, b.box);
      });
  result.boatBox = bestBoat->box;

  const cv::Rect boatCropRect =
      padAndClamp(bestBoat->box, BOAT_PAD_FRACTION, frameSize);
  if (boatCropRect.width <= 0 || boatCropRect.height <= 0)
  {
    return result;
  }
  const cv::Mat boatCrop = frame(boatCropRect);

  // Stage 2: card detector within the boat crop; take the most confident
  // card (a boat crop should contain at most one bow card).
  const auto cards = cardDetector_->detect(boatCrop, CARD_CONFIDENCE_THRESHOLD);
  if (cards.empty())
  {
    return result;
  }
  const auto bestCard = std::max_element(
      cards.begin(), cards.end(),
      [](const DetectedBox &a, const DetectedBox &b)
      { return a.confidence < b.confidence; });

  // Map the card box from boat-crop-local coordinates back to full-frame
  // coordinates.
  const cv::Rect cardBoxFullFrame(bestCard->box.x + boatCropRect.x,
                                  bestCard->box.y + boatCropRect.y,
                                  bestCard->box.width, bestCard->box.height);
  result.cardBox = cardBoxFullFrame;

  // Stage 3: crop the card region directly from the full-resolution frame
  // (not the boat crop) and read the whole number in one CTC forward pass.
  const cv::Rect cardCropRect =
      padAndClamp(cardBoxFullFrame, CARD_PAD_FRACTION, frameSize);
  if (cardCropRect.width <= 0 || cardCropRect.height <= 0)
  {
    return result;
  }
  const cv::Mat cardCrop = frame(cardCropRect);

  const BowNumberPrediction prediction = numberReader_->read(cardCrop);
  result.text = prediction.text;
  result.confidence = prediction.confidence;
  return result;
}
