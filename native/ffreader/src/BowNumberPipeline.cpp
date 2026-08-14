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
    const cv::Mat &frame, const cv::Point &pointOfInterest,
    bool detectCardsWithoutBoat) const
{
  const auto detections = detectAll(frame, detectCardsWithoutBoat);
  if (detections.empty())
  {
    return {};
  }
  return *std::min_element(
      detections.begin(), detections.end(),
      [&pointOfInterest](const BowNumberDetection &a,
                         const BowNumberDetection &b)
      {
        const cv::Rect &aBox = a.boatBox.area() > 0 ? a.boatBox : a.cardBox;
        const cv::Rect &bBox = b.boatBox.area() > 0 ? b.boatBox : b.cardBox;
        return distanceToBox(pointOfInterest, aBox) <
              distanceToBox(pointOfInterest, bBox);
      });
}

std::vector<BowNumberDetection> BowNumberPipeline::detectAll(
    const cv::Mat &frame, bool detectCardsWithoutBoat) const
{
  std::vector<BowNumberDetection> results;
  if (frame.empty())
  {
    return results;
  }
  const cv::Size frameSize(frame.cols, frame.rows);
  const auto boats = boatDetector_->detect(frame, BOAT_CONFIDENCE_THRESHOLD);
  if (boats.empty() && detectCardsWithoutBoat)
  {
    const auto cards = cardDetector_->detect(frame, CARD_CONFIDENCE_THRESHOLD);
    results.reserve(cards.size());
    for (const auto &card : cards)
    {
      BowNumberDetection result;
      result.cardBox = card.box;
      const cv::Rect cardCropRect =
          padAndClamp(card.box, CARD_PAD_FRACTION, frameSize);
      if (cardCropRect.width > 0 && cardCropRect.height > 0)
      {
        const BowNumberPrediction prediction =
            numberReader_->read(frame(cardCropRect));
        result.text = prediction.text;
        result.confidence = prediction.confidence;
      }
      results.push_back(result);
    }
    return results;
  }
  results.reserve(boats.size());

  for (const auto &boat : boats)
  {
    BowNumberDetection result;
    result.boatBox = boat.box;

    const cv::Rect boatCropRect =
        padAndClamp(boat.box, BOAT_PAD_FRACTION, frameSize);
    if (boatCropRect.width <= 0 || boatCropRect.height <= 0)
    {
      results.push_back(result);
      continue;
    }
    const cv::Mat boatCrop = frame(boatCropRect);

    // Stage 2: card detector within the boat crop; take the most confident
    // card (a boat crop should contain at most one bow card).
    const auto cards =
        cardDetector_->detect(boatCrop, CARD_CONFIDENCE_THRESHOLD);
    if (cards.empty())
    {
      results.push_back(result);
      continue;
    }
    const auto bestCard = std::max_element(
        cards.begin(), cards.end(),
        [](const DetectedBox &a, const DetectedBox &b)
        { return a.confidence < b.confidence; });

    // Map the card box from boat-crop-local coordinates back to full-frame.
    const cv::Rect cardBoxFullFrame(bestCard->box.x + boatCropRect.x,
                                    bestCard->box.y + boatCropRect.y,
                                    bestCard->box.width,
                                    bestCard->box.height);
    result.cardBox = cardBoxFullFrame;

    // Stage 3: read the card from the full-resolution frame.
    const cv::Rect cardCropRect =
        padAndClamp(cardBoxFullFrame, CARD_PAD_FRACTION, frameSize);
    if (cardCropRect.width <= 0 || cardCropRect.height <= 0)
    {
      results.push_back(result);
      continue;
    }
    const cv::Mat cardCrop = frame(cardCropRect);

    const BowNumberPrediction prediction = numberReader_->read(cardCrop);
    result.text = prediction.text;
    result.confidence = prediction.confidence;
    results.push_back(result);
  }
  return results;
}
