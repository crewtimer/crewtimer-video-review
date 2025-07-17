#include <iostream>
#include <map>
#include <memory>
#include <napi.h>
#include <node.h>

extern "C"
{
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libswscale/swscale.h>
}

#include "FFReader.hpp"
#include "FrameUtils.hpp"
#include "sendMulticast.hpp"

struct FileInfo
{
  std::unique_ptr<FFVideoReader> videoReader;
  uint64_t firstFrameTimestampMilli;
  uint64_t lastFrameTimestampMilli;
  int32_t numFrames;
};
static std::map<std::string, FileInfo> fileInfoMap;
static FrameInfoList frameInfoList;
static FrameRect noZoom = {0, 0, 0, 0};
static int debugLevel = 0;

/**
 * @brief Extract a 64-bit 100ns UTC timestamp from the video frame.
 * The timestamp is encoded in the row as two pixels per bit with each bit being
 * white for 1 and black for 0.
 * @param image A vector containing the rgba image array
 * @param row The row to extract the timestamp from
 * @param width The number of columns in a row
 * @return The extracted timestamp in milliseconds
 */
uint64_t extractTimestampFromFrame(const std::vector<uint8_t> &image, int row,
                                   int width)
{
  uint64_t number = 0; // Initialize the 64-bit number

  for (int col = 0; col < 64; col++)
  {
    const uint8_t pixel1 =
        image[4 *
              (row * width + col * 2)]; // Get the pixel at the current column
    const uint8_t pixel2 = image[4 * (row * width + col * 2 + 1)];

    // Check the pixel's color values
    const bool isGreen = pixel1 + pixel2 > 220;
    const uint64_t bit = isGreen ? 1 : 0;

    number = (number << 1) | bit;
  }

  if (row == 0)
  {
    if (number == 0)
    {
      return extractTimestampFromFrame(image, row + 1, width);
    }
    else
    {
      return 0;
    }
  }

  return number; // Return the timestamp in milliseconds
}

static std::shared_ptr<FrameInfo>
getFrame(const std::unique_ptr<FFVideoReader> &ffreader,
         const std::string &filename, double frameNum, bool closeTo = false)
{
  auto key = formatKey(filename, frameNum, false, {0, 0, 0, 0}, closeTo);
  auto frame = frameInfoList.getFrame(key);
  if (frame == nullptr)
  {
    // std::cout << "Reading frame: " << key << " frameNum: " << frameNum
    //           << std::endl;
    auto rgbaFrame = ffreader->getRGBAFrame(frameNum, closeTo);
    if (!rgbaFrame)
    {
      return nullptr;
    }
    auto totalBytes = rgbaFrame->height * rgbaFrame->width * 4;
    auto linesize = rgbaFrame->linesize[0];
    auto pixbytes = rgbaFrame->width * 4;
    if (pixbytes != linesize)
    {
      // remove extra bytes at the end of each frame line as
      // the html canvas expects compacted data
      uint8_t *destdata = rgbaFrame->data[0] + pixbytes;
      uint8_t *srcdata = rgbaFrame->data[0] + linesize;
      for (int i = 1; i < rgbaFrame->height; i++)
      {
        memcpy(destdata, srcdata, pixbytes);
        destdata += pixbytes;
        srcdata += linesize;
      }
    }

    // Add Frame to cache
    frame = std::make_shared<FrameInfo>(frameNum, filename, closeTo);
    frame->width = rgbaFrame->width;
    frame->height = rgbaFrame->height;
    frame->fps = ffreader->getFps();
    frame->numFrames = ffreader->getTotalFrames();
    frame->totalBytes = totalBytes;
    frame->linesize = pixbytes;
    frame->data = std::make_shared<std::vector<std::uint8_t>>(
        rgbaFrame->data[0], rgbaFrame->data[0] + totalBytes);
    frame->motion = {0, 0, 0, false};
    auto timestamp100ns =
        extractTimestampFromFrame(*frame->data, 0, rgbaFrame->width);
    auto tsMilli =
        (5000 + timestamp100ns) / 10000; // Round 64-bit number to milliseconds
    auto tsMicro = (5 + timestamp100ns) / 10;

    if (tsMicro == 0)
    {
      tsMilli = uint64_t(0.5 + ((frameNum - 1) * 1000) / (frame->fps));
    }
    frame->tsMicro = tsMicro;
    frame->timestamp = tsMilli;
    frameInfoList.addFrame(frame);
  }
  return frame;
}

// Use 0 based indexing. getFrame() uses 1 based
static std::shared_ptr<FrameInfo>
getFrame0(const std::unique_ptr<FFVideoReader> &ffreader,
          const std::string &filename, double frameNum, bool closeTo = false)
{
  if (debugLevel > 0)
  {
    std::cerr << "checking frame " << frameNum << std::endl;
  }
  return getFrame(ffreader, filename, frameNum + 1, closeTo);
}

/**
 * @brief Finds the two adjacent video frames that bound a given timestamp.
 *
 * Given a desired timestamp (in milliseconds) and an estimated starting index (`guessIndex`)
 * based on expected frame rate, this function efficiently locates two adjacent frames `A` and `B`
 * such that:
 *     A->timestamp <= desiredTimestamp < B->timestamp
 *
 * The search algorithm is a hybrid of exponential (galloping) search and binary search:
 * - If the guess is below the desired timestamp, it gallops forward until it passes the bound.
 * - If the guess is above, it gallops backward until it goes below the desired timestamp.
 * - It then performs binary search in the identified interval to locate the exact bounding pair.
 *
 * This is efficient for near-uniformly spaced timestamps and takes advantage of the initial guess
 * to reduce search time compared to plain binary search.
 *
 * Code derived from ChatGPT: https://chatgpt.com/share/6844827d-a244-8008-9cdb-b5e750c1ab17
 *
 * @param ffreader           Unique pointer to an FFVideoReader instance.
 * @param filename           Name of the video file to search.
 * @param desiredTimestamp The target timestamp in milliseconds to locate.
 * @param guessIndex       An initial estimate of the frame index where the timestamp might be found.
 *                         Can be computed as:
 *                             guessIndex ≈ (desiredTimestamp - startTimestamp) * fps / 1000
 * @param numFrames        Total number of frames in the video
 *
 * @return A pair of std::shared_ptr<FrameInfo> {A, B}, such that A->timestamp <= desiredTimestamp < B->timestamp.
 *         Returns {nullptr, nullptr} if input is invalid or bounding frames could not be found.
 *
 * @note Assumes the frame timestamps are monotonically increasing and indexed 0 to numFrames-1.
 *       Assumes getFrame(0)->numFrames gives the total number of frames.
 */
std::pair<std::shared_ptr<FrameInfo>, std::shared_ptr<FrameInfo>>
findBoundingFrames(const std::unique_ptr<FFVideoReader> &ffreader,
                   const std::string &filename, uint64_t desiredTimestamp,
                   size_t guessIndex, size_t numFrames)
{
  guessIndex = std::min(std::max(guessIndex, size_t(0)), numFrames - 2);

  auto guessFrame = getFrame0(ffreader, filename, guessIndex);
  if (!guessFrame)
    return {nullptr, nullptr};

  size_t low, high;
  // Gallop forward
  if (guessFrame->timestamp <= desiredTimestamp)
  {
    low = guessIndex;
    high = guessIndex + 1;
    auto highFrame = getFrame0(ffreader, filename, high);
    uint64_t lastTimestamp = guessFrame->timestamp;
    while (high < numFrames && highFrame && highFrame->timestamp <= desiredTimestamp)
    {
      if (highFrame->timestamp <= lastTimestamp)
        break; // Stop if timestamps aren't increasing
      lastTimestamp = highFrame->timestamp;
      low = high;
      high = std::min(numFrames - 1, high + (high - guessIndex + 1));
      highFrame = getFrame0(ffreader, filename, high);
    }
  }
  // Gallop backward
  else
  {
    high = guessIndex;
    low = (guessIndex > 0) ? guessIndex - 1 : 0;
    auto lowFrame = getFrame0(ffreader, filename, low);
    uint64_t lastTimestamp = guessFrame->timestamp;
    while (low > 0 && lowFrame && lowFrame->timestamp > desiredTimestamp)
    {
      if (lowFrame->timestamp >= lastTimestamp)
        break; // Stop if timestamps aren't decreasing
      lastTimestamp = lowFrame->timestamp;
      high = low;
      low = (low > 2 * (guessIndex - low + 1)) ? low - 2 * (guessIndex - low + 1) : 0;
      lowFrame = getFrame0(ffreader, filename, low);
    }
  }

  // Binary search refinement
  while (low + 1 < high)
  {
    size_t mid = (low + high) / 2;
    auto midFrame = getFrame0(ffreader, filename, mid);
    if (!midFrame)
      break; // corrupted frame
    if (midFrame->timestamp <= desiredTimestamp)
      low = mid;
    else
      high = mid;
  }

  auto A = getFrame0(ffreader, filename, low);
  auto B = getFrame0(ffreader, filename, std::min(low + 1, numFrames - 1));
  if (!A || !B)
    return {nullptr, nullptr};
  return {A, B};
}

Napi::Object nativeVideoExecutor(const Napi::CallbackInfo &info)
{
  // std::cerr << "nativeVideoExecutor add-on" << std::endl;

  Napi::Env env = info.Env();
  Napi::Object ret = Napi::Object::New(env);
  ret.Set("status", Napi::String::New(env, "OK"));
  if (info.Length() < 1)
  {
    Napi::TypeError::New(env, "Wrong number of arguments")
        .ThrowAsJavaScriptException();
    return ret;
  }

  auto args = info[0].As<Napi::Object>();
  if (!args.Has("op"))
  {
    Napi::TypeError::New(env, "Missing op field").ThrowAsJavaScriptException();
    return ret;
  }

  auto op = args.Get("op").As<Napi::String>().Utf8Value();

  if (debugLevel > 1)
  {
    std::cout << "op=" << op << std::endl;
  }
  if (op == "debug")
  {
    debugLevel = args.Get("debugLevel").As<Napi::Number>().Int32Value();
  }

  if (op == "closeFile")
  {
    if (!args.Has("file"))
    {
      Napi::TypeError::New(env, "Missing file field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = args.Get("file").As<Napi::String>().Utf8Value();
    auto it = fileInfoMap.find(file);
    if (it == fileInfoMap.end())
    {
      std::cerr << "File not open opening " << file << std::endl;
      Napi::TypeError::New(env, "File not open").ThrowAsJavaScriptException();
      return ret;
    }
    it->second.videoReader->closeFile();
    fileInfoMap.erase(file);
    return ret;
  }

  if (op == "openFile")
  {
    if (!args.Has("file"))
    {
      Napi::TypeError::New(env, "Missing file field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = args.Get("file").As<Napi::String>().Utf8Value();

    if (fileInfoMap.count(file))
    {
      // std::cerr << "File already open, using existing file" << std::endl;
      ret.Set("status", Napi::String::New(env, "OK"));
      return ret;
    }

    std::unique_ptr<FFVideoReader> ffreader(new FFVideoReader());
    auto error = ffreader->openFile(file);
    if (error)
    {
      Napi::TypeError::New(env, "Failed to open file")
          .ThrowAsJavaScriptException();
      return ret;
    }

    auto frameA = getFrame(ffreader, file, 1);
    if (!frameA)
    {
      Napi::TypeError::New(env, "Unable to get first frame info")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto frameB = getFrame(ffreader, file, frameA->numFrames);
    if (!frameB)
    {
      std::cerr << "Unable to read frame " << frameA->numFrames << ". Doing one less" << std::endl;
      frameB = getFrame(ffreader, file, frameA->numFrames - 1);
    }
    if (!frameB)
    {
      Napi::TypeError::New(env, "Unable to get last frame info")
          .ThrowAsJavaScriptException();
      return ret;
    }
    ret.Set("status", Napi::String::New(env, "OK"));
    // std::cerr << "timestamps = " << frameA->timestamp << "," << frameA->tsMicro << " - " << frameB->timestamp << "," << frameB->tsMicro << std::endl;

    // Fill in the FileInfo struct
    FileInfo info;
    info.videoReader = std::move(ffreader);
    info.firstFrameTimestampMilli = frameA->timestamp;
    info.lastFrameTimestampMilli = frameB->timestamp;
    info.numFrames = frameB->frameNum;

    // Insert into the map with a filename as the key
    fileInfoMap[file] = std::move(info);
    return ret;
  }

  if (op == "grabFrameAt")
  {
    if (!args.Has("frameNum"))
    {
      Napi::TypeError::New(env, "Missing frameNum field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!args.Has("file"))
    {
      Napi::TypeError::New(env, "Missing file field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = args.Get("file").As<Napi::String>().Utf8Value();
    auto frameNum = args.Get("frameNum").As<Napi::Number>().DoubleValue();
    // std::cerr << "Grabbing frame at " << frameNum << std::endl;
    auto tsMilli = args.Get("tsMilli").As<Napi::Number>().Int64Value();
    auto it = fileInfoMap.find(file);
    if (it == fileInfoMap.end())
    {
      std::cerr << "File not open opening " << file << std::endl;
      Napi::TypeError::New(env, "File not open").ThrowAsJavaScriptException();
      return ret;
    }
    auto &fileInfo = it->second;

    auto roi = noZoom;
    std::string saveAs;
    if (args.Has("saveAs"))
    {
      saveAs = args.Get("saveAs").As<Napi::String>().Utf8Value();
    }
    if (debugLevel > 1)
    {
      std::cout << "saveAs: " << saveAs << ", frameNum: " << frameNum << ", tsMilli: " << tsMilli << ", file:" << file << std::endl;
    }

    if (args.Has("zoom"))
    {
      auto zoom = args.Get("zoom").As<Napi::Object>();
      auto x = zoom.Get("x").As<Napi::Number>().Int32Value();
      auto y = zoom.Get("y").As<Napi::Number>().Int32Value();
      auto zwidth = zoom.Get("width").As<Napi::Number>().Int32Value();
      auto zheight = zoom.Get("height").As<Napi::Number>().Int32Value();
      roi = {x, y, zwidth, zheight};
      if (debugLevel > 1)
      {
        std::cout << "roi: " << roi.x << "," << roi.y << " " << roi.width << "x"
                  << roi.height << std::endl;
      }
    }
    auto blend =
        args.Has("blend") && args.Get("blend").As<Napi::Boolean>().Value();
    auto closeTo =
        args.Has("closeTo") && args.Get("closeTo").As<Napi::Boolean>().Value();

    auto hasZoom =
        (roi.width > 0) && (roi.height > 0) && ((roi.x > 0 || roi.y > 0));

    auto key = formatKey(file, frameNum, hasZoom, roi, closeTo);
    auto frameInfo = frameInfoList.getFrame(key);
    if (!frameInfo)
    {
      // Nothing in cache, generate a new result
      auto intPart = static_cast<int>(frameNum);
      double fractionalPart = frameNum - intPart; // Extract fractional part
      auto fractionalFrame =
          ((fractionalPart > 0.01) && (fractionalPart < 0.99));
      if (!fractionalFrame)
      {
        intPart = std::round(
            frameNum); // ensure a frameNum like 123.9999 ends up 124.
      }

      if (tsMilli)
      {
        if (tsMilli < int64_t(fileInfo.firstFrameTimestampMilli) || tsMilli > int64_t(fileInfo.lastFrameTimestampMilli))
        {
          std::string msg = "Requested timestamp " + std::to_string(tsMilli) + " not within file bounds: " + "[" + std::to_string(fileInfo.firstFrameTimestampMilli) + "," + std::to_string(fileInfo.lastFrameTimestampMilli) + "]";
          std::cerr << msg << std::endl;
          Napi::TypeError::New(env, msg.c_str()).ThrowAsJavaScriptException();
          return ret;
        }
        // find frames on either side of requested time
        float delta = fileInfo.lastFrameTimestampMilli - fileInfo.firstFrameTimestampMilli;
        auto seekFrameFloat = delta <= 0 ? 1 : 1 + ((tsMilli - fileInfo.firstFrameTimestampMilli) / delta) * (fileInfo.numFrames - 1);
        intPart = static_cast<int>(seekFrameFloat);
        fractionalPart = seekFrameFloat - intPart; // Extract fractional part
        fractionalFrame =
            ((fractionalPart > 0.01) && (fractionalPart < 0.99));

        auto [frameA, frameB] = findBoundingFrames(fileInfo.videoReader, file, tsMilli, intPart, fileInfo.numFrames);

        if (frameA && frameB)
        {

          if (debugLevel > 1)
          {
            std::cerr << "Found bounding frames at " << frameA->frameNum << ", " << frameB->frameNum << std::endl;
          }
          intPart = frameA->frameNum;
          float delta = frameB->timestamp - frameA->timestamp;
          if (delta <= 0)
          {
            std::string msg = "Malformed video frames detected at frame " + std::to_string(frameA->frameNum) + " and " + std::to_string(frameB->frameNum);
            std::cerr << msg << std::endl;
            Napi::TypeError::New(env, msg.c_str()).ThrowAsJavaScriptException();
            return ret;
          }

          fractionalPart = (tsMilli - frameA->timestamp) / delta;
          seekFrameFloat = intPart + fractionalPart;
          fractionalFrame =
              ((fractionalPart > 0.01) && (fractionalPart < 0.99));
        }
      }

      if (fractionalFrame)
      {
        auto frameA = getFrame(fileInfo.videoReader, file, intPart);
        auto frameB = getFrame(fileInfo.videoReader, file, intPart + 1);
        if (frameA && frameB)
        {
          if (tsMilli)
          {
            // refine the fractional part now that we know the exact frame times
            // involved.
            fractionalPart = double(tsMilli * 1000 - frameA->tsMicro) /
                             (frameB->tsMicro - frameA->tsMicro);
            // std::cout << "tsMilli=" << tsMilli << " A ts=" << frameA->tsMicro
            //           << " B ts=" << frameB->tsMicro
            //           << " frac=" << fractionalPart << std::endl;
            // std::cout << tsMilli << std::endl
            //           << frameA->tsMicro << std::endl
            //           << frameB->tsMicro << std::endl;
            if (std::abs(fractionalPart) >= 1.0)
            {
              std::cout << "Restricting fractional part to 1.0" << std::endl;
              fractionalPart = 0;
            }
          }
          if (!hasZoom)
          {
            // GE: If we have no zoom do we want to trigger interpolate?
            std::cout << "Not zooming.  restricting roi"
                      << " roi width=" << roi.width << std::endl;
            // Use a slice around the center
            auto width = std::min(frameA->width, 256);
            roi = {frameA->width / 2 - width / 2, 0, width, frameA->height};
          }
          // range check roi

          roi.width = std::min(roi.width, frameA->width);
          roi.height = std::min(roi.height, frameA->height);
          roi.x = std::max(0, roi.x);
          roi.y = std::max(0, roi.y);
          if (roi.x + roi.width > frameA->width)
          {
            roi.x = frameA->width - roi.width;
          }
          if (roi.y + roi.height > frameA->height)
          {
            roi.y = frameA->height - roi.height;
          }

          // std::cout << "A framenum=" << frameA->frameNum
          //           << " B framenum=" << frameB->frameNum
          //           << " frac=" << fractionalPart << std::endl;
          if (debugLevel)
          {
            std::cout << __FILE__ << ":" << __LINE__
                      << " Generating interpolated frame at " << fractionalPart
                      << "% zoom=" << (hasZoom ? "true" : "false")
                      << " blend=" << (blend ? "true" : "false") << std::endl;
          }
          frameInfo = generateInterpolatedFrame(frameA, frameB, fractionalPart,
                                                roi, blend);
          frameA->motion = frameInfo->motion;
          frameA->roi = frameInfo->roi;
        }
        else
        {
          std::cerr << "Failed to grab frames " << file << ": " << intPart
                    << " and " << intPart + 1 << std::endl;
          // Make a copy for cache purposes
          frameInfo = std::make_shared<FrameInfo>(*frameInfo);
          frameInfo->data =
              std::make_shared<std::vector<uint8_t>>(*(frameA->data));
        }
        frameInfo->key = key;
        frameInfoList.addFrame(frameInfo);
      }
      else
      {
        frameInfo = getFrame(fileInfo.videoReader, file, intPart, closeTo);
        if (frameInfo)
        {
          if (hasZoom)
          {
            frameInfo = std::make_shared<FrameInfo>(*frameInfo);
            frameInfo->data =
                std::make_shared<std::vector<uint8_t>>(*(frameInfo->data));
            frameInfo->key = key;
            frameInfoList.addFrame(frameInfo);
          }
        }
        else
        {
          std::string msg = "Failed to grab frame " + std::to_string(frameNum);
          std::cerr << msg << std::endl;
          Napi::TypeError::New(env, msg.c_str()).ThrowAsJavaScriptException();
          return ret;
        }
      }
      // if (hasZoom) {
      //   sharpenFrame(frameInfo);
      // }
    }

    if (!saveAs.empty())
    {
      saveFrameAsPNG(frameInfo, saveAs);
    }

    ret.Set("data", Napi::Buffer<uint8_t>::Copy(env, frameInfo->data->data(),
                                                frameInfo->totalBytes));
    ret.Set("width", Napi::Number::New(env, frameInfo->width));
    ret.Set("height", Napi::Number::New(env, frameInfo->height));
    ret.Set("totalBytes", Napi::Number::New(env, frameInfo->totalBytes));
    ret.Set("frameNum", Napi::Number::New(env, frameInfo->frameNum));
    ret.Set("numFrames", Napi::Number::New(env, frameInfo->numFrames));
    ret.Set("fps", Napi::Number::New(env, frameInfo->fps));
    ret.Set("status", Napi::String::New(env, "OK"));
    ret.Set("file", Napi::String::New(env, frameInfo->file));
    ret.Set("timestamp", Napi::Number::New(env, frameInfo->timestamp));
    ret.Set("tsMicro", Napi::Number::New(env, frameInfo->tsMicro));
    Napi::Object motion = Napi::Object::New(env);
    motion.Set("x", Napi::Number::New(env, frameInfo->motion.x));
    motion.Set("y", Napi::Number::New(env, frameInfo->motion.y));
    motion.Set("dt", Napi::Number::New(env, frameInfo->motion.dt));
    motion.Set("valid", Napi::Boolean::New(env, frameInfo->motion.valid));
    ret.Set("motion", motion);

    if (debugLevel > 1)
    {
      std::cout << "Grabbed frame: " << frameInfo->frameNum << " ts=" << frameInfo->timestamp << " WxH=" << frameInfo->width
                << "x" << frameInfo->height << std::endl;
    }
    return ret;
  }

  if (op == "sendMulticast")
  {
    if (!args.Has("dest"))
    {
      Napi::TypeError::New(env, "Missing dest ip field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!args.Has("port"))
    {
      Napi::TypeError::New(env, "Missing port field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!args.Has("msg"))
    {
      Napi::TypeError::New(env, "Missing msg field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto dest = args.Get("dest").As<Napi::String>().Utf8Value();
    auto port = args.Get("port").As<Napi::Number>().Uint32Value();
    auto msg = args.Get("msg").As<Napi::String>().Utf8Value();

    auto error = sendMulticast(msg, dest, port);
    if (error == 0)
    {
      ret.Set("status", Napi::String::New(env, "OK"));
    }
    else
    {
      ret.Set("status", Napi::String::New(env, "Failed"));
    }
    return ret;
  }

  Napi::TypeError::New(env, "Unrecognized op field")
      .ThrowAsJavaScriptException();

  return ret;
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports)
{
  exports.Set(Napi::String::New(env, "nativeVideoExecutor"),
              Napi::Function::New(env, nativeVideoExecutor));
  std::cerr << "System built " __DATE__ "  " __TIME__ << std::endl;

  return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
