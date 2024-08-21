import { Rect } from 'renderer/shared/AppTypes';
import { getAutoZoomPending } from './Video';
import { getDirList, requestVideoFrame } from './VideoFileUtils';
import {
  Dir,
  getHyperZoomFactor,
  getImage,
  getSelectedIndex,
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoScaling,
  getVideoSettings,
  setSelectedIndex,
  setVideoFile,
  setVideoFrameNum,
  VideoScaling,
} from './VideoSettings';

/**
 * Draws text on the canvas with specified alignment and position relative to a horizontal line.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {string} text - The text to be drawn.
 * @param {number} fontSize - The size of text to be drawn.
 * @param {number} x - The x-coordinate for the text placement.
 * @param {number} y - The y-coordinate for the horizontal line around which the text is aligned.
 * @param {'above' | 'below' | 'center'} position - The position of the text relative to the horizontal line ('above', 'below', or 'center').
 * @param {'left' | 'center' | 'right'} align - The alignment of the text relative to the x-coordinate ('left', 'center', or 'right').
 */
export const drawText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  x: number,
  y: number,
  position: 'above' | 'below' | 'center',
  align: 'left' | 'center' | 'right'
) => {
  ctx.font = `${Math.trunc(fontSize)}px Arial`;
  const textSize = ctx.measureText(text);
  const padding = 12;

  // Adjust X-Coordinate for Alignment
  let textX: number;
  let rectX: number;
  switch (align) {
    case 'center':
      textX = x - textSize.width / 2;
      break;
    case 'right':
      textX = x - textSize.width - padding / 2 - 2;
      break;
    default: // 'left'
      textX = x + padding / 2 + 2;
      break;
  }
  rectX = textX - padding / 2;

  // Adjust Y-Coordinate for Position
  let rectY: number;
  let textY: number;
  if (position === 'above') {
    rectY =
      y -
      textSize.actualBoundingBoxAscent -
      padding -
      padding / 2 -
      textSize.actualBoundingBoxDescent;
    textY = y - padding - textSize.actualBoundingBoxDescent;
  } else if (position === 'below') {
    rectY = y + padding / 2;
    textY = rectY + textSize.actualBoundingBoxAscent + padding / 2;
  } else {
    // 'center'
    rectY =
      y -
      (textSize.actualBoundingBoxAscent +
        textSize.actualBoundingBoxDescent +
        padding) /
        2;
    textY =
      y +
      (textSize.actualBoundingBoxAscent - textSize.actualBoundingBoxDescent) /
        2;
  }

  const rectWidth = textSize.width + padding;
  const rectHeight =
    textSize.actualBoundingBoxAscent +
    textSize.actualBoundingBoxDescent +
    padding;

  // Draw the background rectangle
  ctx.fillStyle = '#ffffff60';
  ctx.fillRect(rectX, rectY, rectWidth, rectHeight);

  // Draw the text
  ctx.fillStyle = 'black';
  ctx.fillText(text, textX, textY);
};

// Define types for points and lines for better type checking and readability
export type Point = { x: number; y: number };
export type Line = { pt1: Point; pt2: Point };

/**
 * Finds the closest line to a given point and its position relative to the point.
 * Can filter the search based on whether the line should be above or below the point.
 *
 * @param point - The reference point to measure distance from.
 * @param lines - An array of lines to consider in the search.
 * @param desiredPosition - Specifies the desired position of the line relative to the point ('above', 'below', 'any').
 * @returns The closest line and its position relative to the point ('above', 'below', 'on').
 */
export function findClosestLineAndPosition(
  point: Point,
  lines: Line[],
  desiredPosition: 'above' | 'below' | 'any'
): { closestLine: number; position: string } {
  let minDistance = Number.MAX_VALUE;
  let closestLine: number = -1;
  let position: 'above' | 'below' | 'on' = 'on';

  lines.forEach((line, index) => {
    const currentLinePosition = pointPositionRelativeToLine(point, line);

    // Skip lines that do not match the desired position if it's specified as 'above' or 'below'
    if (desiredPosition !== 'any' && currentLinePosition !== desiredPosition) {
      return;
    }

    const distance = perpendicularDistance(point, line);
    if (distance < minDistance) {
      minDistance = distance;
      closestLine = index;
      position = currentLinePosition;
    }
  });

  return { closestLine, position };
}

/**
 * Calculates the perpendicular distance from a point to a line.
 *
 * @param point - The point from which to measure distance.
 * @param line - The line to measure distance to.
 * @returns The perpendicular distance from the point to the line.
 */
function perpendicularDistance(point: Point, line: Line): number {
  const { pt1, pt2 } = line;
  return (
    Math.abs(
      (pt2.x - pt1.x) * (pt1.y - point.y) - (pt1.x - point.x) * (pt2.y - pt1.y)
    ) / Math.sqrt((pt2.x - pt1.x) ** 2 + (pt2.y - pt1.y) ** 2)
  );
}

/**
 * Determines the position of a point relative to a line (above, below, or on the line).
 *
 * @param point - The point to check.
 * @param line - The line to compare against.
 * @returns A string indicating whether the point is 'above', 'below', or 'on' the line.
 */
function pointPositionRelativeToLine(
  point: Point,
  line: Line
): 'above' | 'below' | 'on' {
  const { pt1, pt2 } = line;
  const crossProduct =
    (pt2.x - pt1.x) * (point.y - pt1.y) - (pt2.y - pt1.y) * (point.x - pt1.x);

  if (crossProduct > 0) return 'below'; // Note for canvas y=0 is top
  else if (crossProduct < 0) return 'above';
  else return 'on';
}

export const triggerFileSplit = () => {
  const msg = {
    cmd: 'split-video',
    src: 'crewtimer-video-review',
    ts: new Date().getTime(),
  };
  window.VideoUtils.sendMulticast(JSON.stringify(msg), '239.215.23.42', 52342);
};

export const notifiyGuideChanged = () => {
  const videoSettings = getVideoSettings();
  const vert = videoSettings.guides.find((guide) => guide.dir === Dir.Vert);
  if (!vert) {
    return;
  }
  const msg = {
    cmd: 'guide-config',
    src: 'crewtimer-video-review',
    ts: new Date().getTime(),
    guide: { pt1: vert.pt1, pt2: vert.pt2 },
  };
  window.VideoUtils.sendMulticast(JSON.stringify(msg), '239.215.23.42', 52342);
};

// // Example usage
// const lines: Line[] = [
//     { pt1: { x: 0, y: 0 }, pt2: { x: 10, y: 10 } },
//     { pt1: { x: 5, y: 0 }, pt2: { x: 15, y: 10 } },
//     // Add more lines as needed
// ];
// const point: Point = { x: 5, y: 5 };
// const desiredPosition = 'above'; // Can be 'above', 'below', or 'any'

// const { closestLine, position } = findClosestLineAndPosition(point, lines, desiredPosition);
// if (closestLine) {
//     console.log(`Closest line: from (${closestLine.pt1.x},${closestLine.pt1.y}) to (${closestLine.pt2.x},${closestLine.pt2.y})`);
//     console.log(`Position: ${position}`);
// } else {
//     console.log('No line found matching the criteria.');
// }

export function extractTime(fileName: string) {
  let name = fileName.replace(/[:\-_]/g, '').replace(/.*\//, ''); // strip path
  const lastIndex = name.lastIndexOf('.');

  // If a period is found, return the substring after it
  if (lastIndex > -1) {
    name = name.substring(0, lastIndex);
  }

  // Last 6 chars should be HHMMSS
  const match = name.match(/(\d{6})$/);
  if (match) {
    // Extract the last 6 characters from the string
    const timeStr = name.slice(-6);
    // Insert colons to format as HH:MM:SS
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(
      4,
      6
    )}`;
  } else {
    return '00:00:00';
  }
}

/**
 * Parses a time string in HH:MM:SS.sss format to seconds.
 * @param time - A string representing time in HH:MM:SS.sss format.
 * @returns The time converted to seconds.
 */
export const parseTimeToSeconds = (time: string): number => {
  const [hours, minutes, seconds] = time.split(':').map(parseFloat);
  const secs = hours * 3600 + minutes * 60 + seconds;
  return secs;
};

export function formatSecondsAsTime(secondsInput: number): string {
  const hours = Math.floor(secondsInput / 3600);
  const minutes = Math.floor((secondsInput % 3600) / 60);
  const seconds = secondsInput % 60;

  const paddedHours = hours.toString().padStart(2, '0');
  const paddedMinutes = minutes.toString().padStart(2, '0');
  const paddedSeconds = seconds.toString().padStart(2, '0');

  return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
}

function combineCanvasLayers(
  layers: (HTMLCanvasElement | null | undefined)[],
  xOffset: number,
  yOffset: number,
  width: number,
  height: number
): HTMLCanvasElement {
  const combinedCanvas = document.createElement('canvas');
  const context = combinedCanvas.getContext('2d');

  if (!context) throw new Error('Failed to get canvas context');

  // Set the dimensions of the combined canvas to match the specified width and height
  combinedCanvas.width = width;
  combinedCanvas.height = height;

  // Draw the specified area of each layer onto the combined canvas
  layers.forEach((layer) => {
    // Adjusted to draw only the specified part of the source canvas
    if (layer) {
      context.drawImage(
        layer,
        xOffset,
        yOffset,
        width,
        height,
        0,
        0,
        width,
        height
      );
      // context.drawImage(layer, 0, 0);
    }
  });

  return combinedCanvas;
}

export function downloadCanvasImage(
  combinedCanvas: HTMLCanvasElement,
  filename: string = 'screenshot.png'
): void {
  // Create an 'a' element for the download
  const link = document.createElement('a');
  link.download = filename;

  // Convert the canvas to a data URL and set it as the link's href
  link.href = combinedCanvas.toDataURL('image/png');

  // Trigger the download
  document.body.appendChild(link); // Append link to body temporarily to make it work on Firefox
  link.click();
  document.body.removeChild(link); // Remove the link when done
}

export const downloadImageFromCanvasLayers = (
  filename: string,
  layers: (HTMLCanvasElement | null | undefined)[],
  xOffset: number,
  yOffset: number,
  width: number,
  height: number
) => {
  // Combine the layers and initiate the download
  const combinedCanvas = combineCanvasLayers(
    layers,
    xOffset,
    yOffset,
    width,
    height
  );
  downloadCanvasImage(combinedCanvas, filename);
};

export const moveToFileIndex = (
  index: number,
  seekPercent: number,
  fromClick: boolean
) => {
  const dirList = getDirList();
  index = Math.max(0, Math.min(index, dirList.length - 1));
  const videoFile = dirList[index];
  setSelectedIndex(index);
  setVideoFile(videoFile);
  requestVideoFrame({ videoFile, seekPercent, fromClick });
};
export const prevFile = () => {
  moveToFileIndex(getSelectedIndex() - 1, 1, true);
};
export const nextFile = () => {
  moveToFileIndex(getSelectedIndex() + 1, 0, true);
};
export const moveToFrame = (
  frameNum: number,
  offset?: number,
  blend: boolean = true
) => {
  const image = getImage();
  if (frameNum < 1) {
    prevFile();
  } else if (frameNum > getImage().numFrames) {
    nextFile();
  } else {
    const videoScaling = getVideoScaling();
    const zoomFactor = videoScaling.zoom;
    const hyperZoomFactor = getHyperZoomFactor();

    if (offset !== undefined) {
      if (zoomFactor < 3 || hyperZoomFactor === 0) {
        frameNum = Math.trunc(frameNum) + offset; //Math.round(frameNum + offset);
      } else {
        frameNum = frameNum + (offset * image.fps * hyperZoomFactor) / 1000;
      }
    }

    setVideoFrameNum(frameNum);
    let zoom: Rect | undefined;

    // If we have an auto-zoom request pending, use those coords for the
    // frame velocity calc.  Otherwise use a grid around the finish line
    const autoZoomCoords = getAutoZoomPending();

    if (videoScaling.zoom !== 1 || autoZoomCoords) {
      // If we are zooming, specigy the coordinates for the motion detection zoom to utilize
      if (autoZoomCoords) {
        // An auto-zoom request is pending for specific coordinates
        zoom = {
          x: Math.max(
            0,
            autoZoomCoords.x + (getTravelRightToLeft() ? -16 : -240)
          ),
          y: Math.max(0, autoZoomCoords.y - 25),
          width: 256,
          height: 100,
        };
      } else {
        // Motion estimate around finish line
        const finishLine = getFinishLine();
        zoom = {
          x: Math.max(
            0,
            videoScaling.srcWidth / 2 +
              (finishLine.pt1 + finishLine.pt2) / 2 +
              (getTravelRightToLeft() ? -16 : -240)
          ),
          y: Math.max(0, videoScaling.srcCenterPoint.y - 100),
          width: 256,
          height: 200,
        };
      }
    }

    requestVideoFrame({
      videoFile: image.file,
      frameNum,
      zoom,
      blend,
    });
  }
};

export const moveRight = () => {
  moveToFrame(getVideoFrameNum(), 1);
};
export const moveLeft = () => {
  moveToFrame(getVideoFrameNum(), -1);
};

/**
 * Translates a point from the source canvas coordinates to the destination canvas coordinates.
 *
 * @param {Point} srcPoint - The point in the source canvas coordinates.
 * @param {VideoScaling} [scaling] - The scaling object containing the dimensions and offsets for the source and destination canvases.
 *                                   If not provided, the function will call `getVideoScaling` to retrieve the scaling information.
 * @returns {Point} - The translated point in the destination canvas coordinates.
 */
export const translateSrcCanvas2DestCanvas = (
  srcPoint: Point,
  scaling?: VideoScaling
): Point => {
  if (!scaling) {
    scaling = getVideoScaling();
  }
  const translatedX =
    scaling.destX + (srcPoint.x * scaling.scaledWidth) / scaling.srcWidth;
  const translatedY =
    scaling.destY + (srcPoint.y * scaling.scaledHeight) / scaling.srcHeight;
  return { x: translatedX, y: translatedY };
};

/**
 * Translates a point from the mouse coordinates on the destination canvas to the source canvas coordinates.
 *
 * @param {Point} point - The point in the mouse coordinates on the destination canvas.
 * @returns {Point} - The translated point in the source canvas coordinates.
 */
export const translateMouseCoords2SourceCanvas = (point: Point): Point => {
  const scaling = getVideoScaling();
  const srcX =
    ((point.x - scaling.destX) * scaling.srcWidth) / scaling.scaledWidth;
  const srcY =
    ((point.y - scaling.destY) * scaling.srcHeight) / scaling.scaledHeight;
  // console.log(JSON.stringify({ srcX, srcY }, null, 2));
  return { x: srcX, y: srcY };
};

/**
 * Translates a mouse event's coordinates relative to the screen to coordinates
 * relative to the source canvas. This function also checks whether the translated
 * coordinates are within the bounds of the source canvas.

 * @param {React.MouseEvent} event - The mouse event object containing the client coordinates.
 * @param {DomRect | undefined} rect - The bounding rectangle of the element being referenced.
 *
 * @returns {{ x: number, y: number, pt: { x: number, y: number }, withinBounds: boolean }} An object containing:
 *   - x: The x-coordinate relative to the source canvas.
 *   - y: The y-coordinate relative to the source canvas.
 *   - pt: The point object with x and y coordinates transformed to the source canvas.
 *   - withinBounds: A boolean indicating if the point is within the bounds of the source canvas.
 */
export const translateMouseEvent2Src = (
  event: React.MouseEvent,
  rect: DOMRect | undefined
) => {
  let x = event.clientX - (rect?.left ?? 0);
  const y = event.clientY - (rect?.top ?? 0);
  const pt = translateMouseCoords2SourceCanvas({ x, y });
  const videoScaling = getVideoScaling();
  const withinBounds =
    pt.y <= videoScaling.srcHeight &&
    pt.x <= videoScaling.srcWidth &&
    pt.x >= 0 &&
    pt.y >= 0;
  return { x, y, pt, withinBounds };
};

/**
 * Return a guide definition for the finish line
 * @returns {Guide}
 */
export const getFinishLine = () => {
  const videoSettings = getVideoSettings();
  let vert = videoSettings.guides.find((guide) => guide.dir === Dir.Vert);
  if (!vert || !vert.enabled) {
    vert = { enabled: true, dir: Dir.Vert, label: 'Finish', pt1: 0, pt2: 0 };
  }
  return vert;
};
