#!/bin/bash
set -e

# Vendors the official prebuilt ONNX Runtime C/C++ SDK (CoreML EP included in
# the macOS dylib) into lib-build/onnxruntime-static-<platform>, mirroring the
# layout build-opencv.sh/build-ffmpeg.sh use. Unlike those, there is no source
# build here -- Microsoft ships ready-to-link binaries for macOS.

BASE_BUILD_DIR="$PWD/lib-build"

if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="mac"
  ORT_ARCH="osx-arm64"
else
  echo "build-onnxruntime.sh currently only supports macOS (RIFE/CoreML EP is mac-only)."
  exit 0
fi

ORT_VERSION="1.28.0"
ORT_PKG="onnxruntime-${ORT_ARCH}-${ORT_VERSION}"
ORT_URL="https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/${ORT_PKG}.tgz"
INSTALL_DIR="${BASE_BUILD_DIR}/onnxruntime-static-${PLATFORM}"
VERSION_FILE="${INSTALL_DIR}/.onnxruntime-${ORT_VERSION}"

FORCE=0
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=1
  fi
done

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
