#include <algorithm>
#include <iomanip> // for setprecision
#include <iostream>
#include <list>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

struct ImageMotion {
  double x;
  double y;
  uint64_t dt;
  bool valid;
};

struct FrameRect {
  int x;
  int y;
  int width;
  int height;

  // Overload the == operator
  bool operator==(const FrameRect &other) const {
    return x == other.x && y == other.y && width == other.width &&
           height == other.height;
  }

  // Overload the != operator
  bool operator!=(const FrameRect &other) const { return !(*this == other); }

  // Overload the << operator for easy printing
  friend std::ostream &operator<<(std::ostream &os, const FrameRect &rect) {
    os << "(x: " << rect.x << ", y: " << rect.y << ", " << rect.width << "x"
       << rect.height << ")";
    return os;
  }
};

struct InterpResult {
  std::shared_ptr<class FrameInfo> blendedFrame;
  std::shared_ptr<class FrameInfo> shiftedFrame;
};

/**
 * @brief Formats the key by combining the file string and the frame number with
 * two decimal places.
 *
 * @param file The file string.
 * @param frameNum The frame number.
 * @param hasZoom The frame will have zoom applied.
 * @param roi Zoom region of interest (if hasZoom)
 * @return A formatted string combining the file and frame number.
 */
inline std::string formatKey(const std::string &file, float frameNum,
                             bool hasZoom, FrameRect roi) {
  std::ostringstream oss;
  oss << file << "-" << std::fixed << std::setprecision(6) << frameNum;
  if (hasZoom) {
    oss << "-" << roi.x << "-" << roi.y << "-" << roi.width << "-"
        << roi.height;
  }
  auto key = oss.str();
  // std::cout << "key=" << key << std::endl;
  return key;
}

/**
 * @class FrameInfo
 * @brief A class to store information about a video frame.
 */
class FrameInfo {
public:
  float frameNum;  ///< The frame number.
  int numFrames;   ///< The total number of frames.
  double fps;      ///< Frames per second.
  int totalBytes;  ///< Total bytes of the frame data.
  int totalFrames; ///< Total frames in the video.
  std::shared_ptr<std::vector<uint8_t>>
      data;           ///< Shared pointer to the frame data.
  int width;          ///< Width of the frame.
  int height;         ///< Height of the frame.
  int linesize;       ///< Line size of the frame.
  uint64_t timestamp; ///< Timestamp of the frame in milliseconds.
  uint64_t tsMicro;   ///< Timestamp of the frame in microseconds.
  std::string file;   ///< The file associated with the frame.
  std::string debug;
  ImageMotion motion = {0, 0, 0, false}; ///< Motion information of the frame.
  FrameRect roi;                         ///< The roi used to calculate motion
  std::string
      key; ///< Unique key for the frame, concatenation of file and frameNum.

  /**
   * @brief Constructs a FrameInfo object.
   * @param frameNum The frame number.
   * @param file The file associated with the frame.
   */
  FrameInfo(int frameNum, const std::string &file)
      : frameNum(frameNum), file(file) {
    key = formatKey(file, frameNum, false, {0, 0, 0, 0});
  }
};

/**
 * @class FrameInfoList
 * @brief A class to manage a list of FrameInfo objects with a maximum size.
 */
class FrameInfoList {
private:
  std::list<std::shared_ptr<FrameInfo>>
      frameList;             ///< List of FrameInfo objects.
  const size_t maxSize = 32; ///< Maximum size of the list.

public:
  /**
   * @brief Adds a frame to the list. If the frame already exists, it is
   * updated. If the list is full, the oldest frame is removed.
   * @param frame Shared pointer to the FrameInfo object to be added.
   */
  void addFrame(const std::shared_ptr<FrameInfo> &frame) {
    // Check if frame is already in the list and remove it
    auto it = std::find_if(frameList.begin(), frameList.end(),
                           [&frame](const std::shared_ptr<FrameInfo> &f) {
                             return f->key == frame->key;
                           });
    if (it != frameList.end()) {
      frameList.erase(it);
    } else if (frameList.size() >= maxSize) {
      frameList.pop_back();
    }

    frameList.push_front(frame);
  }

  /**
   * @brief Retrieves a frame from the list by its key.
   * @param key The key of the frame to retrieve.
   * @return Shared pointer to the FrameInfo object, or nullptr if not found.
   */
  std::shared_ptr<FrameInfo> getFrame(const std::string &key) {
    auto it = std::find_if(
        frameList.begin(), frameList.end(),
        [&key](const std::shared_ptr<FrameInfo> &f) { return f->key == key; });
    if (it != frameList.end()) {
      return *it;
    }
    return nullptr;
  }
};

/**
 * @brief Generate a time/position frame between the two provided frames
 *
 * @param frameA
 * @param frameB
 * @param pctAtoB Fraction of time from frameA to frameB. 0.5 is half way.
 * @param xPosition The center x position of the flow estimation
 * @param pixelRange The pixel range on either side of xPosition to use for the
 * estimate
 * @param blend True to blend frameA and frameB, otherwise frameA is shifted
 * @return FrameInfo The interpolated frame as well as a shifted frame
 */
const std::shared_ptr<FrameInfo>
generateInterpolatedFrame(const std::shared_ptr<FrameInfo> frameA,
                          const std::shared_ptr<FrameInfo> frameB,
                          double pctAtoB, FrameRect roi, bool blend);

void sharpenFrame(const std::shared_ptr<FrameInfo> frameA);

/**
 * @brief Saves a frame as a PNG file using OpenCV.
 *
 * This function takes a `FrameInfo` object, extracts the RGBA data,
 * and saves it as a PNG image using the OpenCV library.
 *
 * @param frameInfo A shared pointer to a `FrameInfo` object containing the
 * frame data.
 * @param outputFileName The name of the output PNG file.
 *
 * @note The `frameInfo` object must contain valid RGBA data, and the `width`
 * and `height` fields must be set appropriately.
 *
 * @warning If the `frameInfo` object is invalid, the function will print an
 * error message and return without saving an image.
 */
void saveFrameAsPNG(const std::shared_ptr<FrameInfo> &frameInfo,
                    const std::string &outputFileName);
