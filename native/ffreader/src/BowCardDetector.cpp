#include "BowCardDetector.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <numeric>
#include <stdexcept>

#include <opencv2/imgproc.hpp>

BowCardDetector::BowCardDetector(const std::string &modelPath)
    : net_(cv::dnn::readNetFromONNX(modelPath))
{
  if (net_.empty())
  {
    throw std::runtime_error("Unable to load bow detection model: " + modelPath);
  }
}

BowCardDetection BowCardDetector::detect(const cv::Mat &rgbaFrame,
                                         const cv::Rect &requestedRegion,
                                         int focusX) const
{
  if (rgbaFrame.empty())
  {
    throw std::invalid_argument("Cannot detect a bow card in an empty frame");
  }

  const cv::Rect frameBounds(0, 0, rgbaFrame.cols, rgbaFrame.rows);
  cv::Rect region = requestedRegion & frameBounds;
  if (region.width <= 0 || region.height <= 0)
  {
    throw std::invalid_argument("Bow detection region is outside the frame");
  }

  cv::Mat gray;
  const cv::Mat source = rgbaFrame(region);
  if (source.channels() == 1)
  {
    gray = source;
  }
  else if (source.channels() == 4)
  {
    cv::cvtColor(source, gray, cv::COLOR_RGBA2GRAY);
  }
  else
  {
    cv::cvtColor(source, gray, cv::COLOR_BGR2GRAY);
  }

  cv::Mat thresholded = preprocess(gray);
  const auto blobs = findBlobs(thresholded, gray.cols);
  if (blobs.empty())
  {
    return {};
  }

  const auto groups = groupBlobs(blobs);
  BowCardDetection result;
  std::vector<BowCharacterDetection> candidates;
  constexpr int cropPadding = 20;

  for (const auto &group : groups)
  {
    cv::Rect scaledGroup = group.front().scaledRect;
    for (const auto &blob : group)
    {
      scaledGroup |= blob.scaledRect;
    }

    const auto mainBlob = std::max_element(
        group.begin(), group.end(),
        [](const Blob &a, const Blob &b) { return a.area < b.area; });

    cv::Rect cropRect(mainBlob->scaledRect.x - cropPadding,
                      mainBlob->scaledRect.y - cropPadding,
                      mainBlob->scaledRect.width + cropPadding * 2,
                      mainBlob->scaledRect.height + cropPadding * 2);
    cropRect &= cv::Rect(0, 0, thresholded.cols, thresholded.rows);
    if (cropRect.empty())
    {
      continue;
    }

    cv::Mat crop = thresholded(cropRect);
    cv::Mat normalized;
    if (cv::mean(crop)[0] > 128.0)
    {
      normalized = crop.clone();
    }
    else
    {
      cv::bitwise_not(crop, normalized);
    }
    cv::copyMakeBorder(normalized, normalized, cropPadding, cropPadding,
                       cropPadding, cropPadding, cv::BORDER_CONSTANT,
                       cv::Scalar(255));

    CharacterPrediction prediction = predict(normalized);
    cv::Rect originalBox(
        region.x + scaledGroup.x / SCALE,
        region.y + scaledGroup.y / SCALE,
        std::max(1, scaledGroup.width / SCALE),
        std::max(1, scaledGroup.height / SCALE));

    constexpr int minimumGlyphBoxArea = 0;
    if (prediction.character != '\0' &&
        std::isdigit(static_cast<unsigned char>(prediction.character)) &&
        originalBox.area() >= minimumGlyphBoxArea)
    {
      candidates.push_back(
          {prediction.character, prediction.confidence, originalBox});
    }
  }

  if (candidates.empty())
  {
    return result;
  }

  if (focusX >= 0)
  {
    const int focusRadius = std::max(100, region.height * 4);
    candidates.erase(
        std::remove_if(
            candidates.begin(), candidates.end(),
            [focusX, focusRadius](const BowCharacterDetection &candidate)
            {
              const int centerX =
                  candidate.box.x + candidate.box.width / 2;
              return std::abs(centerX - focusX) > focusRadius;
            }),
        candidates.end());
    if (candidates.empty())
    {
      return result;
    }
  }

  // A bow number is a compact horizontal sequence. Do not concatenate every
  // character-like texture in a full-width water strip. Multi-character
  // results require individually credible, aligned, neighboring characters.
  constexpr float sequenceConfidence = 0.65f;
  constexpr size_t maxSequenceLength = 3;
  size_t bestStart = 0;
  size_t bestLength = 0;
  float bestSequenceScore = 0.0f;

  const auto sequenceCompatible =
      [](const BowCharacterDetection &left,
         const BowCharacterDetection &right)
  {
    const int maxHeight = std::max(left.box.height, right.box.height);
    const int minHeight = std::min(left.box.height, right.box.height);
    const int gap = right.box.x - (left.box.x + left.box.width);
    const int leftCenter = left.box.y + left.box.height / 2;
    const int rightCenter = right.box.y + right.box.height / 2;
    return gap >= -2 && gap <= std::max(3, maxHeight / 2) &&
           std::abs(leftCenter - rightCenter) <= maxHeight / 2 &&
           minHeight * 10 >= maxHeight * 7;
  };

  for (size_t start = 0; start < candidates.size(); ++start)
  {
    if (candidates[start].confidence < sequenceConfidence)
    {
      continue;
    }
    float confidenceSum = candidates[start].confidence;
    size_t length = 1;
    while (start + length < candidates.size() &&
           length < maxSequenceLength &&
           candidates[start + length].confidence >= sequenceConfidence &&
           sequenceCompatible(candidates[start + length - 1],
                              candidates[start + length]))
    {
      confidenceSum += candidates[start + length].confidence;
      ++length;
    }
    float score =
        static_cast<float>(length) + confidenceSum / length;
    if (focusX >= 0)
    {
      const cv::Rect sequenceBox =
          candidates[start].box |
          candidates[start + length - 1].box;
      const int centerX = sequenceBox.x + sequenceBox.width / 2;
      score -= static_cast<float>(std::abs(centerX - focusX)) /
               std::max(1, region.width);
    }
    if (length >= 2 && score > bestSequenceScore)
    {
      bestStart = start;
      bestLength = length;
      bestSequenceScore = score;
    }
  }

  if (bestLength >= 2)
  {
    result.characters.assign(candidates.begin() + bestStart,
                             candidates.begin() + bestStart + bestLength);
  }
  else
  {
    const auto selected =
        focusX >= 0
            ? std::min_element(
                  candidates.begin(), candidates.end(),
                  [focusX](const BowCharacterDetection &a,
                           const BowCharacterDetection &b)
                  {
                    const int aCenter = a.box.x + a.box.width / 2;
                    const int bCenter = b.box.x + b.box.width / 2;
                    return std::abs(aCenter - focusX) <
                           std::abs(bCenter - focusX);
                  })
            : std::max_element(
                  candidates.begin(), candidates.end(),
                  [](const BowCharacterDetection &a,
                     const BowCharacterDetection &b)
                  { return a.box.area() < b.box.area(); });
    result.characters.push_back(*selected);
  }

  float confidenceSum = 0.0f;
  result.box = result.characters.front().box;
  for (const auto &character : result.characters)
  {
    result.text.push_back(character.character);
    result.box |= character.box;
    confidenceSum += character.confidence;
  }
  result.confidence =
      confidenceSum / static_cast<float>(result.characters.size());
  return result;
}

cv::Mat BowCardDetector::preprocess(const cv::Mat &gray) const
{
  cv::Mat upscaled;
  cv::resize(gray, upscaled, cv::Size(), SCALE, SCALE, cv::INTER_LANCZOS4);

  cv::Mat blurred;
  cv::GaussianBlur(upscaled, blurred, cv::Size(), 1.0);

  cv::Mat sharpened;
  cv::addWeighted(upscaled, 2.5, blurred, -1.5, 0.0, sharpened);
  sharpened.convertTo(sharpened, CV_8U);

  cv::Mat thresholded;
  cv::threshold(sharpened, thresholded, 140, 255, cv::THRESH_BINARY);
  return thresholded;
}

std::vector<BowCardDetector::Blob>
BowCardDetector::findBlobs(const cv::Mat &thresholded, int sourceWidth) const
{
  cv::Mat labels;
  cv::Mat stats;
  cv::Mat centroids;
  const int count = cv::connectedComponentsWithStats(
      thresholded, labels, stats, centroids, 8);
  const float maxCharacterWidth =
      std::min(sourceWidth * SCALE * 0.5f, static_cast<float>(SCALE * 30));
  const int maxCharacterHeight =
      static_cast<int>(thresholded.rows * 0.9f);

  std::vector<Blob> blobs;
  for (int index = 1; index < count; ++index)
  {
    const int x = stats.at<int>(index, cv::CC_STAT_LEFT);
    const int y = stats.at<int>(index, cv::CC_STAT_TOP);
    const int width = stats.at<int>(index, cv::CC_STAT_WIDTH);
    const int height = stats.at<int>(index, cv::CC_STAT_HEIGHT);
    const int area = stats.at<int>(index, cv::CC_STAT_AREA);
    const float aspect = static_cast<float>(width) / (height + 1e-5f);

    if (area >= MIN_BLOB_AREA && width < maxCharacterWidth &&
        width >= SCALE * 3 && height >= SCALE * 4 &&
        height < maxCharacterHeight &&
        // Bow-card glyphs are tall or roughly square. Wide water ripples were
        // the dominant false positive in full-width horizontal strips.
        aspect > 0.15f && aspect < 1.25f)
    {
      blobs.push_back({cv::Rect(x, y, width, height), area});
    }
  }

  std::sort(blobs.begin(), blobs.end(),
            [](const Blob &a, const Blob &b)
            { return a.scaledRect.x < b.scaledRect.x; });
  return blobs;
}

std::vector<std::vector<BowCardDetector::Blob>>
BowCardDetector::groupBlobs(const std::vector<Blob> &blobs) const
{
  std::vector<std::vector<Blob>> groups;
  if (blobs.empty())
  {
    return groups;
  }

  groups.push_back({blobs.front()});
  for (size_t index = 1; index < blobs.size(); ++index)
  {
    int previousRight = 0;
    for (const auto &blob : groups.back())
    {
      previousRight =
          std::max(previousRight, blob.scaledRect.x + blob.scaledRect.width);
    }
    if (blobs[index].scaledRect.x - previousRight <= SCALE)
    {
      groups.back().push_back(blobs[index]);
    }
    else
    {
      groups.push_back({blobs[index]});
    }
  }
  return groups;
}

BowCardDetector::CharacterPrediction
BowCardDetector::predict(const cv::Mat &characterCrop) const
{
  cv::Mat resized;
  cv::resize(characterCrop, resized, cv::Size(INPUT_WIDTH, INPUT_HEIGHT),
             0, 0, cv::INTER_LINEAR);

  cv::Mat blob = cv::dnn::blobFromImage(
      resized, 1.0 / 255.0, cv::Size(INPUT_WIDTH, INPUT_HEIGHT),
      cv::Scalar(), false, false, CV_32F);

  // Net::setInput/forward mutate internal execution state. The addon invokes
  // this synchronously today, so a cached detector is safe on the main thread.
  auto &net = const_cast<cv::dnn::Net &>(net_);
  net.setInput(blob, "input");
  cv::Mat output = net.forward("output");

  const cv::MatShape shape = output.shape();
  if (shape.size() != 3 || shape[1] != 1 ||
      (shape[2] != 11 && shape[2] != 37))
  {
    throw std::runtime_error("Unexpected bow CRNN output tensor shape");
  }

  const int sequenceLength = static_cast<int>(shape[0]);
  const int classCount = static_cast<int>(shape[2]);
  const float *logits = output.ptr<float>();
  std::vector<float> pooled(classCount, 0.0f);
  for (int time = 0; time < sequenceLength; ++time)
  {
    for (int cls = 0; cls < classCount; ++cls)
    {
      pooled[cls] += logits[time * classCount + cls];
    }
  }
  for (float &value : pooled)
  {
    value /= static_cast<float>(sequenceLength);
  }

  // Accept the previous 37-class model during migration, but only consider
  // its digit classes. Newly trained numeric-only models have 11 classes.
  const int firstDigitClass = classCount == 11 ? 1 : 27;
  const auto best =
      std::max_element(pooled.begin() + firstDigitClass, pooled.end());
  const int bestClass = static_cast<int>(best - pooled.begin());
  const float maxLogit = *best;
  float denominator = 0.0f;
  for (const float value : pooled)
  {
    denominator += std::exp(value - maxLogit);
  }
  const float confidence = 1.0f / denominator;

  return {static_cast<char>('0' + bestClass - firstDigitClass), confidence};
}
