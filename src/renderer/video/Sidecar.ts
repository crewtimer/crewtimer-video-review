import { KeyMap } from 'crewtimer-common';
import { replaceFileSuffix } from 'renderer/util/Util';
import { getFileStatusByName } from './VideoFileStatus';
import { getVideoFile, getVideoSettings } from './VideoSettings';

const { storeJsonFile } = window.Util;

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
  const fileInfo = getFileStatusByName(videoFile);
  const content: KeyMap = {
    ...fileInfo?.sidecar,
    guides,
    laneBelowGuide,
  };
  if (!content.file) {
    return Promise.reject(
      new Error(`Missing property 'file' in sidecar for ${videoFile}`),
    );
  }
  if (fileInfo) {
    fileInfo.sidecar = content;
  }
  return storeJsonFile(replaceFileSuffix(videoFile, 'json'), content);
};
