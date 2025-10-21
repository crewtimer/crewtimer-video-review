import React from 'react';
import { Rect } from 'renderer/shared/AppTypes';
import {
  getClickOffset,
  getWaypoint,
  getWaypointList,
} from 'renderer/util/UseSettings';
import { ExtendedLap, getClickerData } from './UseClickerData';
import {
  Dir,
  getHyperZoomFactor,
  getImage,
  getSelectedIndex,
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoScaling,
  getVideoSettings,
  resetVideoZoom,
  setSelectedIndex,
  setVideoBow,
  setVideoEvent,
  setVideoFile,
  setVideoFrameNum,
  VideoScaling,
  getDirList,
  setFileSplitPending,
} from './VideoSettings';
import { TimeObject } from './VideoTypes';
import { parseTimeToSeconds } from '../util/StringUtils';
import {
  requestVideoFrame,
  seekToClickInFile,
  seekToTimestamp,
} from './RequestVideoFrame';
import { gateFromWaypoint } from 'renderer/util/Util';

// Define types for points and lines for better type checking and readability
export type Point = { x: number; y: number };
export type Line = { pt1: Point; pt2: Point };

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
      (pt2.x - pt1.x) * (pt1.y - point.y) - (pt1.x - point.x) * (pt2.y - pt1.y),
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
  line: Line,
): 'above' | 'below' | 'on' {
  const { pt1, pt2 } = line;
  const crossProduct =
    (pt2.x - pt1.x) * (point.y - pt1.y) - (pt2.y - pt1.y) * (point.x - pt1.x);

  if (crossProduct > 0) return 'below'; // Note for canvas y=0 is top
  if (crossProduct < 0) return 'above';
  return 'on';
}

export const triggerFileSplit = () => {
  const msg = {
    cmd: 'split-video',
    src: 'crewtimer-video-review',
    ts: new Date().getTime(),
    wp: getWaypoint(),
  };
  window.VideoUtils.sendMulticast(JSON.stringify(msg), '239.215.23.42', 52342);
  setFileSplitPending(true);
};

export const sendInfoMessage = () => {
  const msg = {
    cmd: 'info',
    src: 'crewtimer-video-review',
    ts: new Date().getTime(),
    wp: getWaypoint(),
    wplist: getWaypointList(),
  };
  window.VideoUtils.sendMulticast(JSON.stringify(msg), '239.215.23.42', 52342);
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
  align: 'left' | 'center' | 'right',
  bgColor = '#ffffff60',
) => {
  ctx.font = `${Math.trunc(fontSize)}px Roboto`;
  const textSize = ctx.measureText(text);
  const padding = 12;

  // Adjust X-Coordinate for Alignment
  let textX: number;
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
  const rectX = textX - padding / 2;

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
  ctx.fillStyle = bgColor;
  ctx.fillRect(rectX, rectY, rectWidth, rectHeight);

  // Draw the text
  ctx.fillStyle = 'black';
  ctx.fillText(text, textX, textY);

  // Return bounds of the text
  return {
    x: rectX + padding / 2,
    y: rectY + padding / 2,
    width: rectWidth - padding,
    height: rectHeight - padding,
  };
};

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
  desiredPosition: 'above' | 'below' | 'any',
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

function combineCanvasLayers(
  layers: (HTMLCanvasElement | null | undefined)[],
  xOffset: number,
  yOffset: number,
  width: number,
  height: number,
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
        height,
      );
      // context.drawImage(layer, 0, 0);
    }
  });

  return combinedCanvas;
}

export function downloadCanvasImage(
  combinedCanvas: HTMLCanvasElement,
  filename: string = 'screenshot.png',
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
  height: number,
) => {
  // Combine the layers and initiate the download
  const combinedCanvas = combineCanvasLayers(
    layers,
    xOffset,
    yOffset,
    width,
    height,
  );
  downloadCanvasImage(combinedCanvas, filename);
};

export const moveToFileIndex = (index: number, seekPercent: number) => {
  const dirList = getDirList();
  const selIndex = Math.max(0, Math.min(index, dirList.length - 1));
  if (selIndex !== index && selIndex === getSelectedIndex()) {
    // Do nothing.  The selected file isn't changing and the request was out of bounds
    return Promise.resolve();
  }
  const videoFile = dirList[selIndex];
  setSelectedIndex(selIndex);
  setVideoFile(videoFile);
  if (seekPercent <= 0 || seekPercent >= 1) {
    return requestVideoFrame({ videoFile, seekPercent });
  }
  return seekToClickInFile(videoFile, seekPercent);
};
export const prevFile = () => {
  moveToFileIndex(getSelectedIndex() - 1, 1);
};
export const nextFile = () => {
  const dirList = getDirList();
  if (getSelectedIndex() === dirList.length - 1) {
    triggerFileSplit();
  } else {
    moveToFileIndex(getSelectedIndex() + 1, 0);
  }
};

/**
 * Calculates and returns the tracking region near the finish line in video coordinates.
 * The region also takes into consideration the travel direction with emphasis on the region
 *  before the finish line (usually has the boat visible) and a smaller region after the finish
 *
 * @returns An object containing the x, y, width, and height of the tracking region.
 */
export const getTrackingRegion = (aroundFinish = true) => {
  const finishLine = getFinishLine();
  const videoScaling = getVideoScaling();
  // console.log('genTrackingRegion', getImage().motion);

  const height = Math.round((40 * getVideoScaling().srcHeight) / 1080 / 4) * 4;
  const width = Math.round((1.5 * height) / 4) * 4;
  const pxBeforeFinish = Math.round((5 * width) / 8 / 4) * 4;

  const clickPointX = aroundFinish
    ? videoScaling.srcWidth / 2 + (finishLine.pt1 + finishLine.pt2) / 2
    : videoScaling.srcClickPoint.x;

  const region = {
    x: Math.max(
      0,
      clickPointX -
        (getTravelRightToLeft() ? width - pxBeforeFinish : pxBeforeFinish),
    ),
    y: Math.max(0, videoScaling.srcClickPoint.y - height / 2),
    width: width,
    height,
  };
  return region;
};

export const moveToFrame = (
  frameNum: number,
  offset?: number,
  blend: boolean = true,
) => {
  const image = getImage();
  const videoScaling = getVideoScaling();
  const zoomFactor = videoScaling.zoomY;
  const hyperZoomFactor = getHyperZoomFactor();
  let videoFrameNum = frameNum;

  if (offset !== undefined) {
    if (zoomFactor < 3 || hyperZoomFactor === 0) {
      videoFrameNum = Math.trunc(frameNum) + offset; // Math.round(frameNum + offset);
    } else {
      videoFrameNum = frameNum + (offset * image.fps * hyperZoomFactor) / 1000;
    }
  }

  if (videoFrameNum < 1) {
    prevFile();
    return;
  }
  if (videoFrameNum > image.numFrames) {
    nextFile();
    return;
  }

  setVideoFrameNum(Math.min(image.numFrames, Math.max(1, videoFrameNum)));
  let zoom: Rect | undefined;

  if (videoScaling.zoomY !== 1) {
    // If we are zooming, specify the coordinates for the motion detection zoom to utilize
    // Motion estimate around finish line
    zoom = getTrackingRegion();
  }

  requestVideoFrame({
    videoFile: image.file,
    frameNum: videoFrameNum,
    zoom,
    blend,
  });
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
  scaling?: VideoScaling,
): Point => {
  const scale = scaling || getVideoScaling();

  const { x, y } = srcPoint;
  return {
    x: scale.destX + scale.scaleX * x,
    y: scale.destY + scale.scaleY * y,
  };
};

/**
 * Translates a point from the mouse coordinates on the destination canvas to the source canvas coordinates.
 *
 * @param {Point} point - The point in the mouse coordinates on the destination canvas.
 * @returns {Point} - The translated point in the source canvas coordinates.
 */
export const translateMouseCoords2SourceCanvas = (point: Point): Point => {
  const scaling = getVideoScaling();

  const { x, y } = point;
  return {
    x: (x - scaling.destX) / scaling.scaleX,
    y: (y - scaling.destY) / scaling.scaleY,
  };
};

/**
 * Translates a mouse event's coordinates relative to the screen to coordinates
 * relative to the source canvas. This function also checks whether the translated
 * coordinates are within the bounds of the source canvas.

 * @param {React.MouseEvent} event - The mouse event object containing the client coordinates.
 * @param {DomRect | undefined} rect - The bounding rectangle of the element being referenced.
 *
 * @returns {{ x: number, y: number, pt: { x: number, y: number }, withinBounds: boolean }} An object containing:
 *   - dx: The x offset in dest canvas units from the left edge of the image
 *   - dy: The y offset in dest canvas units from the top edge of the image
 *   - x: The x-coordinate relative to the source canvas.
 *   - y: The y-coordinate relative to the source canvas.
 *   - pt: The point object with x and y coordinates transformed to the source canvas.
 *   - withinBounds: A boolean indicating if the point is within the bounds of the source canvas.
 *   - overButtons: A boolean indicating if the point is over the button region of the image
 */
export const translateMouseEventCoords = (
  event: React.MouseEvent,
  rect: DOMRect | undefined,
) => {
  const x = event.clientX - (rect?.left ?? 0);
  const y = event.clientY - (rect?.top ?? 0);
  const pt = translateMouseCoords2SourceCanvas({ x, y });
  const videoScaling = getVideoScaling();
  const dx = x - videoScaling.destX;
  const dy = y - videoScaling.destY;
  const withinBounds =
    pt.y <= videoScaling.srcHeight &&
    pt.x <= videoScaling.srcWidth &&
    pt.x >= 0 &&
    pt.y >= 0;
  // Assume buttons are within 100x60 screen pix of upper right
  const overButtons =
    withinBounds && y < 60 && x > videoScaling.destWidth - 100;
  return { dx, dy, x, y, pt, withinBounds, overButtons };
};

/**
 * Finds the next time point in a sorted array of time points that meets the specified conditions.
 *
 * @param {TimeObject} from - The reference time object containing a `Time` property to compare and a `Bow` property to match.
 * @returns {TimeObject | undefined} The first `TimeObject` in the sorted `timePoints` array with a `seconds` value greater than or equal to `from.Time` and a different `Bow` value, or `undefined` if no such point is found.
 *
 * @remarks
 * This function retrieves the array of time points from `getClickerData()`. It then performs a binary search to
 * find the first `TimeObject` where `seconds >= s`, where `s` is the number of seconds parsed from `from.Time`.
 * After finding an initial candidate, it checks subsequent points until it finds one with a different `Bow`
 * value than `from.Bow`.
 */
export const seekToNextTimePoint = (from: {
  time?: string;
  bow: string;
}): TimeObject | undefined => {
  console.log('seeking...', from);
  if (!from.time) {
    return undefined;
  }
  const timePoints = getClickerData();
  let left = 0;
  let right = timePoints.length - 1;
  let result: ExtendedLap | undefined;
  // prefre starting search from the last seek position
  const seekTime = from.time || '00:00:00.000';
  // const lastSeekTime = getLastSeekTime();

  // // If the last seek time was to a ? field, only go forward from specified time
  // if (lastSeekTime.bow !== '?' && lastSeekTime.time) {
  //   seekTime = lastSeekTime.time;
  // }
  // console.log(JSON.stringify({ from, lastSeekTime, seekTime }));
  const s = parseTimeToSeconds(seekTime);

  let mid: number = 0;
  while (left <= right) {
    mid = Math.floor((left + right) / 2);

    if (timePoints[mid].seconds >= s) {
      result = timePoints[mid];
      right = mid - 1; // Keep searching in the left half for a closer match
    } else {
      left = mid + 1; // Search in the right half
    }
  }

  if (!result) {
    return undefined;
  }

  // Move forward in the array until finding a time point with a different Bow value
  while (result.Bow === from.bow || result.Bow === '*') {
    mid += 1;
    if (mid >= timePoints.length) {
      return undefined;
    }
    result = timePoints[mid];
  }

  resetVideoZoom();
  setTimeout(() => {
    const timeFromVideoReview =
      result?.Gate === gateFromWaypoint(getWaypoint());
    const found = seekToTimestamp({
      time: result?.Time || '00:00:00.000',
      offsetMilli: timeFromVideoReview ? 0 : getClickOffset().offsetMilli,
      bow: result.Bow || '',
    });
    if (found) {
      if (result.EventNum !== '?') {
        setVideoEvent(result.EventNum);
      }
      if (result.Bow && result.Bow !== '*') {
        setVideoBow(result.Bow, result.uuid);
      }
    }
  }, 10);

  return result as TimeObject;
};
