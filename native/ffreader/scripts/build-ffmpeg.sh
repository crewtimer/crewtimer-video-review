#!/bin/bash
set -e

# Set the base build directory
BASE_BUILD_DIR="$PWD/lib-build"

# Determine the platform (macOS or Windows via WSL or others)
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="mac"
  TARGET="darwin"
  ARCH_FLAGS="x86_64 arm64"
elif [[ "$OSTYPE" == "cygwin" || "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OS" == "Windows"* ]]; then
  PLATFORM="win"
  TARGET="win64"
  ARCH_FLAGS="x86_64"
  #PLATFORM_FLAGS="--toolchain=msvc --disable-x86asm "
  PLATFORM_FLAGS="--toolchain=msvc"
else
  PLATFORM="linux"
fi

# Variables
FFMPEG_VERSION="n7.1"
DOWNLOAD_DIR="${BASE_BUILD_DIR}/ffmpeg-${FFMPEG_VERSION}"
INSTALL_DIR="${BASE_BUILD_DIR}/ffmpeg-static-${PLATFORM}"
BUILD_DIR="${DOWNLOAD_DIR}/build-${PLATFORM}"
FFMPEG_URL="https://github.com/FFmpeg/FFmpeg/archive/refs/tags/${FFMPEG_VERSION}.zip"
CHECK_FILE="${INSTALL_DIR}/lib/libswscale.a"  # File to check for existing build

if [[ "$OSTYPE" == "cygwin" ]]; then
  # INSTALL_DIR=`cygdrive "${INSTALL_DIR}"`
  echo INSTALL_DIR=${INSTALL_DIR}
fi

# Check if the library has already been built
if [ -f "$CHECK_FILE" ]; then
  echo "FFMPEG static library already built. Skipping build."
  exit 0
fi

# Create the base build directory if it doesn't exist
mkdir -p "$BASE_BUILD_DIR"

# Download FFMPEG if not already downloaded
if [ ! -f "${BASE_BUILD_DIR}/ffmpeg-${FFMPEG_VERSION}.zip" ]; then
  echo "Downloading FFMPEG version ${FFMPEG_VERSION}..."
  # wget -O "${BASE_BUILD_DIR}/${FFMPEG_VERSION}.zip" "${FFMPEG_URL}"
  curl -L "${FFMPEG_URL}" -o "${BASE_BUILD_DIR}/ffmpeg-${FFMPEG_VERSION}.zip"
fi

# Extract FFMPEG
if [ ! -d "$DOWNLOAD_DIR" ]; then
  echo "Extracting FFMPEG..."
  unzip -q "${BASE_BUILD_DIR}/ffmpeg-${FFMPEG_VERSION}.zip" -d "$BASE_BUILD_DIR"
fi

# Create build directory
# mkdir -p "$BUILD_DIR"
# cd "$BUILD_DIR"
# echo "Building in ${BUILD_DIR}"

# Configure FFMPEG build
cd "${BASE_BUILD_DIR}/FFmpeg-${FFMPEG_VERSION}"
pwd
for ARCH in $ARCH_FLAGS; do
    if [ -f "${INSTALL_DIR}-${ARCH}/lib/libswscale.a" ]; then
      continue;
    fi
    if [[ "$PLATFORM" == "mac" ]]; then
      CONFIGURE_OPTIONS=(
        --enable-cross-compile
        --arch="$ARCH"
        --extra-cflags="-arch $ARCH"
        --extra-ldflags="-arch $ARCH"
      )
    fi

    echo "Configuring FFMPEG for static linking and $ARCH..."
    ./configure --prefix=${INSTALL_DIR}-${ARCH} \
        ${PLATFORM_FLAGS} \
        "${CONFIGURE_OPTIONS[@]}" \
        --enable-static --enable-gpl --disable-network --disable-programs --disable-doc \
        --disable-avdevice --disable-swresample --disable-postproc --disable-avfilter \
        --disable-doc

    # Compile and install FFMPEG
    echo "Building FFMPEG..."
    make -j4
    
    echo "Installing FFMPEG..."
    make install

    make clean && make distclean
done

cp -a "${INSTALL_DIR}-x86_64/" "${INSTALL_DIR}"
# rm "${INSTALL_DIR}/lib/"*.a
for file in "${INSTALL_DIR}/lib/"*.a; do
    file=`basename "$file"`
    if [[ "$PLATFORM" == "mac" ]]; then
        lipo -create -arch arm64 "${INSTALL_DIR}-arm64/lib/$file" -arch x86_64 "${INSTALL_DIR}-x86_64/lib/$file" -output "${INSTALL_DIR}/lib/$file"
    fi
done

# Environment setup for Electron module
export FFMPEG_DIR="${INSTALL_DIR}"

echo "FFMPEG static library installed at ${INSTALL_DIR}"
