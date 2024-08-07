#include <iostream>
#include <map>
#include <memory>
#include <napi.h>
#include <node.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libswscale/swscale.h>
}

#include "FFReader.hpp"
#include "FrameUtils.hpp"
#include "sendMulticast.hpp"

static std::map<std::string, std::unique_ptr<FFVideoReader>> videoReaders;
static FrameInfoList frameInfoList;
static FrameRect noZoom = {0, 0, 0, 0};

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
                                   int width) {
  uint64_t number = 0; // Initialize the 64-bit number

  for (int col = 0; col < 64; col++) {
    const uint8_t pixel1 =
        image[4 *
              (row * width + col * 2)]; // Get the pixel at the current column
    const uint8_t pixel2 = image[4 * (row * width + col * 2 + 1)];

    // Check the pixel's color values
    const bool isGreen = pixel1 + pixel2 > 220;
    const uint64_t bit = isGreen ? 1 : 0;

    number = (number << 1) | bit;
  }

  if (row == 0) {
    if (number == 0) {
      return extractTimestampFromFrame(image, row + 1, width);
    } else {
      return 0;
    }
  }

  return number; // Return the timestamp in milliseconds
}

static std::shared_ptr<FrameInfo>
getFrame(const std::unique_ptr<FFVideoReader> &ffreader,
         const std::string &filename, double frameNum) {
  auto key = formatKey(filename, frameNum, false, {0, 0, 0, 0});
  auto frame = frameInfoList.getFrame(key);
  if (frame == nullptr) {
    // std::cout << "Reading frame: " << key << " frameNum: " << frameNum
    //           << std::endl;
    auto rgbaFrame = ffreader->getRGBAFrame(frameNum);
    if (!rgbaFrame) {
      return nullptr;
    }
    auto totalBytes = rgbaFrame->height * rgbaFrame->width * 4;
    auto linesize = rgbaFrame->linesize[0];
    auto pixbytes = rgbaFrame->width * 4;
    if (pixbytes != linesize) {
      // remove extra bytes at the end of each frame line as
      // the html canvas expects compacted data
      uint8_t *destdata = rgbaFrame->data[0] + pixbytes;
      uint8_t *srcdata = rgbaFrame->data[0] + linesize;
      for (int i = 1; i < rgbaFrame->height; i++) {
        memcpy(destdata, srcdata, pixbytes);
        destdata += pixbytes;
        srcdata += linesize;
      }
    }

    // Add Frame to cache
    frame = std::make_shared<FrameInfo>(frameNum, filename);
    frame->width = rgbaFrame->width;
    frame->height = rgbaFrame->height;
    frame->fps = ffreader->getFps();
    frame->totalFrames = ffreader->getTotalFrames();
    frame->totalBytes = totalBytes;
    frame->linesize = linesize;
    frame->data = std::make_shared<std::vector<std::uint8_t>>(
        rgbaFrame->data[0], rgbaFrame->data[0] + totalBytes);
    frame->motion = {0, 0, 0, false};
    auto timestamp100ns =
        extractTimestampFromFrame(*frame->data, 0, rgbaFrame->width);
    auto tsMilli =
        (5000 + timestamp100ns) / 10000; // Round 64-bit number to milliseconds
    auto tsMicro = (5 + timestamp100ns) / 10;

    if (tsMicro == 0) {
      tsMilli = uint64_t(0.5 + ((frameNum - 1) * 1000) / (frame->fps));
    }
    frame->tsMicro = tsMicro;
    frame->timestamp = tsMilli;
    frameInfoList.addFrame(frame);
  }
  return frame;
}

Napi::Object nativeVideoExecutor(const Napi::CallbackInfo &info) {
  // std::cerr << "nativeVideoExecutor add-on" << std::endl;

  Napi::Env env = info.Env();
  Napi::Object ret = Napi::Object::New(env);
  ret.Set("status", Napi::String::New(env, "OK"));
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Wrong number of arguments")
        .ThrowAsJavaScriptException();
    return ret;
  }

  auto args = info[0].As<Napi::Object>();
  if (!args.Has("op")) {
    Napi::TypeError::New(env, "Missing op field").ThrowAsJavaScriptException();
    return ret;
  }

  auto op = args.Get("op").As<Napi::String>().Utf8Value();

  if (op == "closeFile") {
    if (!args.Has("file")) {
      Napi::TypeError::New(env, "Missing file field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = args.Get("file").As<Napi::String>().Utf8Value();
    auto ffreader = videoReaders.find(file);
    if (ffreader == videoReaders.end()) {
      std::cerr << "File not open opening " << file << std::endl;
      Napi::TypeError::New(env, "File not open").ThrowAsJavaScriptException();
      return ret;
    }
    ffreader->second->closeFile();
    videoReaders.erase(file);
    return ret;
  }

  if (op == "openFile") {
    if (!args.Has("file")) {
      Napi::TypeError::New(env, "Missing file field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = args.Get("file").As<Napi::String>().Utf8Value();

    if (videoReaders.count(file)) {
      // std::cerr << "File already open, using existing file" << std::endl;
      ret.Set("status", Napi::String::New(env, "OK"));
      return ret;
    }
    std::unique_ptr<FFVideoReader> ffreader(new FFVideoReader());
    auto error = ffreader->openFile(file);
    if (error) {
      Napi::TypeError::New(env, "Failed to open file")
          .ThrowAsJavaScriptException();
      return ret;
    }
    ret.Set("status", Napi::String::New(env, "OK"));
    videoReaders.emplace(file, std::move(ffreader));
    return ret;
  }

  if (op == "grabFrameAt") {
    if (!args.Has("frameNum")) {
      Napi::TypeError::New(env, "Missing frameNum field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!args.Has("file")) {
      Napi::TypeError::New(env, "Missing file field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = args.Get("file").As<Napi::String>().Utf8Value();
    auto frameNum = args.Get("frameNum").As<Napi::Number>().DoubleValue();
    auto tsMilli = args.Get("tsMilli").As<Napi::Number>().Int64Value();
    auto ffreader = videoReaders.find(file);
    if (ffreader == videoReaders.end()) {
      std::cerr << "File not open opening " << file << std::endl;
      Napi::TypeError::New(env, "File not open").ThrowAsJavaScriptException();
      return ret;
    }
    auto roi = noZoom;
    if (args.Has("zoom")) {
      auto zoom = args.Get("zoom").As<Napi::Object>();
      auto x = zoom.Get("x").As<Napi::Number>().Int32Value();
      auto y = zoom.Get("y").As<Napi::Number>().Int32Value();
      auto zwidth = zoom.Get("width").As<Napi::Number>().Int32Value();
      auto zheight = zoom.Get("height").As<Napi::Number>().Int32Value();
      roi = {x, y, zwidth, zheight};
      // std::cout << "roi: " << roi.x << " " << roi.y << " " << roi.width << "
      // "
      //           << roi.height << std::endl;
    }

    auto hasZoom =
        (roi.width > 0) && (roi.height > 0) && ((roi.x > 0 || roi.y > 0));

    auto key = formatKey(file, frameNum, hasZoom, roi);
    // std::cout << "key: " << key << std::endl;
    auto frameInfo = frameInfoList.getFrame(key);
    if (!frameInfo) {
      // Nothing in cache, generate a new result
      auto intPart = static_cast<int>(frameNum);
      double fractionalPart = frameNum - intPart; // Extract fractional part
      auto fractionalFrame =
          ((fractionalPart > 0.01) && (fractionalPart < 0.99));
      if (fractionalFrame) {
        auto frameA = getFrame(ffreader->second, file, intPart);
        auto frameB = getFrame(ffreader->second, file, intPart + 1);
        if (frameA && frameB) {
          if (tsMilli) {
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
            if (std::abs(fractionalPart) >= 1.0) {
              std::cout << "Restricting fractional part to 1.0" << std::endl;
              fractionalPart = 0;
            }
          }
          if (!hasZoom) {
            // std::cout << "restricting roi"
            //           << " roi width=" << roi.width << std::endl;
            // Use a slice around the center
            auto width = std::min(frameA->width, 256);
            roi = {frameA->width / 2 - width / 2, 0, width, frameA->height};
          }

          if (roi.width < 50) {
            // std::cout << "restricting roi"
            //           << " roi width=" << roi.width << std::endl;
            // Use a slice around the center
            // FIXME - use original roi center if set
            auto width = std::min(frameA->width, 256);
            roi = {frameA->width / 2 - width / 2, 0, width, frameA->height};
          }
          // std::cout << "A framenum=" << frameA->frameNum
          //           << " B framenum=" << frameB->frameNum
          //           << " frac=" << fractionalPart << std::endl;
          frameInfo = generateInterpolatedFrame(frameA, frameB, fractionalPart,
                                                roi, hasZoom);
          frameA->motion = frameInfo->motion;
          frameA->roi = frameInfo->roi;
        } else {
          std::cerr << "Failed to grab frames " << file << ": " << intPart
                    << " and " << intPart + 1 << std::endl;
          // Make a copy for cache purposes
          frameInfo = std::make_shared<FrameInfo>(*frameInfo);
          frameInfo->data =
              std::make_shared<std::vector<uint8_t>>(*(frameA->data));
        }
        frameInfo->key = key;
        frameInfoList.addFrame(frameInfo);
      } else {
        frameInfo = getFrame(ffreader->second, file, intPart);
        if (frameInfo) {
          if (hasZoom) {
            frameInfo = std::make_shared<FrameInfo>(*frameInfo);
            frameInfo->data =
                std::make_shared<std::vector<uint8_t>>(*(frameInfo->data));
            frameInfo->key = key;
            frameInfoList.addFrame(frameInfo);
          }
        } else {
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

    ret.Set("data", Napi::Buffer<uint8_t>::Copy(env, frameInfo->data->data(),
                                                frameInfo->totalBytes));
    ret.Set("width", Napi::Number::New(env, frameInfo->width));
    ret.Set("height", Napi::Number::New(env, frameInfo->height));
    ret.Set("totalBytes", Napi::Number::New(env, frameInfo->totalBytes));
    ret.Set("frameNum", Napi::Number::New(env, frameInfo->frameNum));
    ret.Set("numFrames", Napi::Number::New(env, frameInfo->totalFrames));
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

    // std::cout << "Grabbed frame: " << frameNum << " WxH=" << rgbaFrame->width
    //           << "x" << rgbaFrame->height << std::endl;
    return ret;
  }

  if (op == "sendMulticast") {
    if (!args.Has("dest")) {
      Napi::TypeError::New(env, "Missing dest ip field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!args.Has("port")) {
      Napi::TypeError::New(env, "Missing port field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!args.Has("msg")) {
      Napi::TypeError::New(env, "Missing msg field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto dest = args.Get("dest").As<Napi::String>().Utf8Value();
    auto port = args.Get("port").As<Napi::Number>().Uint32Value();
    auto msg = args.Get("msg").As<Napi::String>().Utf8Value();

    auto error = sendMulticast(msg, dest, port);
    if (error == 0) {
      ret.Set("status", Napi::String::New(env, "OK"));
    } else {
      ret.Set("status", Napi::String::New(env, "Failed"));
    }
    return ret;
  }

  Napi::TypeError::New(env, "Unrecognized op field")
      .ThrowAsJavaScriptException();

  return ret;
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "nativeVideoExecutor"),
              Napi::Function::New(env, nativeVideoExecutor));

  return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
