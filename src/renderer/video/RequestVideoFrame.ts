import { AppImage, VideoFrameRequest } from 'renderer/shared/AppTypes';
import { KeyMap } from 'crewtimer-common';
import { milliToString, timeToMilli } from 'renderer/util/Util';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { parseTimeToSeconds } from 'renderer/util/StringUtils';
import { convertTimestampToLocalMicros } from 'renderer/shared/Util';
import { updateVideoScaling } from 'renderer/util/ImageScaling';
import { getWaypoint } from 'renderer/util/UseSettings';
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
  getInterpolationTechnique,
  setZoomPreservedFile,
  cancelZoomPreservedFile,
  getImage,
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
import { getVisibleSourceRect } from './VideoUtils';
import { fileSegmentBounds, findTimeSegment } from './TimeSegmentUtils';
import type { InterpolationRecord } from './InterpolationStore';

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
export function calculateSeekFrame(
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
    const fileEndUtcMilli = Math.round(status.endTime / 1000);

    // The timestamp is a local time of day. Convert it to a UTC time of day,
    // then pick the UTC date that puts it nearest the file, which handles
    // files and seeks on either side of local or UTC midnight.
    const dayMilli = 24 * 60 * 60 * 1000;
    const mod = (value: number) => ((value % dayMilli) + dayMilli) % dayMilli;
    const utcTimeOfDay = mod(tsMilli - tzOffsetMinutes * 60 * 1000);
    const fileDayStart = fileStartUtcMilli - mod(fileStartUtcMilli);
    const distanceToFile = (milli: number) =>
      Math.max(fileStartUtcMilli - milli, milli - fileEndUtcMilli, 0);
    const requestedUtcMilli = [-dayMilli, 0, dayMilli]
      .map((dayOffset) => fileDayStart + dayOffset + utcTimeOfDay)
      .reduce((best, milli) =>
        distanceToFile(milli) < distanceToFile(best) ? milli : best,
      );

    // Native code rejects times outside the first and last frame times, which
    // it rounds to the millisecond the same way.
    const utcMilli = Math.min(
      fileEndUtcMilli,
      Math.max(fileStartUtcMilli, requestedUtcMilli),
    );

    let seekFrame =
      1 +
      ((requestedUtcMilli * 1000 - status.startTime) / (delta || 1)) *
        (status.numFrames - 1);

    console.log(
      `toTimestamp ${JSON.stringify({ toTimestamp, tsMilli, seekFrame, delta, tzOffsetMinutes, fileStartUtcMilli, requestedUtcMilli, utcMilli, fileOffsetMilli: utcMilli - fileStartUtcMilli }, null, 2)}`,
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
 * Handles errors: logs and sets error state. A frame from the same file stays
 * displayed; otherwise a test pattern replaces the other file's frame.
 */
function handleFrameError(
  videoFile: string,
  seekPos: number,
  error: any,
  commit = true,
) {
  console.log(`Failed to get frame for ${videoFile}@${seekPos}`, error);
  if (!commit) {
    return;
  }
  if (getImage().file !== videoFile) {
    setImage(generateTestPattern());
  }
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
  commit = true,
): Promise<AppImage | undefined> => {
  if (!request.videoFile || request.commitGuard?.() === false) {
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
      const { commitGuard: _commitGuard, ...nativeRequest } = request;
      image = await VideoUtils.getFrame({
        ...nativeRequest,
        frameNum: clampedSeekPos,
        tsMilli: utcMilli,
      });
    } catch (e) {
      handleFrameError(request.videoFile, clampedSeekPos, e, commit);
      return undefined;
    }

    if (!image) {
      handleFrameError(
        request.videoFile,
        clampedSeekPos,
        'No image returned',
        commit,
      );
      return undefined;
    }
    if (request.commitGuard?.() === false) {
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
    if (!commit) {
      return image;
    }
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
    handleFrameError(request.videoFile, request.frameNum ?? 1, e, commit);
    return undefined;
  }
};

interface QueuedFrameRequest {
  params: VideoFrameRequest;
  resolve: (frame: AppImage | undefined) => void;
  reject: (e: any) => void;
  /** performance.now() when a background request was queued. */
  queuedAt?: number;
}
let running = false;
let nextRequest: QueuedFrameRequest | null = null;
/** Requests that never touch the displayed image; run when display is idle. */
const backgroundRequests: QueuedFrameRequest[] = [];

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
  while (nextRequest || backgroundRequests.length) {
    // Display requests always take priority over background ones.
    const commit = nextRequest !== null;
    const request = nextRequest || backgroundRequests.shift();
    nextRequest = commit ? null : nextRequest;
    if (!request) break;
    const { params, resolve, reject, queuedAt } = request;
    const startedAt = performance.now();
    try {
      // eslint-disable-next-line no-await-in-loop
      const frame = await doRequestVideoFrame(params, commit);
      if (!commit) {
        const { videoFile, frameNum, toTimestamp, interpMethod, crop } = params;
        console.log(
          `Background frame ${interpMethod || 'blend'}${crop ? ' crop' : ''} ` +
            `${videoFile}@${frameNum ?? toTimestamp}: ` +
            `${Math.round(performance.now() - startedAt)}ms ` +
            `(queued ${Math.round(startedAt - (queuedAt ?? startedAt))}ms)` +
            `${frame ? '' : ' no frame'}`,
        );
      }
      resolve(frame);
    } catch (e) {
      reject(e);
    }
  }
  running = false;
}

/**
 * Fetches a frame without displaying it, e.g. for rendering lap images.
 * Background requests are never coalesced and run only when no display
 * request is waiting.
 */
export function requestBackgroundVideoFrame(
  params: VideoFrameRequest,
): Promise<AppImage | undefined> {
  return new Promise<AppImage | undefined>((resolve, reject) => {
    backgroundRequests.push({
      params,
      resolve,
      reject,
      queuedAt: performance.now(),
    });
    runQueue();
  });
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

/**
 * Finds the video file containing the given timestamp without changing any
 * selection state.
 */
export const findSeekTarget = (time: string) => {
  const jumpMicro = parseTimeToSeconds(time) * 1000000;
  const fileStatusList = getFileStatusList();
  if (!fileStatusList.length) {
    console.warn(`No video files are available for timestamp ${time}`);
    return undefined;
  }
  // Use the same file assignment as the scrubber hint markers.
  const fileBounds = fileSegmentBounds(fileStatusList);
  const { segment, segmentIndex: fileIndex } = findTimeSegment(
    fileBounds,
    jumpMicro,
  );
  if (!segment) {
    console.warn(
      `No video contains timestamp ${time} within one frame of its first or last frame`,
    );
    return undefined;
  }

  // A time just outside the file seeks to its nearest frame.
  let resolvedTime = time;
  if (jumpMicro < segment.startTsMicro) {
    resolvedTime = milliToString(Math.ceil(segment.startTsMicro / 1000));
  } else if (jumpMicro > segment.endTsMicro) {
    resolvedTime = milliToString(Math.floor(segment.endTsMicro / 1000));
  }
  if (resolvedTime !== time) {
    console.log(
      `Timestamp ${time} falls between video files; using boundary ${resolvedTime} from ${fileStatusList[fileIndex].filename}`,
    );
  }

  const videoFile = fileStatusList[fileIndex].filename;
  return { time: resolvedTime, videoFile, fileIndex };
};

const resolveSeekTarget = ({ time, bow }: { time: string; bow?: string }) => {
  setLastSeekTime({ time, bow });
  const target = findSeekTarget(time);
  if (!target) {
    return undefined;
  }
  setSelectedIndex(target.fileIndex);
  setVideoFile(target.videoFile);
  return { time: target.time, videoFile: target.videoFile };
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
  bow,
}: {
  time: string;
  bow?: string;
}): string | undefined => {
  const target = resolveSeekTarget({ time, bow });
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

export const seekToTimestampAndWait = async ({
  time,
  bow,
  interpolate = false,
  commitGuard,
}: {
  time: string;
  bow?: string;
  interpolate?: boolean;
  commitGuard?: () => boolean;
}): Promise<AppImage | undefined> => {
  const target = resolveSeekTarget({ time, bow });
  if (!target) {
    return undefined;
  }
  try {
    const interpMethod = interpolate ? getInterpolationTechnique() : undefined;
    const image = await requestVideoFrame({
      videoFile: target.videoFile,
      toTimestamp: target.time,
      blend: interpolate,
      saveAs: '',
      closeTo: false,
      interpMethod,
      // Native code clamps this intentionally oversized crop to the decoded
      // frame, allowing an exact full-frame RIFE request without first
      // committing a non-interpolated frame just to discover its dimensions.
      crop:
        interpMethod === 'rife'
          ? { x: 0, y: 0, width: 100000, height: 100000 }
          : undefined,
      commitGuard,
    });
    if (!image) {
      return undefined;
    }
    return image;
  } catch (error) {
    showErrorDialog(error);
    return undefined;
  }
};

export const seekToTimestampWithInterpolation = async ({
  time,
  bow,
  interpolation,
}: {
  time: string;
  bow?: string;
  interpolation: InterpolationRecord;
}): Promise<string | undefined> => {
  // Result times include the row-specific rolling-shutter correction. Video
  // seeks and interpolation always operate on the original frame timeline.
  const target = resolveSeekTarget({
    time: interpolation.frameTime ?? time,
    bow,
  });
  if (!target) {
    return undefined;
  }
  // Navigation remains anchored to the scored result time even though the
  // video request below uses its uncorrected frame time.
  setLastSeekTime({ time, bow });
  const srcClickPoint = {
    ...interpolation.srcClickPoint,
    y: interpolation.recordedY ?? interpolation.srcClickPoint.y,
  };

  // Mark only a real file switch: the image effect consumes the mark when the
  // new file renders, so it must not be left behind for a same-file seek.
  if (getImage().file !== target.videoFile) {
    setZoomPreservedFile(target.videoFile);
  }
  updateVideoScaling({
    zoomX: 1,
    zoomY: interpolation.zoomY,
    srcCenterPoint: interpolation.srcCenterPoint,
    srcClickPoint,
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
      // Failed or superseded before the target file was displayed.
      cancelZoomPreservedFile(target.videoFile);
      return target.videoFile;
    }

    updateVideoScaling({
      srcWidth: image.width,
      srcHeight: image.height,
      zoomX: 1,
      zoomY: interpolation.zoomY,
      srcCenterPoint: interpolation.srcCenterPoint,
      srcClickPoint,
      autoZoomed: interpolation.autoZoomed,
    });

    const interpMethod = getInterpolationTechnique();
    const interpolationFrameNum = interpolation.frameNum ?? image.frameNum;
    // The initial timestamp seek above commits its nearby decoded frame. The
    // restored interpolation may be fractional, so make that exact position
    // canonical before zoom reset later requests a full-frame refresh.
    setVideoFrameNum(interpolationFrameNum);
    await requestVideoFrame({
      videoFile: target.videoFile,
      frameNum: interpolationFrameNum,
      zoom: interpolation.trackingRegion,
      blend: true,
      closeTo: false,
      interpMethod,
      crop: interpMethod === 'rife' ? getVisibleSourceRect() : undefined,
    });
  } catch (error) {
    if (getImage().file !== target.videoFile) {
      cancelZoomPreservedFile(target.videoFile);
    }
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
    });
    return Promise.resolve();
  }

  // no click found, set last seek to beginning of file so tab will move forward from there
  const time = milliToString(start * 1000);
  setLastSeekTime({ time });
  // no clicks found, just seek to the file falling back on percent
  return requestVideoFrame({ videoFile, seekPercent });
};
