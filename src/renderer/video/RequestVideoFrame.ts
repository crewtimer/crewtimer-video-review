import { AppImage, VideoFrameRequest } from 'renderer/shared/AppTypes';
import {
  milliToString,
  secondsSinceLocalMidnight,
  timeToMilli,
} from 'renderer/util/Util';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { parseTimeToSeconds } from 'renderer/util/StringUtils';
import { convertTimestampToLocalMicros } from 'renderer/shared/Util';
import { updateVideoScaling } from 'renderer/util/ImageScaling';
import { getClickOffset, getWaypoint } from 'renderer/util/UseSettings';
import {
  setVideoError,
  setVideoFrameNum,
  setImage,
  setSelectedIndex,
  setVideoFile,
  getHyperZoomFactor,
  setVideoEvent,
  setVideoBow,
  setLastSeekTime,
  getVideoFile,
  getVideoFrameNum,
  getVideoScaling,
} from './VideoSettings';
import {
  getFileStatusByName,
  getFileStatusList,
  updateFileStatus,
} from './VideoFileStatus';
import { generateTestPattern } from '../util/ImageUtils';
import { getClickerData } from './UseClickerData';
import { saveVideoSidecar } from './Sidecar';
// eslint-disable-next-line import/no-cycle
import {
  getFinishLine,
  getTrackingRegion,
  moveToFrame,
  Point,
} from './VideoUtils';
import type { InterpolationRecord } from './InterpolationStore';
import { KeyMap } from 'crewtimer-common';

const { VideoUtils } = window;

// --- Open file state encapsulation ---
let openFilename = '';
export const getOpenFilename = () => openFilename;
export const setOpenFilename = (filename: string) => {
  openFilename = filename;
};

// --- Helpers ---

/**
 * Ensures the specified video file is open and its status is up to date.
 *
 * If another file is currently open, it will be closed first. Attempts to open the given video file,
 * retrieves its first and last frames to update metadata, and ensures the sidecar contains guide information.
 * Updates and returns the file status, or returns undefined and sets a video error if the operation fails.
 *
 * @param videoFile - The filename of the video to open.
 * @returns A promise resolving to the updated file status or undefined if opening fails.
 */
async function ensureFileOpen(
  videoFile: string,
): Promise<ReturnType<typeof getFileStatusByName> | undefined> {
  const videoFileStatus = getFileStatusByName(videoFile);
  if (!videoFileStatus) {
    setVideoError(`Unable to open file: ${videoFile}`);
    return undefined;
  }

  if (videoFile !== openFilename && openFilename) {
    const prevStatus = getFileStatusByName(openFilename);
    if (prevStatus?.open) {
      await VideoUtils.closeFile(openFilename);
      prevStatus.open = false;
      updateFileStatus(prevStatus);
      openFilename = '';
    }
  }

  if (videoFileStatus.open) {
    return videoFileStatus;
  }

  const openStatus = await VideoUtils.openFile(videoFile);
  if (openStatus.status !== 'OK') {
    setVideoError(`Unable to open file: ${videoFile}`);
    return undefined;
  }

  // Get first and last frames to update file status
  const firstImage: AppImage | undefined = await VideoUtils.getFrame({
    videoFile,
    frameNum: 1,
    tsMilli: 0,
  });
  if (!firstImage) {
    setVideoError(`Unable to get frame 1: ${videoFile}`);
    return undefined;
  }
  openFilename = videoFile;

  let lastImage: AppImage | undefined;
  // On VFR files, r_frame_rate may undercount the last decodable frame by
  // up to ~1% of the total. Walk back up to 2% with a floor of 200.
  // Each failing getFrame near EOF is an expensive native seek, so use
  // exponential probe + bisect (O(log maxExcess)) instead of linear walk.
  const maxExcess = Math.max(200, Math.floor(firstImage.numFrames / 50));
  const tryBack = async (back: number): Promise<AppImage | undefined> => {
    try {
      return await VideoUtils.getFrame({
        videoFile,
        frameNum: firstImage.numFrames - back,
        tsMilli: 0,
      });
    } catch {
      console.log(`cant read frame ${firstImage.numFrames - back}`);
      return undefined;
    }
  };
  let lo = -1; // largest known-failing back
  let hi = -1; // smallest known-passing back
  for (let probe = 0; probe <= maxExcess; probe = probe === 0 ? 1 : probe * 2) {
    // eslint-disable-next-line no-await-in-loop
    const img = await tryBack(probe);
    if (img) {
      lastImage = img;
      hi = probe;
      break;
    }
    lo = probe;
    if (probe >= maxExcess) break;
  }
  while (lo >= 0 && hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    // eslint-disable-next-line no-await-in-loop
    const img = await tryBack(mid);
    if (img) {
      lastImage = img;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (lastImage && hi > 0) {
    firstImage.numFrames -= hi;
  }
  if (!lastImage) {
    setVideoError(`Unable to get frame ${firstImage.numFrames}: ${videoFile}`);
    return undefined;
  }

  const lastImageTime = lastImage.tsMicro
    ? lastImage.tsMicro
    : Math.trunc(
        firstImage.tsMicro + (1000000 * firstImage.numFrames) / firstImage.fps,
      );

  const tzOffset = videoFileStatus.tzOffset || -new Date().getTimezoneOffset();
  const missingSidecarFile = !videoFileStatus.sidecar?.file;
  const newVideoFileStatus = {
    filename: videoFile,
    open: true,
    numFrames: firstImage.numFrames,
    startTime: firstImage.tsMicro,
    endTime: lastImageTime,
    duration: lastImageTime - firstImage.tsMicro,
    fps: firstImage.fps,
    tzOffset,
    sidecar: {
      ...videoFileStatus.sidecar,
      file: {
        startTs: `${firstImage.tsMicro / 1000000}`,
        stopTs: `${lastImageTime / 1000000}`,
        numFrames: firstImage.numFrames,
        fps: firstImage.fps,
        tzOffset,
      },
    } as KeyMap,
  };
  console.log(JSON.stringify(newVideoFileStatus, null, 2));
  updateFileStatus(newVideoFileStatus);

  // Since we're opening the video file for viewing, ensure the sidecar has guides defined.
  if (missingSidecarFile || !newVideoFileStatus.sidecar?.guides) {
    // No guides, save current guide config. Saving will update the cached sidecar.
    await saveVideoSidecar(videoFile);
  }

  return newVideoFileStatus;
}

/**
 * Calculates the seek frame position and UTC time in milliseconds for a video file,
 * based on the provided file status and one of frame number, seek percentage, or timestamp.
 *
 * @param status - The file status object retrieved by getFileStatusByName.
 * @param frameNum - (Optional) The specific frame number to seek to.
 * @param seekPercent - (Optional) The percentage (0-1) of the video to seek to.
 * @param toTimestamp - (Optional) The timestamp string to seek to.
 * @returns An object containing the calculated seek position (seekPos) and UTC milliseconds (utcMilli).
 */
function calculateSeekFrame(
  status: ReturnType<typeof getFileStatusByName>,
  frameNum?: number,
  seekPercent?: number,
  toTimestamp?: string,
): { seekPos: number; utcMilli: number } {
  if (!status) return { seekPos: 1, utcMilli: 0 };

  if (seekPercent !== undefined) {
    const seekPos = Math.round(1 + (status.numFrames - 1) * seekPercent);
    return { seekPos, utcMilli: 0 };
  }

  if (toTimestamp) {
    const tsMilli = timeToMilli(toTimestamp);
    const delta = status.endTime - status.startTime;
    const tzOffsetMinutes = status.tzOffset;
    const fileStartUtcMilli = Math.round(status.startTime / 1000);
    const utcMilli =
      fileStartUtcMilli -
      (fileStartUtcMilli % (24 * 60 * 60 * 1000)) +
      ((tsMilli - tzOffsetMinutes * 60 * 1000) % (24 * 60 * 60 * 1000));

    const startTime =
      (status.startTime + tzOffsetMinutes * 60 * 1000000) %
      (24 * 60 * 60 * 1000000);

    let seekFrame =
      1 +
      ((tsMilli * 1000 - startTime) / (delta || 1)) * (status.numFrames - 1);

    console.log(
      `toTimestamp ${JSON.stringify({ toTimestamp, tsMilli, seekFrame, delta, tzOffsetMinutes, fileStartUtcMilli, utcMilli, fileOffsetMilli: utcMilli - fileStartUtcMilli, fpsCalcFrame: (utcMilli - fileStartUtcMilli) / 16.666 }, null, 2)}`,
    );
    if (getHyperZoomFactor() === 0) {
      seekFrame = Math.round(seekFrame);
    }
    return { seekPos: seekFrame, utcMilli };
  }
  if (frameNum !== undefined) {
    return { seekPos: frameNum, utcMilli: 0 };
  }
  return { seekPos: 1, utcMilli: 0 };
}

/**
 * Handles errors: logs, sets error state, and shows a test pattern.
 */
function handleFrameError(videoFile: string, seekPos: number, error: any) {
  console.log(`Failed to get frame for ${videoFile}@${seekPos}`, error);
  setImage(generateTestPattern());
  setVideoError(error instanceof Error ? error.message : String(error));
}

/**
 * Requests and retrieves a specific video frame based on the provided parameters.
 *
 * Ensures the video file is open, calculates the target frame position, and fetches the frame using internal utilities.
 * Updates the application state with the retrieved image or handles errors if the frame cannot be obtained.
 *
 * @param {VideoFrameRequest} params - Parameters specifying the video file, frame selection criteria, and options.
 * @returns {Promise<void>} Resolves when the frame is processed and state is updated.
 */
const doRequestVideoFrame = async (
  request: VideoFrameRequest,
): Promise<AppImage | undefined> => {
  if (!request.videoFile) {
    return undefined;
  }

  try {
    const status = await ensureFileOpen(request.videoFile);
    if (!status) {
      return undefined;
    }

    const { seekPos, utcMilli } = calculateSeekFrame(
      status,
      request.frameNum,
      request.seekPercent,
      request.toTimestamp,
    );
    const clampedSeekPos = Math.max(1, Math.min(status.numFrames, seekPos));

    let image: AppImage | undefined;
    try {
      image = await VideoUtils.getFrame({
        ...request,
        frameNum: clampedSeekPos,
        tsMilli: utcMilli,
      });
    } catch (e) {
      handleFrameError(request.videoFile, clampedSeekPos, e);
      return undefined;
    }

    if (!image) {
      handleFrameError(request.videoFile, clampedSeekPos, 'No image returned');
      return undefined;
    }

    // if (toTimestamp) {
    //   image.frameNum = clampedSeekPos;
    //   image.timestamp = utcMilli;
    // } else {
    //   image.timestamp = Math.round(image.tsMicro / 1000);
    // }
    image.fileStartTime = status.startTime / 1000;
    image.fileEndTime = status.endTime / 1000;
    image.tzOffset = status.tzOffset;
    image.sidecar = status.sidecar;
    setImage(image);

    if (
      request.seekPercent !== undefined ||
      request.toTimestamp !== undefined
    ) {
      setVideoFrameNum(image.frameNum);
    }
    setVideoError(undefined);
    return image;
  } catch (e) {
    handleFrameError(request.videoFile, request.frameNum ?? 1, e);
    return undefined;
  }
};

let running = false;
let nextRequest: {
  params: VideoFrameRequest;
  resolve: (frame: AppImage | undefined) => void;
  reject: (e: any) => void;
} | null = null;

/**
 * Returns the current running state of the video request queue.
 *
 * @returns {boolean} True if the video request queue is running, otherwise false.
 */
export const videoRequestQueueRunning = () => {
  return running;
};

/**
 * Runs the queue: processes the nextRequest if present.
 */
async function runQueue() {
  if (running) {
    return;
  }
  running = true;
  while (nextRequest) {
    const { params, resolve, reject } = nextRequest;
    nextRequest = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      const frame = await doRequestVideoFrame(params);
      resolve(frame);
    } catch (e) {
      reject(e);
    }
  }
  running = false;
}

/**
 * Queues a request to extract a video frame based on the provided parameters.
 *
 * If a previous request is pending, it is resolved before queuing the new one.
 * Returns a promise that resolves when the frame extraction is complete.
 *
 * @param params - The parameters specifying which video frame to request.
 * @returns Promise that resolves when the frame has been processed.
 */
export function requestVideoFrame(
  params: VideoFrameRequest,
): Promise<AppImage | undefined> {
  return new Promise<AppImage | undefined>((resolve, reject) => {
    // If a request is already queued, resolve its promise
    if (nextRequest) {
      nextRequest.resolve(undefined);
    }
    nextRequest = { params, resolve, reject };
    runQueue();
  });
}

const resolveSeekTarget = ({
  time,
  offsetMilli,
  bow,
}: {
  time: string;
  offsetMilli?: number;
  bow?: string;
}) => {
  setLastSeekTime({ time, bow });
  let adjustedTime = time;
  if (offsetMilli) {
    adjustedTime = milliToString(timeToMilli(time) + offsetMilli);
  }
  const jumpTime = parseTimeToSeconds(adjustedTime);
  const fileStatusList = getFileStatusList();
  const fileIndex = fileStatusList.findIndex((item) => {
    const start = secondsSinceLocalMidnight(
      item.startTime / 1000000,
      item.tzOffset,
    );
    const end = secondsSinceLocalMidnight(
      item.endTime / 1000000,
      item.tzOffset,
    );
    return jumpTime >= start && jumpTime <= end;
  });
  if (fileIndex < 0) {
    return undefined;
  }

  const videoFile = fileStatusList[fileIndex].filename;
  setSelectedIndex(fileIndex);
  setVideoFile(videoFile);
  return { time: adjustedTime, videoFile };
};

/**
 * Seeks to the specified timestamp within the available video files.
 * Determines the corresponding video file for the given timestamp, updates the selected index and video file,
 * and requests the video frame at that timestamp. If the timestamp does not match any file, returns undefined.
 *
 * @param timestamp - The target timestamp in 'HH:MM:SS.sss' format.
 * @returns The filename of the video file containing the timestamp, or undefined if not found.
 */
export const seekToTimestamp = ({
  time,
  offsetMilli,
  bow,
}: {
  time: string;
  offsetMilli?: number;
  bow?: string;
}): string | undefined => {
  const target = resolveSeekTarget({ time, offsetMilli, bow });
  if (!target) {
    return undefined;
  }
  requestVideoFrame({
    videoFile: target.videoFile,
    toTimestamp: target.time,
    blend: false,
    saveAs: '',
    closeTo: false,
  }).catch(showErrorDialog);
  return target.videoFile;
};

export const seekToTimestampWithInterpolation = async ({
  time,
  offsetMilli,
  bow,
  interpolation,
}: {
  time: string;
  offsetMilli?: number;
  bow?: string;
  interpolation: InterpolationRecord;
}): Promise<string | undefined> => {
  const target = resolveSeekTarget({ time, offsetMilli, bow });
  if (!target) {
    return undefined;
  }

  updateVideoScaling({
    zoomX: 1,
    zoomY: interpolation.zoomY,
    srcCenterPoint: interpolation.srcCenterPoint,
    srcClickPoint: interpolation.srcClickPoint,
    autoZoomed: interpolation.autoZoomed,
  });

  try {
    const image = await requestVideoFrame({
      videoFile: target.videoFile,
      toTimestamp: target.time,
      blend: false,
      saveAs: '',
      closeTo: false,
    });
    if (!image) {
      return target.videoFile;
    }

    updateVideoScaling({
      srcWidth: image.width,
      srcHeight: image.height,
      zoomX: 1,
      zoomY: interpolation.zoomY,
      srcCenterPoint: interpolation.srcCenterPoint,
      srcClickPoint: interpolation.srcClickPoint,
      autoZoomed: interpolation.autoZoomed,
    });

    await requestVideoFrame({
      videoFile: target.videoFile,
      frameNum: image.frameNum,
      zoom: interpolation.trackingRegion,
      blend: true,
      closeTo: false,
    });
  } catch (error) {
    showErrorDialog(error);
  }

  return target.videoFile;
};

/**
 * Seeks the video to the timestamp associated with the given event number.
 *
 * @param eventNum - The event number to seek to.
 * @returns The event number if the seek was successful, otherwise undefined.
 */
export const seekToEvent = (eventNum: string) => {
  const scoringWaypoint = getWaypoint();
  let click = getClickerData(scoringWaypoint).find(
    (item) => item.EventNum === eventNum,
  );
  if (!click) {
    click = getClickerData().find((item) => item.EventNum === eventNum);
  }
  if (click && click.Time) {
    seekToTimestamp({ time: click.Time });
    return eventNum;
  }
  return undefined;
};

/**
 * Seeks to the nearest click event within the specified video file, using the current waypoint if available.
 * If a relevant click is found, updates video event and bow state, and seeks to the click's timestamp.
 * If no click is found, falls back to seeking to the given percentage within the file.
 *
 * @param videoFile - The name of the video file to seek within.
 * @param seekPercent - The fallback seek position as a percentage if no click is found.
 * @returns The result of seeking to the click timestamp or the fallback request.
 */
export const seekToClickInFile = (videoFile: string, seekPercent: number) => {
  const info = getFileStatusByName(videoFile);
  if (!info) {
    return requestVideoFrame({ videoFile, seekPercent });
  }
  const start =
    convertTimestampToLocalMicros(info.startTime, info.tzOffset) / 1000000;
  const end =
    convertTimestampToLocalMicros(info.endTime, info.tzOffset) / 1000000;

  const scoringWaypoint = getWaypoint();
  let click = getClickerData(scoringWaypoint).find(
    (item) => item.seconds >= start && item.seconds <= end,
  );
  if (!click) {
    click = getClickerData().find(
      (item) => item.seconds >= start && item.seconds <= end,
    );
  }
  if (click && click.Time) {
    if (click.EventNum !== '?') {
      setVideoEvent(click.EventNum);
    }
    if (click.Bow && click.Bow !== '*') {
      setVideoBow(click.Bow, click.uuid);
    }
    seekToTimestamp({
      time: click.Time,
      bow: click.Bow,
      offsetMilli: getClickOffset().offsetMilli,
    });
    return Promise.resolve();
  }

  // no click found, set last seek to beginning of file so tab will move forward from there
  const time = milliToString(start * 1000);
  setLastSeekTime({ time });
  // no clicks found, just seek to the file falling back on percent
  return requestVideoFrame({ videoFile, seekPercent });
};

/**
 * Performs an auto-zoom and seek operation on a video based on provided source coordinates.
 *
 * Updates the video scaling settings centered at the specified coordinates, then requests a video frame
 * zoomed around that area. If significant motion is detected in the frame (from video analysis),
 * the function estimates the required frame jump to center the tracked region and seeks to the new frame,
 * adjusting the zoom as needed.
 *
 * @param srcCoords - The point (with x and y) within the video frame to center the auto-zoom operation.
 * @returns {Promise<void>} Resolves when the operation is complete and video/UI state is updated.
 */
export const performAutoZoomSeek = async (srcCoords: Point) => {
  // First measure the velocity in px/frame at the point of interest
  // srcCoords.x = 2528;
  // srcCoords.y = 276;
  updateVideoScaling({ srcClickPoint: srcCoords });

  const zoom = getTrackingRegion(false);
  const frameNum = getVideoFrameNum();
  console.log(
    'roi',
    JSON.stringify({
      frame: frameNum.toFixed(2),
      x: srcCoords.x.toFixed(1),
      y: srcCoords.y.toFixed(1),
    }),
  );
  const image = await requestVideoFrame({
    videoFile: getVideoFile(),
    frameNum: Math.floor(frameNum) + 0.1, // 0.1 to trigger dx measurement
    zoom,
    blend: true,
    closeTo: true,
  });

  // If we have valid motiion
  if (
    image?.motion.valid &&
    Math.abs(image.motion.x) > 2 &&
    Math.abs(image.motion.x) < 60
  ) {
    // Calculate movement necessary to get to the finish line
    // FUTURE: calculate as time instead using both dx and dt
    const finish = getFinishLine();
    const dx = image.width / 2 + finish.pt1 - srcCoords.x;
    let frames = Math.min(120, dx / image.motion.x);

    if (Math.abs(frames) > 5) {
      // Apply some compression to avoid overshoot and seek to exact frame
      frames = Math.floor(5 + (frames - 5) * 0.95);
    }

    // Move to approximate frame
    let destFrame = frameNum + frames;
    if (getHyperZoomFactor() === 0) {
      destFrame = Math.round(destFrame);
    }
    console.log(
      `dx=${image.motion.x} dt=${image.motion.dt} dframe=${frames.toFixed(1)} destFrame=${destFrame.toFixed(2)}`,
    );

    updateVideoScaling({
      zoomY: 5,
      srcCenterPoint: {
        x: getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2,
        y: srcCoords.y,
      },
      srcClickPoint: {
        x: getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2,
        y: srcCoords.y,
      },
      autoZoomed: true,
    });
    moveToFrame(destFrame, 0, true);
  } else {
    console.log(`Failed to auto-zoom rx frame=${getVideoFrameNum()}`);
    updateVideoScaling({
      zoomY: 5,
      srcCenterPoint: getTrackingRegion(),
      autoZoomed: true,
    });
  }
};
