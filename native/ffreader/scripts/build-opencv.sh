#!/bin/bash
set -e

# Set the base build directory
BASE_BUILD_DIR="$PWD/lib-build"
if [[ "$OSTYPE" == "cygwin" ]]; then
  BASE_BUILD_DIR=`cygpath -m  "${BASE_BUILD_DIR}"`
fi

# Determine the platform (macOS or Windows via WSL or others)
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="mac"
  CMAKE_ARCH_OPTS=-DCMAKE_OSX_ARCHITECTURES="x86_64;arm64"
elif [[ "$OSTYPE" == "cygwin" || "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OS" == "Windows"* ]]; then
  PLATFORM="win"
  CMAKE_ARCH_OPTS="-Ax64"
else
  PLATFORM="linux"
fi

# Variables
OPENCV_VERSION="4.9.0"
DOWNLOAD_DIR="${BASE_BUILD_DIR}/opencv-${OPENCV_VERSION}"
INSTALL_DIR="${BASE_BUILD_DIR}/opencv-static-${PLATFORM}"
BUILD_DIR="${DOWNLOAD_DIR}/build-${PLATFORM}"
OPENCV_URL="https://github.com/opencv/opencv/archive/${OPENCV_VERSION}.zip"

# Parse arguments
FORCE=0
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=1
  fi
done

CHECK_FILE="${INSTALL_DIR}/lib/libopencv_core.a"  # File to check for existing build
if [[ "$PLATFORM" == "win"* ]]; then
  CHECK_FILE="${INSTALL_DIR}/staticlib/opencv_video490.lib"  # File to check for existing build
fi

# Check if the library has already been built
if [ $FORCE -eq 0 ] && [ -f "$CHECK_FILE" ]; then
  echo "OpenCV static library already built. Skipping build."
  exit 0
fi

# Create the base build directory if it doesn't exist
mkdir -p "$BASE_BUILD_DIR"

# Download OpenCV if not already downloaded
if [ ! -f "${BASE_BUILD_DIR}/opencv-${OPENCV_VERSION}.zip" ]; then
  echo "Downloading OpenCV version ${OPENCV_VERSION}..."
  # wget -O "${BASE_BUILD_DIR}/${OPENCV_VERSION}.zip" "${OPENCV_URL}"
  curl -L "${OPENCV_URL}" -o "${BASE_BUILD_DIR}/opencv-${OPENCV_VERSION}.zip"
fi

# Extract OpenCV
if [ ! -d "$DOWNLOAD_DIR" ]; then
  echo "Extracting OpenCV..."
  unzip -q "${BASE_BUILD_DIR}/opencv-${OPENCV_VERSION}.zip" -d "$BASE_BUILD_DIR"
fi

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
echo "Building in ${BUILD_DIR}"

# Configure OpenCV build
echo "Configuring OpenCV for static linking..."
# #-G "Unix Makefiles"
cmake  \
      ${CMAKE_ARCH_OPTS} \
      -DCMAKE_INSTALL_PREFIX="${INSTALL_DIR}" \
      -DBUILD_DOCS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_TESTS=OFF -DBUILD_EXAMPLES=OFF \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DBUILD_ZLIB=ON -DWITH_OPENEXR=ON \
      -DWITH_IPP=OFF -DWITH_ITT=OFF \
      -DWITH_JPEG=OFF -DBUILD_JPEG=OFF -DBUILD_opencv_imgcodecs=ON \
      -DBUILD_LIST=core,imgproc,video \
      ..

# Compile and install OpenCV
echo "Building OpenCV..."
cmake --build . --parallel --config Release
# make -j4
echo "Installing OpenCV..."
cmake --install . --config Release
# make install

# Environment setup for Electron module
export OPENCV_DIR="${INSTALL_DIR}"
export PKG_CONFIG_PATH="${INSTALL_DIR}/lib/pkgconfig:$PKG_CONFIG_PATH"

echo "OpenCV static library installed at ${INSTALL_DIR}"
echo "Set PKG_CONFIG_PATH for linking in Electron module build."
