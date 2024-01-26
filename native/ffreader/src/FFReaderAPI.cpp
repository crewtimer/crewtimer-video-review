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

static std::map<std::string, std::unique_ptr<FFVideoReader>> videoReaders;

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
      std::cerr << "File already open, using existing file" << std::endl;
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
    auto frameNum = args.Get("frameNum").As<Napi::Number>().Int64Value();
    auto ffreader = videoReaders.find(file);
    if (ffreader == videoReaders.end()) {
      std::cerr << "File not open opening " << file << std::endl;
      Napi::TypeError::New(env, "File not open").ThrowAsJavaScriptException();
      return ret;
    }
    auto rgbaFrame = ffreader->second->getRGBAFrame(frameNum);
    if (!rgbaFrame) {
      Napi::TypeError::New(env, "Failed to grab frame")
          .ThrowAsJavaScriptException();
      return ret;
    }
    auto totalBytes = rgbaFrame->width * rgbaFrame->height * 4;
    ret.Set("data",
            Napi::Buffer<uint8_t>::Copy(env, rgbaFrame->data[0], totalBytes));
    ret.Set("width", Napi::Number::New(env, rgbaFrame->width));
    ret.Set("height", Napi::Number::New(env, rgbaFrame->height));
    ret.Set("totalBytes", Napi::Number::New(env, totalBytes));
    ret.Set("frameNum", Napi::Number::New(env, frameNum));
    ret.Set("numFrames",
            Napi::Number::New(env, ffreader->second->getTotalFrames()));
    ret.Set("fps", Napi::Number::New(env, ffreader->second->getFps()));
    ret.Set("status", Napi::String::New(env, "OK"));
    ret.Set("file", Napi::String::New(env, file));
    ret.Set("timestamp", Napi::Number::New(env, 0));
    // std::cout << "Grabbed frame: " << frameNum << " WxH=" << rgbaFrame->width
    //           << "x" << rgbaFrame->height << std::endl;
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
