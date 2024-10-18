#!/bin/bash

# Set the base build directory
BASE_BUILD_DIR="$PWD/lib-build"

# Determine the platform (macOS or Windows via WSL or others)
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="mac"
elif [[ "$OSTYPE" == "cygwin" || "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  PLATFORM="win"
else
  PLATFORM="linux"
fi

# Variables
OPENCV_VERSION="4.9.0"
INSTALL_DIR="${BASE_BUILD_DIR}/opencv-static-${PLATFORM}"
BUILD_DIR="${BASE_BUILD_DIR}/opencv-build-${PLATFORM}"
OPENCV_URL="https://github.com/opencv/opencv/archive/${OPENCV_VERSION}.zip"
DOWNLOAD_DIR="${BASE_BUILD_DIR}/opencv-${OPENCV_VERSION}"
CHECK_FILE="${INSTALL_DIR}/lib/libopencv_core.a"  # File to check for existing build

# Check if the library has already been built
if [ -f "$CHECK_FILE" ]; then
  echo "OpenCV static library already built. Skipping build."
  exit 0
fi

# Create the base build directory if it doesn't exist
mkdir -p "$BASE_BUILD_DIR"

# Download OpenCV if not already downloaded
if [ ! -f "${BASE_BUILD_DIR}/${OPENCV_VERSION}.zip" ]; then
  echo "Downloading OpenCV version ${OPENCV_VERSION}..."
  wget -O "${BASE_BUILD_DIR}/${OPENCV_VERSION}.zip" "${OPENCV_URL}"
fi

# Extract OpenCV
if [ ! -d "$DOWNLOAD_DIR" ]; then
  echo "Extracting OpenCV..."
  unzip "${BASE_BUILD_DIR}/${OPENCV_VERSION}.zip" -d "$BASE_BUILD_DIR"
fi

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Configure OpenCV build
echo "Configuring OpenCV for static linking..."
cmake -DCMAKE_INSTALL_PREFIX="${INSTALL_DIR}" \
      -DBUILD_DOCS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_TESTS=OFF -DBUILD_EXAMPLES=OFF \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DBUILD_JPEG=ON -DBUILD_PNG=ON -DBUILD_TIFF=ON \
      -DBUILD_ZLIB=ON -DWITH_OPENEXR=ON \
      -DWITH_IPP=OFF -DWITH_ITT=OFF \
      "${DOWNLOAD_DIR}"

# Compile and install OpenCV
echo "Building OpenCV..."
make -j$(sysctl -n hw.physicalcpu)
echo "Installing OpenCV..."
make install

# Environment setup for Electron module
export OPENCV_DIR="${INSTALL_DIR}"
export PKG_CONFIG_PATH="${INSTALL_DIR}/lib/pkgconfig:$PKG_CONFIG_PATH"

echo "OpenCV static library installed at ${INSTALL_DIR}"
echo "Set PKG_CONFIG_PATH for linking in Electron module build."
