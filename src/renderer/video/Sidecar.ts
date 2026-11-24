import { KeyMap } from 'crewtimer-common';
import { replaceFileSuffix } from 'renderer/util/Util';
import { getFileStatusByName } from './VideoFileStatus';
import {
  getTravelRightToLeft,
  getVideoFile,
  getVideoSettings,
} from './VideoSettings';
import type { TimestampContext } from './TimestampContext';
import {
  addSidecarTimestamp,
  removeSidecarTimestamp,
} from './SidecarTimestamps';

const sidecarWriteQueues = new Map<string, Promise<void>>();

const updateVideoSidecar = (
  videoFile: string,
  update: (content: KeyMap) => KeyMap,
) => {
  const priorWrite = sidecarWriteQueues.get(videoFile) ?? Promise.resolve();
  const write = priorWrite
    .catch(() => undefined)
    .then(async () => {
      const fileInfo = getFileStatusByName(videoFile);
      const content = update({ ...fileInfo?.sidecar });
      if (!content.file) {
        throw new Error(`Missing property 'file' in sidecar for ${videoFile}`);
      }
      const result = await window.Util.storeJsonFile(
        replaceFileSuffix(videoFile, 'json'),
        content,
      );
      if (result.status !== 'OK') {
        throw new Error(result.error || result.status);
      }
      if (fileInfo) {
        fileInfo.sidecar = content;
      }
      return undefined;
    });
  sidecarWriteQueues.set(
    videoFile,
    write.then(
      () => undefined,
      () => undefined,
    ),
  );
  return write;
};

/**
 * The sidecar with the current guides, lane position, lane guides on or off
 * and course area, and
 * the current travel direction when it has none. A travel direction already
 * in the sidecar is kept; only {@link saveVideoSidecarTravelDirection}
 * changes it.
 */
const withCurrentSetup = (content: KeyMap): KeyMap => {
  const { guides, laneBelowGuide, enableLaneGuides, courseArea } =
    getVideoSettings();
  return {
    ...content,
    guides,
    laneBelowGuide,
    enableLaneGuides,
    courseArea,
    travelRightToLeft:
      typeof content.travelRightToLeft === 'boolean'
        ? content.travelRightToLeft
        : getTravelRightToLeft(),
  };
};

/**
 * Saves the current video setup to the sidecar JSON file associated with the
 * video (see {@link withCurrentSetup}). Called when a setting changes; just
 * opening a video never writes its sidecar.
 *
 * If a video filename is provided, it is used; otherwise, the currently loaded video file is used.
 * Updates the sidecar data in memory and persists it to disk. Rejects if no video file is found or if required properties are missing.
 *
 * @param videoFilename - Optional path to the video file.
 * @returns A Promise that resolves when the sidecar JSON file is successfully saved, or rejects with an error.
 */
export const saveVideoSidecar = (videoFilename?: string) => {
  const videoFile = videoFilename || getVideoFile();
  if (!videoFile) {
    return Promise.reject(new Error('No video file'));
  }
  return updateVideoSidecar(videoFile, withCurrentSetup);
};

/**
 * Whether the file section measured when a video opens differs from the one
 * saved in its sidecar. Times are compared as numbers, so a different way of
 * writing the same time is not a change.
 */
export const sidecarFileChanged = (
  saved: KeyMap | undefined,
  measured: KeyMap,
) =>
  !saved ||
  Math.abs(Number(saved.startTs) - Number(measured.startTs)) > 1e-6 ||
  Math.abs(Number(saved.stopTs) - Number(measured.stopTs)) > 1e-6 ||
  saved.numFrames !== measured.numFrames ||
  saved.fps !== measured.fps ||
  saved.tzOffset !== measured.tzOffset;

/**
 * Saves the file section measured when the video opened, held in the cached
 * sidecar, leaving the rest of the sidecar as it is on disk.
 */
export const saveVideoSidecarFile = (videoFile: string) =>
  updateVideoSidecar(videoFile, (content) => content);

/**
 * Saves a travel direction to the current video's sidecar. Only an
 * explicit choice is saved, so automatic sidecar saves never copy one clip's
 * direction onto another.
 */
export const saveVideoSidecarTravelDirection = (travelRightToLeft: boolean) => {
  const videoFile = getVideoFile();
  if (!videoFile) {
    return Promise.reject(new Error('No video file'));
  }
  return updateVideoSidecar(videoFile, (content) => ({
    ...content,
    travelRightToLeft,
  }));
};

/**
 * Saves a recorded time to a video's sidecar. For the open video, the setup
 * the time was recorded with is saved too.
 */
export const saveVideoSidecarTimestamp = (
  videoFile: string,
  timestamp: TimestampContext,
) =>
  updateVideoSidecar(videoFile, (content) =>
    addSidecarTimestamp(
      videoFile === getVideoFile() ? withCurrentSetup(content) : content,
      timestamp,
    ),
  );

export const deleteVideoSidecarTimestamp = (videoFile: string, uuid: string) =>
  updateVideoSidecar(videoFile, (content) =>
    removeSidecarTimestamp(content, uuid),
  );
