#!/bin/bash
set -e

# Vendors the official prebuilt ONNX Runtime C/C++ SDK into
# lib-build/onnxruntime-static-<platform>, mirroring the layout
# build-opencv.sh/build-ffmpeg.sh use. Unlike those, there is no source
# build here -- Microsoft ships ready-to-link binaries.
#
# macOS: CoreML EP is compiled into the single libonnxruntime dylib.
# Windows: DirectML EP build. This does NOT bundle DirectML.dll -- it relies
#   on the OS-supplied copy (Windows 10 1903+ / Windows 11 ship it in
#   System32). Fetched from the Microsoft.ML.OnnxRuntime.DirectML NuGet
#   package (a .nupkg is just a zip).

BASE_BUILD_DIR="$PWD/lib-build"

if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="mac"
elif [[ "$OSTYPE" == "cygwin" || "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OS" == "Windows"* ]]; then
  PLATFORM="win"
else
  echo "build-onnxruntime.sh currently only supports macOS and Windows."
  exit 0
fi

INSTALL_DIR="${BASE_BUILD_DIR}/onnxruntime-static-${PLATFORM}"

FORCE=0
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=1
  fi
done

if [[ "$PLATFORM" == "mac" ]]; then
  ORT_VERSION="1.28.0"
  ORT_ARCH="osx-arm64"
  ORT_PKG="onnxruntime-${ORT_ARCH}-${ORT_VERSION}"
  ORT_URL="https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/${ORT_PKG}.tgz"
  VERSION_FILE="${INSTALL_DIR}/.onnxruntime-${ORT_VERSION}"

  if [ $FORCE -eq 0 ] && [ -f "$VERSION_FILE" ]; then
    echo "ONNX Runtime ${ORT_VERSION} already vendored. Skipping."
    exit 0
  fi

  mkdir -p "$BASE_BUILD_DIR"

  if [ ! -f "${BASE_BUILD_DIR}/${ORT_PKG}.tgz" ]; then
    echo "Downloading ONNX Runtime ${ORT_VERSION} (${ORT_ARCH})..."
    curl -L "${ORT_URL}" -o "${BASE_BUILD_DIR}/${ORT_PKG}.tgz"
  fi

  echo "Extracting ONNX Runtime..."
  rm -rf "${BASE_BUILD_DIR:?}/${ORT_PKG}"
  tar -xzf "${BASE_BUILD_DIR}/${ORT_PKG}.tgz" -C "$BASE_BUILD_DIR"

  echo "Installing headers + dylib to ${INSTALL_DIR}..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "${INSTALL_DIR}/include" "${INSTALL_DIR}/lib"
  cp -R "${BASE_BUILD_DIR}/${ORT_PKG}/include/." "${INSTALL_DIR}/include/"
  cp "${BASE_BUILD_DIR}/${ORT_PKG}/lib/libonnxruntime.${ORT_VERSION}.dylib" "${INSTALL_DIR}/lib/"
  ln -sf "libonnxruntime.${ORT_VERSION}.dylib" "${INSTALL_DIR}/lib/libonnxruntime.1.dylib"
  ln -sf "libonnxruntime.${ORT_VERSION}.dylib" "${INSTALL_DIR}/lib/libonnxruntime.dylib"

  touch "$VERSION_FILE"
  echo "ONNX Runtime ${ORT_VERSION} installed at ${INSTALL_DIR}"
fi

if [[ "$PLATFORM" == "win" ]]; then
  # DirectML-enabled builds lag the plain win-x64 releases and are only
  # published via NuGet, not as a GitHub release asset.
  ORT_VERSION="1.24.4"
  ORT_PKG="microsoft.ml.onnxruntime.directml.${ORT_VERSION}"
  ORT_URL="https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/${ORT_VERSION}/${ORT_PKG}.nupkg"
  VERSION_FILE="${INSTALL_DIR}/.onnxruntime-${ORT_VERSION}"

  if [[ "$OSTYPE" == "cygwin" ]]; then
    BASE_BUILD_DIR=$(cygpath -m "${BASE_BUILD_DIR}")
    INSTALL_DIR=$(cygpath -m "${INSTALL_DIR}")
    VERSION_FILE=$(cygpath -m "${VERSION_FILE}")
  fi

  if [ $FORCE -eq 0 ] && [ -f "$VERSION_FILE" ]; then
    echo "ONNX Runtime DirectML ${ORT_VERSION} already vendored. Skipping."
    exit 0
  fi

  mkdir -p "$BASE_BUILD_DIR"

  if [ ! -f "${BASE_BUILD_DIR}/${ORT_PKG}.nupkg" ]; then
    echo "Downloading ONNX Runtime DirectML ${ORT_VERSION}..."
    curl -L "${ORT_URL}" -o "${BASE_BUILD_DIR}/${ORT_PKG}.nupkg"
  fi

  echo "Extracting ONNX Runtime DirectML package..."
  EXTRACT_DIR="${BASE_BUILD_DIR}/${ORT_PKG}"
  rm -rf "${EXTRACT_DIR:?}"
  mkdir -p "$EXTRACT_DIR"
  unzip -q "${BASE_BUILD_DIR}/${ORT_PKG}.nupkg" -d "$EXTRACT_DIR"

  echo "Installing headers + dll/lib to ${INSTALL_DIR}..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "${INSTALL_DIR}/include" "${INSTALL_DIR}/lib"
  cp -R "${EXTRACT_DIR}/build/native/include/." "${INSTALL_DIR}/include/"
  cp "${EXTRACT_DIR}/runtimes/win-x64/native/onnxruntime.dll" "${INSTALL_DIR}/lib/"
  cp "${EXTRACT_DIR}/runtimes/win-x64/native/onnxruntime.lib" "${INSTALL_DIR}/lib/"
  cp "${EXTRACT_DIR}/runtimes/win-x64/native/onnxruntime_providers_shared.dll" "${INSTALL_DIR}/lib/"

  touch "$VERSION_FILE"
  echo "ONNX Runtime DirectML ${ORT_VERSION} installed at ${INSTALL_DIR}"
  echo "Note: DirectML.dll itself is NOT bundled -- the DirectML EP loads the"
  echo "OS-supplied copy (Windows 10 1903+ / Windows 11) at runtime."
fi
