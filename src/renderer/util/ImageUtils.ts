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
    tsMicro: 1704124800000000,
    fps: 60,
    tzOffset: -new Date().getTimezoneOffset(),
    file: '', // empty file will trigger a load of last selected file at startup
    fileStartTime: 1704124800000000,
    fileEndTime: 1704124800000000,
    motion: { x: 0, y: 0, dt: 0, valid: false },
  };
}

export const sharpenImageData = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray => {
  const sharpenKernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  const applyKernel = (
    x: number,
    y: number,
    data: Uint8ClampedArray,
    width: number
  ): [number, number, number] => {
    const weight = (kx: number, ky: number): number =>
      sharpenKernel[(ky + 1) * 3 + (kx + 1)];
    const sum = (dx: number, dy: number): [number, number, number] => {
      const pixelIndex = (y + dy) * width + (x + dx);
      return [
        weight(dx, dy) * data[pixelIndex * 4], // R
        weight(dx, dy) * data[pixelIndex * 4 + 1], // G
        weight(dx, dy) * data[pixelIndex * 4 + 2], // B
      ];
    };

    const totalWeight = sharpenKernel.reduce((a, b) => a + b, 0) || 1;
    const [r, g, b] = [-1, 0, 1]
      .flatMap((dy) => [-1, 0, 1].map((dx) => sum(dx, dy)))
      .reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);

    return [
      Math.min(Math.max(r / totalWeight, 0), 255),
      Math.min(Math.max(g / totalWeight, 0), 255),
      Math.min(Math.max(b / totalWeight, 0), 255),
    ];
  };

  const newData = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const [r, g, b] = applyKernel(x, y, data, width);
      const index = (y * width + x) * 4;
      newData[index] = r;
      newData[index + 1] = g;
      newData[index + 2] = b;
    }
  }

  return newData;
};

export default generateTestPattern;
