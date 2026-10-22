#include <algorithm>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <deque>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <napi.h>
#include <node.h>
#include <opencv2/core.hpp>

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

#ifdef __APPLE__
extern "C" void triggerMacOSLocalNetworkPermission();
#endif
#ifdef RIFE_SUPPORTED
#include "RifeInterpolator.hpp"
#include "BowNumberPipeline.hpp"
#endif

struct FileInfo
{
  std::unique_ptr<FFVideoReader> videoReader;
  uint64_t firstFrameTimestampMilli;
  uint64_t lastFrameTimestampMilli;
  int32_t numFrames;
};
static std::map<std::string, FileInfo> fileInfoMap;
#ifdef RIFE_SUPPORTED
// Deliberately leaked (raw pointer, never deleted): the ONNX Runtime
// session + CoreML/DirectML EP spawn background compile/inference threads
// that can still be tearing down when the process exits, and destroying
// Ort::Env at static-destruction time races with that, crashing on quit.
// These are process-lifetime singletons anyway, so we never tear them down.
static std::map<std::string, RifeInterpolator *> rifeInterpolatorMap;
static std::map<std::string, BowNumberPipeline *> bowNumberPipelineMap;
#endif
static FrameInfoList frameInfoList;
static FrameRect noZoom = {0, 0, 0, 0};
static std::ofstream nativeLogStream;
// Written on the JS thread by the "debug" op, read on the native worker.
static std::atomic<int> debugLevel{0};

struct PruneSpec
{
  double percentage = 0; // 0 means no pruning
  bool fromTop = false;
};

static PruneSpec parsePrune(const Napi::Object &request)
{
  PruneSpec spec;
  if (!request.Has("prune") || !request.Get("prune").IsObject())
    return spec;
  const auto prune = request.Get("prune").As<Napi::Object>();
  if (!prune.Has("percentage"))
    return spec;
  spec.percentage = std::max(
      0.0, std::min(95.0, prune.Get("percentage").As<Napi::Number>().DoubleValue()));
  spec.fromTop = prune.Get("side").As<Napi::String>().Utf8Value() == "top";
  return spec;
}

static int prunePixels(const PruneSpec &prune, int height)
{
  const int pixels = static_cast<int>(
      std::round((height * prune.percentage / 100.0) / 4.0) * 4.0);
  return std::max(0, std::min(pixels, height - 4));
}

static std::shared_ptr<FrameInfo>
pruneFrame(const std::shared_ptr<FrameInfo> &source, const PruneSpec &prune)
{
  const int pixels = prunePixels(prune, source->height);
  if (pixels == 0)
    return source;
  const int y = prune.fromTop ? pixels : 0;
  const int croppedHeight = source->height - pixels;
  const cv::Mat rgba(source->height, source->width, CV_8UC4,
                     source->data->data(), source->linesize);
  const cv::Mat cropped = rgba(cv::Rect(0, y, source->width, croppedHeight)).clone();
  auto result = std::make_shared<FrameInfo>(*source);
  result->width = cropped.cols;
  result->height = cropped.rows;
  result->linesize = static_cast<int>(cropped.step);
  result->totalBytes = static_cast<int>(cropped.total() * cropped.elemSize());
  result->data = std::make_shared<std::vector<uint8_t>>(
      cropped.data, cropped.data + result->totalBytes);
  return result;
}

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
    if (ffreader->getFirstUtcUs() != 0)
    {
      // std::cerr << "Using first_utc_us from video: " << ffreader->getFirstUtcUs() << std::endl;
      auto tsMicro = ffreader->getFirstUtcUs() + 1000000 * rgbaFrame->pts * rgbaFrame->time_base.num / rgbaFrame->time_base.den;
      frame->tsMicro = tsMicro;
      frame->timestamp = (tsMicro + 500) / 1000;
      // std::cerr << "timestamp ms: " << frame->timestamp << " pts: " << rgbaFrame->pts << std::endl;
    }
    else
    {

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
    }
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

// Converts a worker result into a JS value. Runs on the JS thread.
using ResultBuilder = std::function<Napi::Value(Napi::Env)>;
// Work performed on the native worker thread. Throws std::exception on error.
using NativeTask = std::function<ResultBuilder()>;

static Napi::Value statusOK(Napi::Env env)
{
  Napi::Object ret = Napi::Object::New(env);
  ret.Set("status", Napi::String::New(env, "OK"));
  return ret;
}

/**
 * A single long-lived thread that runs decode and ONNX inference work off the
 * Electron main thread. A slow or hung CoreML/DirectML call previously froze
 * the whole app because it ran synchronously inside the IPC handler. Tasks run
 * one at a time in FIFO order, so fileInfoMap, frameInfoList and the ONNX
 * session maps are only ever touched from this thread. A dedicated thread
 * (rather than the libuv pool) keeps a stuck inference from starving Node's
 * fs/dns/crypto work.
 *
 * Deliberately leaked and detached: a task may be blocked inside a native
 * library at quit, and joining or destroying it during static teardown would
 * hang or crash on exit.
 */
class NativeWorker
{
public:
  static NativeWorker &instance()
  {
    static NativeWorker *worker = new NativeWorker();
    return *worker;
  }

  void post(std::function<void()> job)
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      jobs_.push_back(std::move(job));
    }
    cv_.notify_one();
  }

private:
  NativeWorker()
  {
    std::thread([this]() { run(); }).detach();
  }

  void run()
  {
    for (;;)
    {
      std::function<void()> job;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait(lock, [this]() { return !jobs_.empty(); });
        job = std::move(jobs_.front());
        jobs_.pop_front();
      }
      job();
    }
  }

  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<std::function<void()>> jobs_;
};

struct NativeTaskCompletion
{
  Napi::Promise::Deferred deferred;
  ResultBuilder result;
  std::string error;
};

/**
 * Queues task on the native worker and returns a Promise that settles with
 * the task's result, or rejects with an Error carrying the exception message.
 */
static Napi::Value runOnNativeWorker(Napi::Env env, const char *name,
                                     NativeTask task)
{
  auto completion = new NativeTaskCompletion{
      Napi::Promise::Deferred::New(env), nullptr, ""};
  auto promise = completion->deferred.Promise();
  auto tsfn = Napi::ThreadSafeFunction::New(
      env, Napi::Function::New(env, [](const Napi::CallbackInfo &) {}), name,
      0, 1);

  NativeWorker::instance().post(
      [task = std::move(task), completion, tsfn]() mutable
      {
        try
        {
          completion->result = task();
        }
        catch (const std::exception &e)
        {
          completion->error = e.what();
        }
        catch (...)
        {
          completion->error = "Unknown native error";
        }
        tsfn.BlockingCall(
            completion,
            [](Napi::Env env, Napi::Function, NativeTaskCompletion *done)
            {
              // env is null if the environment is shutting down.
              if (env != nullptr)
              {
                if (done->error.empty())
                {
                  done->deferred.Resolve(done->result(env));
                }
                else
                {
                  done->deferred.Reject(
                      Napi::Error::New(env, done->error).Value());
                }
              }
              delete done;
            });
        tsfn.Release();
      });
  return promise;
}

Napi::Value nativeVideoExecutor(const Napi::CallbackInfo &info)
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
    return ret;
  }
  if (op == "setLogFile")
  {
    auto logFile = args.Get("logFile").As<Napi::String>().Utf8Value();
    nativeLogStream.open(logFile, std::ios::app);
    if (nativeLogStream.is_open())
    {
      std::cout.rdbuf(nativeLogStream.rdbuf());
      std::cerr.rdbuf(nativeLogStream.rdbuf());
      std::cerr << "C++ stdout/stderr redirected to " << logFile << std::endl;
    }
    return ret;
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
    return runOnNativeWorker(env, "closeFile", [file]() -> ResultBuilder
    {
      auto it = fileInfoMap.find(file);
      if (it == fileInfoMap.end())
      {
        std::cerr << "File not open opening " << file << std::endl;
        throw std::runtime_error("File not open");
      }
      it->second.videoReader->closeFile();
      fileInfoMap.erase(file);
      return statusOK;
    });
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
    return runOnNativeWorker(env, "openFile", [file]() -> ResultBuilder
    {
      if (fileInfoMap.count(file))
      {
        // std::cerr << "File already open, using existing file" << std::endl;
        return statusOK;
      }

      std::unique_ptr<FFVideoReader> ffreader(new FFVideoReader());
      auto error = ffreader->openFile(file);
      if (error)
      {
        throw std::runtime_error("Failed to open file");
      }

      auto frameA = getFrame(ffreader, file, 1);
      if (!frameA)
      {
        throw std::runtime_error("Unable to get first frame info");
      }
      // On VFR files, r_frame_rate can disagree with nb_frames / duration by
      // up to ~1%, so the last requestable frame index (via dts_to_frame_number
      // = fps * seconds) can fall short of nb_frames by up to 1% of nb_frames.
      // Allow retries over that window (with a floor of 200 for short clips).
      std::shared_ptr<FrameInfo> frameB;
      const int maxBack =
          std::max(200, static_cast<int>(frameA->numFrames / 50)); // up to 2%
      // Exponential probe to find any reachable back-offset, then bisect to
      // find the smallest passing back. Each getFrame() failure near EOF is
      // expensive (full av_seek_frame + forward-decode), so linear walkback
      // is O(maxBack) seeks — this is O(log maxBack).
      int lo = -1; // largest known-failing back (-1 = none tried)
      int hi = -1; // smallest known-passing back (-1 = none found)
      for (int probe = 0; probe <= maxBack; probe = probe == 0 ? 1 : probe * 2)
      {
        auto f = getFrame(ffreader, file, frameA->numFrames - probe);
        if (f)
        {
          frameB = f;
          hi = probe;
          break;
        }
        lo = probe;
        if (probe == 0)
        {
          std::cerr << "Unable to read frame " << frameA->numFrames
                    << ". Walking back up to " << maxBack << " frames..."
                    << std::endl;
        }
        if (probe >= maxBack) break;
      }
      while (lo >= 0 && hi - lo > 1)
      {
        int mid = lo + (hi - lo) / 2;
        auto f = getFrame(ffreader, file, frameA->numFrames - mid);
        if (f)
        {
          frameB = f;
          hi = mid;
        }
        else
        {
          lo = mid;
        }
      }
      if (!frameB)
      {
        throw std::runtime_error("Unable to get last frame info");
      }
      // std::cerr << "timestamps = " << frameA->timestamp << "," << frameA->tsMicro << " - " << frameB->timestamp << "," << frameB->tsMicro << std::endl;

      // Fill in the FileInfo struct
      FileInfo info;
      info.videoReader = std::move(ffreader);
      info.firstFrameTimestampMilli = frameA->timestamp;
      info.lastFrameTimestampMilli = frameB->timestamp;
      info.numFrames = frameB->frameNum;

      // Insert into the map with a filename as the key
      fileInfoMap[file] = std::move(info);
      return statusOK;
    });
  }

  if (op == "detectBowAtFrame")
  {
#ifndef RIFE_SUPPORTED
    Napi::Error::New(env, "Bow number detection requires ONNX Runtime, which "
                          "is not built for this platform")
        .ThrowAsJavaScriptException();
    return ret;
#else
    if (!args.Has("request") || !args.Get("request").IsObject())
    {
      Napi::TypeError::New(env, "Missing bow detection request")
          .ThrowAsJavaScriptException();
      return ret;
    }
    const auto request = args.Get("request").As<Napi::Object>();
    if (!request.Has("videoFile") || !request.Has("frameNum") ||
        !request.Has("boatModelFile") || !request.Has("cardModelFile") ||
        !request.Has("numberModelFile"))
    {
      Napi::TypeError::New(env,
                           "Bow detection requires videoFile, frameNum, "
                           "boatModelFile, cardModelFile, and numberModelFile")
          .ThrowAsJavaScriptException();
      return ret;
    }

    const std::string videoFile =
        request.Get("videoFile").As<Napi::String>().Utf8Value();
    const std::string boatModelFile =
        request.Get("boatModelFile").As<Napi::String>().Utf8Value();
    const std::string cardModelFile =
        request.Get("cardModelFile").As<Napi::String>().Utf8Value();
    const std::string numberModelFile =
        request.Get("numberModelFile").As<Napi::String>().Utf8Value();
    const double frameNum =
        request.Get("frameNum").As<Napi::Number>().DoubleValue();
    const bool closeTo =
        request.Has("closeTo") &&
        request.Get("closeTo").As<Napi::Boolean>().Value();
    const bool detectCardsWithoutBoat =
        request.Has("detectCardsWithoutBoat") &&
        request.Get("detectCardsWithoutBoat").As<Napi::Boolean>().Value();
    const bool hasPoint = request.Has("point");
    cv::Point pointOfInterest;
    if (hasPoint)
    {
      const auto pointObject = request.Get("point").As<Napi::Object>();
      pointOfInterest = cv::Point(
          pointObject.Get("x").As<Napi::Number>().Int32Value(),
          pointObject.Get("y").As<Napi::Number>().Int32Value());
    }
    const PruneSpec prune = parsePrune(request);

    return runOnNativeWorker(env, "detectBowAtFrame", [=]() -> ResultBuilder
    {
      const auto file = fileInfoMap.find(videoFile);
      if (file == fileInfoMap.end())
      {
        throw std::invalid_argument("Video file is not open");
      }

      const auto frame =
          getFrame(file->second.videoReader, videoFile, frameNum, closeTo);
      if (!frame)
      {
        throw std::runtime_error(
            "Unable to read frame " + std::to_string(frameNum));
      }

      const std::string pipelineKey =
          boatModelFile + "|" + cardModelFile + "|" + numberModelFile;
      auto pipelineEntry = bowNumberPipelineMap.find(pipelineKey);
      if (pipelineEntry == bowNumberPipelineMap.end())
      {
        pipelineEntry =
            bowNumberPipelineMap
                .emplace(pipelineKey,
                        new BowNumberPipeline(boatModelFile, cardModelFile,
                                              numberModelFile))
                .first;
      }

      const auto detectionFrame = pruneFrame(frame, prune);
      const cv::Mat rgba(detectionFrame->height, detectionFrame->width, CV_8UC4,
                         detectionFrame->data->data(), detectionFrame->linesize);
      std::vector<BowNumberDetection> detections;
      if (hasPoint)
      {
        detections.push_back(
            pipelineEntry->second->detect(rgba, pointOfInterest,
                                          detectCardsWithoutBoat));
      }
      else
      {
        detections = pipelineEntry->second->detectAll(
            rgba, detectCardsWithoutBoat);
      }

      const auto resultFrameNum = frame->frameNum;
      const auto resultTimestamp = frame->timestamp;
      return [detections = std::move(detections), resultFrameNum,
              resultTimestamp](Napi::Env env) -> Napi::Value
      {
        Napi::Object ret = Napi::Object::New(env);
        ret.Set("status", Napi::String::New(env, "OK"));
        ret.Set("frameNum", Napi::Number::New(env, resultFrameNum));
        ret.Set("timestamp", Napi::Number::New(env, resultTimestamp));

        const auto makeBox = [&env](const cv::Rect &box)
        {
          Napi::Object value = Napi::Object::New(env);
          value.Set("x", Napi::Number::New(env, box.x));
          value.Set("y", Napi::Number::New(env, box.y));
          value.Set("width", Napi::Number::New(env, box.width));
          value.Set("height", Napi::Number::New(env, box.height));
          return value;
        };
        Napi::Array detectionValues = Napi::Array::New(env, detections.size());
        for (size_t index = 0; index < detections.size(); ++index)
        {
          const auto &detection = detections[index];
          Napi::Object value = Napi::Object::New(env);
          value.Set("text", Napi::String::New(env, detection.text));
          value.Set("confidence",
                    Napi::Number::New(env, detection.confidence));
          value.Set("box", makeBox(detection.cardBox));
          value.Set("boatBox", makeBox(detection.boatBox));
          detectionValues.Set(index, value);
        }
        ret.Set("detections", detectionValues);
        return ret;
      };
    });
#endif
  }

  if (op == "grabFrameAt")
  {
    auto request = args.Get("request").As<Napi::Object>();
    if (!request.Has("frameNum"))
    {
      Napi::TypeError::New(env, "Missing frameNum field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    if (!request.Has("videoFile"))
    {
      Napi::TypeError::New(env, "Missing videoFile field")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto file = request.Get("videoFile").As<Napi::String>().Utf8Value();
    auto frameNum = request.Get("frameNum").As<Napi::Number>().DoubleValue();
    // std::cerr << "Grabbing frame at " << frameNum << std::endl;
    const int64_t tsMilli =
        request.Has("tsMilli") && request.Get("tsMilli").IsNumber()
            ? request.Get("tsMilli").As<Napi::Number>().Int64Value()
            : 0;

    auto roi = noZoom;
    std::string saveAs;
    if (request.Has("saveAs"))
    {
      saveAs = request.Get("saveAs").As<Napi::String>().Utf8Value();
    }
    if (debugLevel > 1)
    {
      std::cout << "saveAs: " << saveAs << ", frameNum: " << frameNum << ", tsMilli: " << tsMilli << ", file:" << file << std::endl;
    }

    if (request.Has("zoom") && request.Get("zoom").IsObject())
    {
      auto zoom = request.Get("zoom").As<Napi::Object>();
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
        request.Has("blend") && request.Get("blend").As<Napi::Boolean>().Value();
    auto closeTo =
        request.Has("closeTo") && request.Get("closeTo").As<Napi::Boolean>().Value();

    std::string interpMethod = "blend";
    if (request.Has("interpMethod"))
    {
      interpMethod = request.Get("interpMethod").As<Napi::String>().Utf8Value();
    }
    std::string rifeModelFile;
    if (request.Has("modelFile"))
    {
      rifeModelFile = request.Get("modelFile").As<Napi::String>().Utf8Value();
    }
    auto rifeCrop = noZoom;
    auto hasRifeCrop = false;
    if (request.Has("crop") && request.Get("crop").IsObject())
    {
      auto cropObj = request.Get("crop").As<Napi::Object>();
      auto x = cropObj.Get("x").As<Napi::Number>().Int32Value();
      auto y = cropObj.Get("y").As<Napi::Number>().Int32Value();
      auto cwidth = cropObj.Get("width").As<Napi::Number>().Int32Value();
      auto cheight = cropObj.Get("height").As<Napi::Number>().Int32Value();
      rifeCrop = {x, y, cwidth, cheight};
      hasRifeCrop = (rifeCrop.width > 0) && (rifeCrop.height > 0);
    }

    auto hasZoom =
        (roi.width > 0) && (roi.height > 0) && ((roi.x > 0 || roi.y > 0));

    const PruneSpec prune = parsePrune(request);

    return runOnNativeWorker(env, "grabFrameAt", [=]() mutable -> ResultBuilder
    {
      auto it = fileInfoMap.find(file);
      if (it == fileInfoMap.end())
      {
        std::cerr << "File not open opening " << file << std::endl;
        throw std::runtime_error("File not open");
      }
      auto &fileInfo = it->second;

      auto key = formatKey(file, frameNum, hasZoom, roi, closeTo);
      if (interpMethod == "rife")
      {
        key += "-rife-" + std::to_string(rifeCrop.x) + "-" +
               std::to_string(rifeCrop.y) + "-" + std::to_string(rifeCrop.width) +
               "-" + std::to_string(rifeCrop.height);
      }
      auto frameInfo = frameInfoList.getFrame(key);
      if (!frameInfo)
      {
        // Only meant to absorb float representation noise (e.g. 123.9999997
        // meaning "really frame 124"), not real fractional requests -- a wider
        // tolerance here silently skips interpolation/RIFE near integer frames
        // and returns the raw decode instead, which is visibly different
        // (sharper/less blended) and shows up as a jump right at the boundary.
        constexpr double kIntegerFrameEpsilon = 1e-3;
        // Nothing in cache, generate a new result
        auto intPart = static_cast<int>(frameNum);
        double fractionalPart = frameNum - intPart; // Extract fractional part
        auto fractionalFrame =
            ((fractionalPart > kIntegerFrameEpsilon) &&
             (fractionalPart < 1.0 - kIntegerFrameEpsilon));
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
            throw std::runtime_error(msg.c_str());
          }
          // A time at the first or last frame has no frame on its far side to
          // interpolate with, so use that frame directly.
          if (tsMilli >= int64_t(fileInfo.lastFrameTimestampMilli))
          {
            intPart = fileInfo.numFrames;
            fractionalFrame = false;
          }
          else if (tsMilli <= int64_t(fileInfo.firstFrameTimestampMilli))
          {
            intPart = 1;
            fractionalFrame = false;
          }
          else
          {
            // find frames on either side of requested time
            float delta = fileInfo.lastFrameTimestampMilli - fileInfo.firstFrameTimestampMilli;
            auto seekFrameFloat = delta <= 0 ? 1 : 1 + ((tsMilli - fileInfo.firstFrameTimestampMilli) / delta) * (fileInfo.numFrames - 1);
            intPart = static_cast<int>(seekFrameFloat);
            fractionalPart = seekFrameFloat - intPart; // Extract fractional part
            fractionalFrame =
                ((fractionalPart > kIntegerFrameEpsilon) &&
                 (fractionalPart < 1.0 - kIntegerFrameEpsilon));

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
                throw std::runtime_error(msg.c_str());
              }

              fractionalPart = (tsMilli - frameA->timestamp) / delta;
              seekFrameFloat = intPart + fractionalPart;
              fractionalFrame =
                  ((fractionalPart > kIntegerFrameEpsilon) &&
                   (fractionalPart < 1.0 - kIntegerFrameEpsilon));
              if (fractionalPart >= 1.0 - kIntegerFrameEpsilon)
              {
                intPart = frameB->frameNum; // the time is at frame B
              }
            }
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

            bool generatedByRife = false;
  #ifdef RIFE_SUPPORTED
            if (interpMethod == "rife" && !rifeModelFile.empty())
            {
              auto rifeRoi = hasRifeCrop ? rifeCrop : roi;
              rifeRoi.width = std::min(rifeRoi.width, frameA->width);
              rifeRoi.height = std::min(rifeRoi.height, frameA->height);
              rifeRoi.x = std::max(0, rifeRoi.x);
              rifeRoi.y = std::max(0, rifeRoi.y);
              if (rifeRoi.x + rifeRoi.width > frameA->width)
              {
                rifeRoi.x = frameA->width - rifeRoi.width;
              }
              if (rifeRoi.y + rifeRoi.height > frameA->height)
              {
                rifeRoi.y = frameA->height - rifeRoi.height;
              }

              try
              {
                auto &interpolator = rifeInterpolatorMap[rifeModelFile];
                if (!interpolator)
                {
                  interpolator = new RifeInterpolator(rifeModelFile);
                }
                cv::Mat matA(frameA->height, frameA->width, CV_8UC4,
                            (void *)frameA->data->data());
                cv::Mat matB(frameA->height, frameA->width, CV_8UC4,
                            (void *)frameB->data->data());
                cv::Rect cvCrop(rifeRoi.x, rifeRoi.y, rifeRoi.width, rifeRoi.height);
                cv::Mat resultMat = interpolator->interpolate(
                    matA, matB, static_cast<float>(fractionalPart), cvCrop,
                    debugLevel);

                // Composite the (small, fast-to-infer) interpolated crop back
                // into a full-size copy of frameA so the response keeps the
                // same width/height/linesize contract the blend path uses.
                // Downstream rendering (Video.tsx) reuses image.width/height
                // to (re)size the canvas and video-scaling state every frame,
                // so returning a crop-sized buffer here corrupts that state.
                frameInfo = std::make_shared<FrameInfo>(*frameA);
                frameInfo->data = std::make_shared<std::vector<uint8_t>>(*(frameA->data));
                cv::Mat fullMat(frameInfo->height, frameInfo->width, CV_8UC4,
                                frameInfo->data->data());
                resultMat.copyTo(fullMat(cvCrop));
                frameInfo->tsMicro =
                    frameA->tsMicro +
                    (frameB->tsMicro - frameA->tsMicro) * fractionalPart + 0.5;
                frameInfo->timestamp = (frameInfo->tsMicro + 500) / 1000;
                frameInfo->frameNum =
                    frameA->frameNum +
                    (frameB->frameNum - frameA->frameNum) * fractionalPart;
                frameInfo->roi = rifeRoi;
                generatedByRife = true;
              }
              catch (const std::exception &e)
              {
                std::cerr << "RIFE interpolation failed, falling back to blend: "
                          << e.what() << std::endl;
              }
            }
  #endif
            if (!generatedByRife)
            {
              frameInfo = generateInterpolatedFrame(frameA, frameB, fractionalPart,
                                                    roi, blend);
            }
            if (debugLevel > 1)
            {
              std::cout << __FILE__ << ":" << __LINE__
                        << " Generating interpolated frame requestedFrameNum="
                        << frameNum << " between " << frameA->frameNum << " and "
                        << frameB->frameNum << " at " << fractionalPart
                        << "% zoom=" << (hasZoom ? "true" : "false")
                        << " interpMethod=" << interpMethod
                        << " blend=" << (blend ? "true" : "false") << " motion=[" << frameInfo->motion.x << "," << frameInfo->motion.y << "," << frameInfo->motion.valid << "," << frameInfo->motion.dt << "]" << std::endl;
            }
            frameA->motion = frameInfo->motion;
            frameA->roi = frameInfo->roi;
          }
          else
          {
            std::cerr << "Failed to grab frames " << file << ": " << intPart
                      << " and " << intPart + 1 << std::endl;
            // Show whichever of the two frames could be read.
            auto available = frameA ? frameA : frameB;
            if (!available)
            {
              std::string msg = "Failed to grab frame " + std::to_string(frameNum);
              throw std::runtime_error(msg.c_str());
            }
            // Make a copy for cache purposes
            frameInfo = std::make_shared<FrameInfo>(*available);
            frameInfo->data =
                std::make_shared<std::vector<uint8_t>>(*(available->data));
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
            throw std::runtime_error(msg.c_str());
          }
        }
        // if (hasZoom) {
        //   sharpenFrame(frameInfo);
        // }
      }


      frameInfo = pruneFrame(frameInfo, prune);

      if (!saveAs.empty())
      {
        saveFrameAsPNG(frameInfo, saveAs);
      }

      if (debugLevel > 1)
      {
        std::cout << "Grabbed frame: " << frameInfo->frameNum << " ts=" << frameInfo->timestamp << " WxH=" << frameInfo->width
                  << "x" << frameInfo->height << std::endl;
      }

      // frameInfo may be a cached frame whose motion/roi later worker tasks
      // update (see frameA->motion above), so snapshot it here rather than
      // reading it from the JS thread. The pixel buffer is never modified
      // after caching, so the copy can share it.
      auto snapshot = std::make_shared<const FrameInfo>(*frameInfo);
      return [frameInfo = std::move(snapshot)](Napi::Env env) -> Napi::Value
      {
        Napi::Object ret = Napi::Object::New(env);
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
        return ret;
      };
    });
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
  std::cerr << "OpenCV runtime version: " << cv::getVersionString() << std::endl;

#ifdef __APPLE__
  triggerMacOSLocalNetworkPermission();
#endif

  return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
