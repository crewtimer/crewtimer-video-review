#pragma once

#include <opencv2/core.hpp>
#include <opencv2/dnn.hpp>

#include <string>
#include <vector>

struct BowCharacterDetection
{
  char character = '\0';
  float confidence = 0.0f;
  cv::Rect box;
};

struct BowCardDetection
{
  std::string text;
  float confidence = 0.0f;
  cv::Rect box;
  std::vector<BowCharacterDetection> characters;
};

class BowCardDetector
{
public:
  explicit BowCardDetector(const std::string &modelPath);

  BowCardDetection detect(const cv::Mat &rgbaFrame,
                          const cv::Rect &region,
                          int focusX = -1) const;

private:
  struct Blob
  {
    cv::Rect scaledRect;
    int area;
  };

  struct CharacterPrediction
  {
    char character;
    float confidence;
  };

  cv::dnn::Net net_;

  static constexpr int SCALE = 10;
  static constexpr int INPUT_WIDTH = 64;
  static constexpr int INPUT_HEIGHT = 32;
  static constexpr int MIN_BLOB_AREA = 200;
  static constexpr const char *CHARSET = "-0123456789";

  cv::Mat preprocess(const cv::Mat &gray) const;
  std::vector<Blob> findBlobs(const cv::Mat &thresholded,
                              int sourceWidth) const;
  std::vector<std::vector<Blob>>
  groupBlobs(const std::vector<Blob> &blobs) const;
  CharacterPrediction predict(const cv::Mat &characterCrop) const;
};
