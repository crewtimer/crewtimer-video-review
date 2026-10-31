#include "OrtSessionUtils.hpp"

#ifdef __APPLE__
#include <coreml_provider_factory.h>
#endif

#include <filesystem>
#include <iostream>

#ifdef _WIN32
// Declared by hand (rather than #include <dml_provider_factory.h>) to avoid
// a hard dependency on the DirectML.h / d3d12.h headers that file pulls in.
// Matches the declaration already used in RifeInterpolator.cpp.
extern "C"
{
  ORT_API_STATUS(OrtSessionOptionsAppendExecutionProvider_DML,
                _In_ OrtSessionOptions *options, int device_id);
}
#endif

namespace
{
Ort::SessionOptions makeSessionOptions()
{
  Ort::SessionOptions options;
  options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
  return options;
}
} // namespace

Ort::Session createOrtSession(Ort::Env &env, const std::string &modelPath,
                              const char *logTag)
{
  Ort::SessionOptions options = makeSessionOptions();

  bool epRequested = false;
  const char *epName =
#if defined(__APPLE__)
      "CoreML";
#elif defined(_WIN32)
      "DirectML";
#else
      "(none)";
#endif
#if defined(__APPLE__)
  try
  {
    uint32_t coremlFlags = COREML_FLAG_USE_CPU_AND_GPU;
    Ort::ThrowOnError(OrtSessionOptionsAppendExecutionProvider_CoreML(
        options, coremlFlags));
    epRequested = true;
  }
  catch (const Ort::Exception &e)
  {
    std::cerr << logTag << ": CoreML EP unavailable (" << e.what()
              << "), using CPU" << std::endl;
  }
#elif defined(_WIN32)
  try
  {
    // DirectML does not support memory-pattern optimization or parallel
    // session execution. Both must be configured before registering the EP.
    options.DisableMemPattern();
    options.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
    Ort::ThrowOnError(
        OrtSessionOptionsAppendExecutionProvider_DML(options, 0));
    epRequested = true;
  }
  catch (const Ort::Exception &e)
  {
    std::cerr << logTag << ": DirectML EP unavailable (" << e.what()
              << "), using CPU" << std::endl;
  }
#endif

  // ONNX Runtime paths use wchar_t on Windows and char elsewhere. Convert
  // the UTF-8 path to the platform-native filesystem representation.
  const std::filesystem::path nativeModelPath =
      std::filesystem::u8path(modelPath);
  if (epRequested)
  {
    // A registered provider can still fail while compiling the graph, e.g.
    // DirectML on a virtual GPU such as Parallels on Apple silicon.
    try
    {
      Ort::Session session(env, nativeModelPath.c_str(), options);
      std::cerr << logTag << ": session ready for " << modelPath << " ("
                << epName << " requested)" << std::endl;
      return session;
    }
    catch (const Ort::Exception &e)
    {
      std::cerr << logTag << ": " << epName << " session failed ("
                << e.what() << "), using CPU" << std::endl;
    }
  }
  Ort::SessionOptions cpuOptions = makeSessionOptions();
  Ort::Session session(env, nativeModelPath.c_str(), cpuOptions);
  std::cerr << logTag << ": session ready for " << modelPath << " (CPU)"
            << std::endl;
  return session;
}
