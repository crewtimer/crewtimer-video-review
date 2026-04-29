#!/bin/bash
set -e

# Set the base build directory
BASE_BUILD_DIR="$PWD/lib-build"
if [[ "$OSTYPE" == "cygwin" ]]; then
  BASE_BUILD_DIR=`cygpath -m "${BASE_BUILD_DIR}"`
  echo BASE_BUILD_DIR=${BASE_BUILD_DIR}
elif [[ "$OSTYPE" == "msys" ]]; then
  # Convert /c/path -> C:/path. Don't use `pwd -W` here: the dir may not exist
  # yet (mkdir -p happens further down) and `cd` to it would silently no-op.
  BASE_BUILD_DIR=$(echo "$BASE_BUILD_DIR" | sed -E 's|^/([a-zA-Z])/|\1:/|')
  echo BASE_BUILD_DIR=${BASE_BUILD_DIR}
fi

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

# Parse arguments
FORCE=0
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=1
  fi
done

# Check if the library has already been built (unless --force is given)
if [ $FORCE -eq 0 ] && [ -f "$CHECK_FILE" ]; then
  echo "FFMPEG static library $CHECK_FILE already built. Skipping build without --force."
  exit 0
fi

# Create the base build directory if it doesn't exist
mkdir -p "$BASE_BUILD_DIR"

# Install vcpkg if not already present so we can easily install zlib
if [[ "$PLATFORM" == "win" ]]; then
  if [ ! -d "$BASE_BUILD_DIR/vcpkg" ]; then
    echo "vcpkg not found in $BASE_BUILD_DIR. Installing vcpkg..."
    git clone https://github.com/microsoft/vcpkg.git "$BASE_BUILD_DIR/vcpkg"
    (cd "$BASE_BUILD_DIR/vcpkg" && ./bootstrap-vcpkg.sh)
  else
    echo "vcpkg already installed in $BASE_BUILD_DIR/vcpkg."
  fi
  VCPKG_LIB_DIR="$BASE_BUILD_DIR/vcpkg/installed/x64-windows-static/lib"
  if [ ! -f "$VCPKG_LIB_DIR/zlib.lib" ] && [ ! -f "$VCPKG_LIB_DIR/zs.lib" ]; then
     (cd "$BASE_BUILD_DIR/vcpkg" && ./vcpkg install zlib:x64-windows-static)
  fi
  # Recent vcpkg versions install zlib as zs.lib (renamed to avoid clashes).
  # FFmpeg's configure looks specifically for zlib.lib, so alias it.
  if [ -f "$VCPKG_LIB_DIR/zs.lib" ] && [ ! -f "$VCPKG_LIB_DIR/zlib.lib" ]; then
    cp "$VCPKG_LIB_DIR/zs.lib" "$VCPKG_LIB_DIR/zlib.lib"
  fi

  # ffmpeg configure needs to be able to find these packages
  export "LIB=$LIB;$BASE_BUILD_DIR/vcpkg/installed/x64-windows-static/lib"
  export "INCLUDE=$INCLUDE;$BASE_BUILD_DIR/vcpkg/installed/x64-windows-static/include"
fi

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

# Configure FFMPEG build
cd "${BASE_BUILD_DIR}/FFmpeg-${FFMPEG_VERSION}"
pwd
for ARCH in $ARCH_FLAGS; do
    if [ $FORCE -eq 0 ] &&[ -f "${INSTALL_DIR}-${ARCH}/lib/libswscale.a" ]; then
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

    echo "CONFIGURE_OPTIONS=${CONFIGURE_OPTIONS[@]}"
    echo "PWD=$PWD"

    echo "Configuring FFMPEG for static linking and $ARCH..."
    ./configure --prefix=${INSTALL_DIR}-${ARCH} \
        ${PLATFORM_FLAGS} \
        "${CONFIGURE_OPTIONS[@]}" \
        --disable-programs \
        --enable-static --enable-gpl --disable-network --disable-doc \
        --disable-avdevice --disable-swresample --disable-postproc --disable-avfilter \
        --enable-encoder=png --enable-zlib

    # Compile and install FFMPEG
    echo "Building FFMPEG..."
    make -j4

    echo "Installing FFMPEG..."
    make install

    make clean && make distclean
done

cp -a "${INSTALL_DIR}-x86_64/." "${INSTALL_DIR}"
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
