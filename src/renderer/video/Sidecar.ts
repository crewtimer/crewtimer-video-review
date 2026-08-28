import { KeyMap } from 'crewtimer-common';
import { replaceFileSuffix } from 'renderer/util/Util';
import { getFileStatusByName } from './VideoFileStatus';
import { getVideoFile, getVideoSettings } from './VideoSettings';
import type { TimestampContext } from './TimestampContext';
import {
  addSidecarTimestamp,
  removeSidecarTimestamp,
} from './SidecarTimestamps';

const { storeJsonFile } = window.Util;
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
      const result = await storeJsonFile(
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
 * Saves the current video guide settings and lane configuration to a sidecar JSON file associated with the video.
 *
 * If a video filename is provided, it is used; otherwise, the currently loaded video file is used.
 * Updates the sidecar data in memory and persists it to disk. Rejects if no video file is found or if required properties are missing.
 *
 * @param videoFilename - Optional path to the video file.
 * @returns A Promise that resolves when the sidecar JSON file is successfully saved, or rejects with an error.
 */
export const saveVideoSidecar = (videoFilename?: string) => {
  const { guides, laneBelowGuide } = getVideoSettings();
  const videoFile = videoFilename || getVideoFile();
  if (!videoFile) {
    return Promise.reject(new Error('No video file'));
  }
  return updateVideoSidecar(videoFile, (content) => ({
    ...content,
    guides,
    laneBelowGuide,
  }));
};

export const saveVideoSidecarTimestamp = (
  videoFile: string,
  timestamp: TimestampContext,
) =>
  updateVideoSidecar(videoFile, (content) =>
    addSidecarTimestamp(content, timestamp),
  );

export const deleteVideoSidecarTimestamp = (videoFile: string, uuid: string) =>
  updateVideoSidecar(videoFile, (content) =>
    removeSidecarTimestamp(content, uuid),
  );
