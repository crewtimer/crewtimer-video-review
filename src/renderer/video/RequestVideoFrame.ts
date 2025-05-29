import { AppImage, Rect } from 'renderer/shared/AppTypes';
import { timeToMilli } from 'renderer/util/Util';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { parseTimeToSeconds, extractTime } from 'renderer/util/StringUtils';
import {
  setVideoError,
  setVideoFrameNum,
  setImage,
  getDirList,
  setSelectedIndex,
  setVideoFile,
  getHyperZoomFactor,
} from './VideoSettings';
import { getFileStatusByName, updateFileStatus } from './VideoFileStatus';
import { generateTestPattern } from '../util/ImageUtils';
import { saveVideoSidecar } from './VideoFileUtils';

const { VideoUtils } = window;

// --- Open file state encapsulation ---
let openFilename = '';
export const getOpenFilename = () => openFilename;
export const setOpenFilename = (filename: string) => {
  openFilename = filename;
};

/**
 * Represents a request for a specific video frame.
 * Only one of frameNum, seekPercent, or toTimestamp should be specified.
 */
export type VideoFrameRequest = {
  videoFile: string; // The path or identifier of the video file.
  frameNum?: number; // The frame number to extract (optional).
  seekPercent?: number; // Where in file to seek as percentage (optional).
  toTimestamp?: string; // The timestamp to seek to (HHMMSS.sss) (optional).
  zoom?: Rect; // The zoom window (optional).
  blend?: boolean; // Whether to blend the frame with the previous frame (optional).
  saveAs?: string; // Optional filename in which to save a PNG image of the frame.
  closeTo?: boolean; // Optional: true to only get 'close' to the requested frame.
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
  const firstImage: AppImage | undefined = await VideoUtils.getFrame(
    videoFile,
    1,
    0,
  );
  if (!firstImage) {
    setVideoError(`Unable to get frame 1: ${videoFile}`);
    return undefined;
  }
  openFilename = videoFile;

  let lastImage: AppImage | undefined;
  for (let excessFrames = 0; excessFrames < 10; excessFrames += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      lastImage = await VideoUtils.getFrame(
        videoFile,
        firstImage.numFrames - excessFrames,
        0,
      );
      firstImage.numFrames -= excessFrames;
      break;
    } catch {
      // Try one less frame
      console.log(
        `cant read frame ${firstImage.numFrames - excessFrames}, trying one less`,
      );
    }
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

  // Since we're opening the video file for viewing, ensure the sidecar has guides defined
  if (!videoFileStatus.sidecar?.guides) {
    // No guides, save current guide config
    // Saving will update the sidecar content in videoFileStatus
    await saveVideoSidecar(videoFile);
  }

  const newVideoFileStatus = {
    filename: videoFile,
    open: true,
    numFrames: firstImage.numFrames,
    startTime: firstImage.tsMicro,
    endTime: lastImageTime,
    duration: lastImageTime - firstImage.tsMicro,
    fps: firstImage.fps,
    tzOffset: videoFileStatus.tzOffset || -new Date().getTimezoneOffset(),
    sidecar: videoFileStatus.sidecar || {},
  };
  updateFileStatus(newVideoFileStatus);

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
    const fileStartUtcMilli = Math.trunc(status.startTime / 1000);
    const utcMilli =
      fileStartUtcMilli -
      (fileStartUtcMilli % (24 * 60 * 60 * 1000)) +
      tsMilli -
      tzOffsetMinutes * 60 * 1000;
    const startTime =
      (status.startTime + tzOffsetMinutes * 60 * 1000000) %
      (24 * 60 * 60 * 1000000);

    let seekFrame =
      1 +
      ((tsMilli * 1000 - startTime) / (delta || 1)) * (status.numFrames - 1);
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
const doRequestVideoFrame = async ({
  videoFile,
  frameNum,
  seekPercent,
  toTimestamp,
  zoom,
  blend,
  saveAs,
  closeTo,
}: VideoFrameRequest) => {
  if (!videoFile) return;

  try {
    const status = await ensureFileOpen(videoFile);
    if (!status) return;

    const { seekPos, utcMilli } = calculateSeekFrame(
      status,
      frameNum,
      seekPercent,
      toTimestamp,
    );
    const clampedSeekPos = Math.max(1, Math.min(status.numFrames, seekPos));

    let image: AppImage | undefined;
    try {
      image = await VideoUtils.getFrame(
        videoFile,
        clampedSeekPos,
        utcMilli,
        zoom,
        blend,
        saveAs,
        closeTo,
      );
    } catch (e) {
      handleFrameError(videoFile, clampedSeekPos, e);
      return;
    }

    if (!image) {
      handleFrameError(videoFile, clampedSeekPos, 'No image returned');
      return;
    }

    image.fileStartTime = status.startTime / 1000;
    image.fileEndTime = status.endTime / 1000;
    image.tzOffset = status.tzOffset;
    image.sidecar = status.sidecar;
    setImage(image);

    if (seekPercent !== undefined || toTimestamp !== undefined) {
      setVideoFrameNum(image.frameNum);
    }
    setVideoError(undefined);
  } catch (e) {
    handleFrameError(videoFile, frameNum ?? 1, e);
  }
};

let running = false;
let nextRequest: {
  params: VideoFrameRequest;
  resolve: () => void;
  reject: (e: any) => void;
} | null = null;

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
      await doRequestVideoFrame(params);
      resolve();
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
export function requestVideoFrame(params: VideoFrameRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    // If a request is already queued, resolve its promise
    if (nextRequest) {
      nextRequest.resolve();
    }
    nextRequest = { params, resolve, reject };
    runQueue();
  });
}

/**
 * Seeks the video to the specified timestamp by selecting the appropriate video file
 * and requesting a video frame at that time. Updates the selected index and video file,
 * and handles errors using the application's error dialog.
 *
 * @param timestamp - The target timestamp in 'HH:MM:SS.sss' format to seek to.
 */
export const seekToTimestamp = (timestamp: string) => {
  const jumpTime = parseTimeToSeconds(timestamp);
  const dirs = getDirList();
  let fileIndex = -1;
  for (let i = 0; i < dirs.length; i += 1) {
    const time = parseTimeToSeconds(extractTime(dirs[i]));
    if (time > jumpTime) {
      break;
    }
    fileIndex = i;
  }
  if (fileIndex >= 0) {
    setSelectedIndex(fileIndex);
    setVideoFile(dirs[fileIndex]);
    requestVideoFrame({
      videoFile: dirs[fileIndex],
      toTimestamp: timestamp,
      blend: false,
      saveAs: '',
      closeTo: false,
    }).catch(showErrorDialog);
  }
};
