import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { replaceFileSuffix } from 'renderer/util/Util';
import { getDirList, requestVideoFrame } from './VideoFileUtils';
import {
  Dir,
  getHyperZoomFactor,
  getImage,
  getSelectedIndex,
  getVideoFile,
  getVideoFrameNum,
  getVideoSettings,
  getZoomWindow,
  setSelectedIndex,
  setVideoFile,
  setVideoFrameNum,
  setVideoSettings,
  VideoGuides,
} from './VideoSettings';

const { storeJsonFile, readJsonFile } = window.Util;

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

/**
 * Save the video guide settings to a JSON file.  The JSON file is named after the video file
 *
 * @returns
 */
export const saveVideoSidecar = () => {
  const { guides, laneBelowGuide } = getVideoSettings();
  const content: VideoGuides = {
    guides,
    laneBelowGuide,
  };
  const videoFile = getVideoFile();
  if (videoFile) {
    return storeJsonFile(replaceFileSuffix(videoFile, 'json'), content);
  } else {
    return Promise.reject('No video file');
  }
};

/**
 *  Save the current video guide settings to a JSON file.  The JSON file is named after the video file
 *
 * @param videoFile - The path to the video file
 */
export const loadVideoSidecar = (videoFile: string) => {
  readJsonFile(replaceFileSuffix(videoFile, 'json'))
    .then((result) => {
      if (result.status === 'OK') {
        setVideoSettings({
          ...getVideoSettings(),
          ...result?.json,
          sidecarSource: videoFile,
        });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    })
    .catch(showErrorDialog);
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
export const moveToFrame = (frameNum: number, offset?: number) => {
  if (offset === undefined) {
    offset = 0;
  }
  const image = getImage();
  if (frameNum < 1) {
    prevFile();
  } else if (frameNum > getImage().numFrames) {
    nextFile();
  } else {
    const zoomFactor = image.height / getZoomWindow().height;
    const hyperZoomFactor = getHyperZoomFactor();
    if (zoomFactor < 3 || hyperZoomFactor === 0) {
      frameNum = Math.trunc(frameNum) + offset; //Math.round(frameNum + offset);
    } else {
      frameNum = frameNum + (offset * image.fps * hyperZoomFactor) / 1000;
    }

    setVideoFrameNum(frameNum);
    requestVideoFrame({
      videoFile: image.file,
      frameNum,
      zoom: getZoomWindow(),
    });
  }
};

export const moveRight = () => {
  moveToFrame(getVideoFrameNum(), 1);
};
export const moveLeft = () => {
  moveToFrame(getVideoFrameNum(), -1);
};
