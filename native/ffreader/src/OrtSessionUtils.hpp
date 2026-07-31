#pragma once

#include <onnxruntime_cxx_api.h>

#include <string>

/**
 * Creates an ONNX Runtime session for modelPath, preferring the CoreML
 * (macOS) / DirectML (Windows) execution provider with a CPU fallback.
 * Mirrors the execution-provider selection in RifeInterpolator.cpp so every
 * ONNX model in this addon (RIFE interpolation, boat/card YOLO detection,
 * bow-number CTC reading) picks EPs the same way.
 *
 * @param logTag Short name used in the startup log line (e.g. "BoatDetector").
 */
Ort::Session createOrtSession(Ort::Env &env, const std::string &modelPath,
                              const char *logTag);
