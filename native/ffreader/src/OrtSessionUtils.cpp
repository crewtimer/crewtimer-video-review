#include "OrtSessionUtils.hpp"

#ifdef __APPLE__
#include <coreml_provider_factory.h>
#endif

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

Ort::Session createOrtSession(Ort::Env &env, const std::string &modelPath,
                              const char *logTag)
{
  Ort::SessionOptions options;
  options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

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

  Ort::Session session(env, modelPath.c_str(), options);
  std::cerr << logTag << ": session ready for " << modelPath << " ("
            << epName << " " << (epRequested ? "requested" : "unavailable")
            << ")" << std::endl;
  return session;
}
