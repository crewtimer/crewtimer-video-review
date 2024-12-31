import { getVideoScaling, setVideoScaling } from '../video/VideoSettings';
import { AppImage } from '../shared/AppTypes';

/**
 * Generate a 320x240 RGBA checkerboard pattern.
 * Each cell in the checkerboard will be 20x20 pixels.
 * Alternates between red and blue squares.
 *
 * @returns Buffer containing the image data.
 */
export function generateTestPattern(): AppImage {
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
  height: number,
): Uint8ClampedArray => {
  const sharpenKernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  const applyKernel = (
    x: number,
    y: number,
    d: Uint8ClampedArray,
    w: number,
  ): [number, number, number] => {
    const weight = (kx: number, ky: number): number =>
      sharpenKernel[(ky + 1) * 3 + (kx + 1)];
    const sum = (dx: number, dy: number): [number, number, number] => {
      const pixelIndex = (y + dy) * w + (x + dx);
      return [
        weight(dx, dy) * d[pixelIndex * 4], // R
        weight(dx, dy) * d[pixelIndex * 4 + 1], // G
        weight(dx, dy) * d[pixelIndex * 4 + 2], // B
      ];
    };

    const totalWeight = sharpenKernel.reduce((a, b) => a + b, 0) || 1;
    const [red, green, blue] = [-1, 0, 1]
      .flatMap((dy) => [-1, 0, 1].map((dx) => sum(dx, dy)))
      .reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);

    return [
      Math.min(Math.max(red / totalWeight, 0), 255),
      Math.min(Math.max(green / totalWeight, 0), 255),
      Math.min(Math.max(blue / totalWeight, 0), 255),
    ];
  };

  const newData = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const [r, g, b] = applyKernel(x, y, data, width);
      const index = (y * width + x) * 4;
      newData[index] = r;
      newData[index + 1] = g;
      newData[index + 2] = b;
    }
  }

  return newData;
};

type ScalingParams = {
  srcWidth?: number;
  srcHeight?: number;
  destWidth?: number;
  destHeight?: number;
  srcCenterPoint?: { x: number; y: number };

  zoomX?: number; // Horizontal zoom factor
  zoomY?: number; // Vertical zoom factor
};

/**
 * Assume: Draws an image onto a canvas such that:
 *  1. The image is contained (no cropping) by default.
 *  2. Additional zoom factors (zoomX, zoomY) can be applied.
 *  3. (x,y) in the source is placed in the horizontal center (x0)
 *     and, if the image is taller than the canvas, tries to center y0 vertically.
 *  4. If there's extra vertical space (scaledHeight < destHeight), we pin top at y=0.
 *  5. If offsetY is positive (i.e., there's a "gap" at the top), we shift the image up (offsetY=0).
 */
export function updateVideoScaling(scaling: ScalingParams) {
  const {
    srcWidth,
    srcHeight,
    destWidth,
    destHeight,
    srcCenterPoint,
    zoomX,
    zoomY,
  } = { ...getVideoScaling(), ...scaling };
  // 1) Compute base scale to "contain" the image
  const baseScale = Math.min(destWidth / srcWidth, destHeight / srcHeight);
  // 2) Multiply by user zoom factors
  const scaleX = baseScale * zoomX;
  const scaleY = baseScale * zoomY;

  // 3) Horizontal offset => center x0 in the destination
  //    offsetX + (x0 * scaleX) = destWidth/2
  const destX = destWidth / 2 - srcCenterPoint.x * scaleX;

  // 4) Vertical offset
  //    - If scaledHeight < destHeight, top-align (offsetY=0).
  //    - Otherwise, center y0 => offsetY + (y0*scaleY) = destHeight/2.
  //    - Also clamp to 0 if offsetY > 0 (shift image up if there's a gap at the top).
  const scaledHeight = srcHeight * scaleY;

  let destY: number;
  if (scaledHeight < destHeight) {
    // Extra vertical space => top-align
    destY = 0;
  } else {
    // Otherwise, center y0
    destY = destHeight / 2 - srcCenterPoint.y * scaleY;

    // If the calculation yields a positive offset => "gap" at the top => shift up
    if (destY > 0) {
      destY = 0;
    }
  }
  setVideoScaling({
    srcWidth,
    srcHeight,
    destWidth,
    destHeight,
    srcCenterPoint,
    zoomX,
    zoomY,
    destX,
    destY,
    scaleX,
    scaleY,
  });
}
