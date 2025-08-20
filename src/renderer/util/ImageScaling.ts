import { getVideoScaling, setVideoScaling } from '../video/VideoSettings';

type ScalingParams = {
  srcWidth?: number;
  srcHeight?: number;
  destWidth?: number;
  destHeight?: number;
  srcCenterPoint?: { x: number; y: number };
  srcClickPoint?: { x: number; y: number };

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
    srcClickPoint,
    zoomX,
    zoomY,
  } = { ...getVideoScaling(), ...scaling };
  // 1) Compute base scale to "contain" the image
  const baseScale = Math.min(destWidth / srcWidth, destHeight / srcHeight);
  // 2) Multiply by user zoom factors
  const scaleX = baseScale * zoomX * zoomY; // zoomY is the 'base' scale but allow additional x axis zoom.
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
    destImageWidth: srcWidth * scaleY,
    destImageHeight: srcHeight * scaleX,
    srcCenterPoint,
    srcClickPoint,
    zoomX,
    zoomY,
    destX,
    destY,
    scaleX,
    scaleY,
  });
}
