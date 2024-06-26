import { AppImage } from 'renderer/shared/AppTypes';

/**
 * Generate a 320x240 RGBA checkerboard pattern.
 * Each cell in the checkerboard will be 20x20 pixels.
 * Alternates between red and blue squares.
 *
 * @returns Buffer containing the image data.
 */
function generateTestPattern(): AppImage {
  const width = 1280;
  const height = 720;
  const cellSize = 20; // Size of each square in the checkerboard pattern

  // Create a buffer to hold RGBA data for each pixel
  const totalPixels = width * height;
  const buffer = new Uint8Array(totalPixels * 4); // 4 bytes per pixel

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Determine which color to use based on the current cell
      const isWhite =
        Math.floor(y / cellSize) % 2 === Math.floor(x / cellSize) % 2;
      const offset = (y * width + x) * 4;

      if (isWhite) {
        buffer[offset] = 255; // Red channel
        buffer[offset + 1] = 255; // Green channel
        buffer[offset + 2] = 255; // Blue channel
        buffer[offset + 3] = 255; // Alpha channel (fully opaque)
      } else {
        buffer[offset] = 200; // Red channel
        buffer[offset + 1] = 200; // Green channel
        buffer[offset + 2] = 200; // Blue channel
        buffer[offset + 3] = 255; // Alpha channel (fully opaque)
      }
    }
  }

  return {
    status: 'OK',
    data: buffer,
    width,
    height,
    frameNum: 1,
    numFrames: 1,
    timestamp: 1704124800000,
    fps: 60,
    file: '', // empty file will trigger a load of last selected file at startup
    fileStartTime: 1704124800000,
    fileEndTime: 1704124800000,
  };
}

export default generateTestPattern;
