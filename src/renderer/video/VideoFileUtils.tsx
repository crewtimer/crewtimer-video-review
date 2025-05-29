/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { KeyMap } from 'crewtimer-common';
import React, { useEffect } from 'react';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { setProgressBar, useInitializing } from 'renderer/util/UseSettings';
import { replaceFileSuffix } from 'renderer/util/Util';
import deepequal from 'fast-deep-equal/es6/react';
import { getTimezoneOffset } from 'renderer/util/TimezoneSelector';
import { extractTime } from '../util/StringUtils';
import {
  Dir,
  getImage,
  getVideoFile,
  getVideoSettings,
  GuideLine,
  setVideoFile,
  setVideoSettings,
  setLoadVideoSidecar,
  useJumpToEndPending,
  useVideoDir,
  VideoGuidesKeys,
  VideoSidecar,
  getVideoDir,
  normalizeGuides,
  getDirList,
  setDirList,
} from './VideoSettings';
import { FileStatus } from './VideoTypes';
import {
  setFileStatusList,
  getFileStatusByName,
  updateFileStatus,
} from './VideoFileStatus';
import {
  getOpenFilename,
  requestVideoFrame,
  setOpenFilename,
} from './RequestVideoFrame';

const { storeJsonFile, readJsonFile, getFilesInDirectory } = window.Util;

const { VideoUtils } = window;

/**
 * Extracts the directory path from a full filename across different operating systems.
 *
 * This function takes a full filename (including the path) as input and returns the directory
 * path portion of the input, effectively removing the file name and extension. It is designed
 * to work with both Windows-style paths (using backslashes) and POSIX-style paths (using forward slashes),
 * making it versatile for cross-platform applications.
 *
 * @param {string} fullFilename - The full filename including its path.
 * @returns {string} The directory path of the given filename. If the filename does not contain
 * a directory path (i.e., it's in the current directory), an empty string is returned.
 *
 * @example
 * // For a Windows path
 * console.log(getDirectoryPath('C:\\Users\\Username\\Documents\\file.txt'));
 * // Output: "C:\\Users\\Username\\Documents"
 *
 * @example
 * // For a macOS/Linux path
 * console.log(getDirectoryPath('/Users/Username/Documents/file.txt'));
 * // Output: "/Users/Username/Documents"
 */
export const getDirectory = (fullFilename: string): string => {
  // Regex to match the last occurrence of a slash (either forward or backward)
  const regex = /[/\\](?=[^/\\]*$)/;

  // Find the last occurrence of a slash
  const index = fullFilename.search(regex);

  // If a slash is found, return the substring up to the slash
  // If no slash is found, return an empty string indicating the file is in the current directory
  return index >= 0 ? fullFilename.substring(0, index) : '';
};

/**
 * Inserts an extra directory before the filename in a given file path.
 * Works in a browser/Electron renderer context without using Node.js path module.
 *
 * @param filePath - The absolute or relative path to the file (Linux or Windows format).
 * @param extraDir - The name of the extra directory to insert.
 * @returns The modified path with the extra directory inserted.
 *
 * @example
 * insertDirectoryBeforeFilename("/foo/bar.png", "archive");
 * // Output: "/foo/archive/bar.png"
 *
 * @example
 * insertDirectoryBeforeFilename("C:\\Users\\User\\file.txt", "backup");
 * // Output: "C:\\Users\\User\\backup\\file.txt"
 */
function insertDirectoryBeforeFilename(
  filePath: string,
  extraDir: string,
): string {
  // Detect whether the path uses Windows or Unix-style delimiters
  const isWindows = filePath.includes('\\');
  const separator = isWindows ? '\\' : '/';

  // Find the last occurrence of the separator to separate the path from the filename
  const lastIndex = filePath.lastIndexOf(separator);

  // Extract directory path and filename
  const dirName = lastIndex !== -1 ? filePath.substring(0, lastIndex) : '';
  const fileName =
    lastIndex !== -1 ? filePath.substring(lastIndex + 1) : filePath;

  // Construct the new path
  return `${dirName}${separator}${extraDir}${separator}${fileName}`;
}

/**
 *  Read the current video guide settings from a JSON file.  The JSON file is named after the video file
 *
 * @param videoFile - The path to the video file
 * @param loadOnly - If true, do not update the video settings
 */
const loadVideoSidecar = (
  videoFile: string,
  loadOnly?: boolean,
): Promise<VideoSidecar | undefined> => {
  let videoSidecar: VideoSidecar;
  return readJsonFile(replaceFileSuffix(videoFile, 'json'))
    .then((result) => {
      if (result.status === 'OK') {
        videoSidecar = { ...result?.json } as VideoSidecar;

        if (!loadOnly) {
          if (videoSidecar.file.tzOffset === undefined) {
            // Add tz if not already present
            videoSidecar.file = {
              ...videoSidecar.file,
              tzOffset: -new Date().getTimezoneOffset(),
            };
          }

          // override current settings from sidecar
          const videoSettings = { ...getVideoSettings() };
          VideoGuidesKeys.forEach((key) => {
            if (videoSidecar[key]) {
              (videoSettings as any)[key] = videoSidecar[key];
            }
          });
          normalizeGuides(videoSettings.guides);

          if (videoSidecar.guide && !videoSidecar.guides) {
            // Provide default from video sidecar if not already set
            const sidecarGuide = {
              dir: Dir.Vert,
              pt1: videoSidecar.guide.pt1 as number,
              pt2: videoSidecar.guide.pt2 as number,
              label: 'Finish',
              enabled: true,
            } as GuideLine;
            const finishGuideIndex = videoSettings.guides.findIndex(
              (g) => g.label === 'Finish',
            );
            if (finishGuideIndex >= 0) {
              videoSettings.guides[finishGuideIndex] = sidecarGuide;
            } else {
              videoSettings.guides.push(sidecarGuide);
            }
          }
          setVideoSettings({
            ...videoSettings,
            sidecarSource: videoFile,
          });
        }
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return videoSidecar;
    })
    .catch((error) => {
      console.log(
        'loadVideoSidecar error',
        error instanceof Error ? error.message : String(error),
      );
      // showErrorDialog(error);  Do not show error but return empty result.
      return undefined;
    });
};

const createSidecarFile = async (
  file: string,
): Promise<VideoSidecar | undefined> => {
  const tzOffset = getTimezoneOffset();
  await requestVideoFrame({
    videoFile: file,
    frameNum: 1,
  });
  const image = getImage();
  if (image) {
    const sidecar = await loadVideoSidecar(file, true);
    if (sidecar?.file) {
      if (sidecar.file.tzOffset !== tzOffset) {
        sidecar.file.tzOffset = tzOffset;
        await storeJsonFile(replaceFileSuffix(file, 'json'), sidecar);
      } else {
        console.log(`skipping ${file}.  file info already exists`);
      }
      return sidecar;
    }
    const content: VideoSidecar = {
      file: {
        startTs: `${image.fileStartTime / 1000}`,
        stopTs: `${image.fileEndTime / 1000}`,
        numFrames: image.numFrames,
        fps: image.fps,
        tzOffset,
      },
      ...sidecar,
    } as VideoSidecar;
    await storeJsonFile(replaceFileSuffix(file, 'json'), content);
    return content;
  }
  return undefined;
};
export const addSidecarFiles = async () => {
  try {
    const files = getDirList();
    let count = 0;
    for (const file of files) {
      await createSidecarFile(file);
      count += 1;
      setProgressBar((count / files.length) * 100);
    }
    setDirList([]); // Trigger reload of the video list
    setFileStatusList([]);
  } catch (e) {
    showErrorDialog(e);
  }
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

const videoFileRegex = /\.(mp4|avi|mov|wmv|flv|mkv)$/i;
export const refreshDirList = async (videoDir: string) => {
  try {
    const result = await getFilesInDirectory(videoDir);
    if (!result || result?.error) {
      setDirList([]);
      setFileStatusList([]);
      return;
    }

    const files = result.files
      .filter((file) => videoFileRegex.test(file))
      .filter((file) => !file.includes('tmp') && !file.startsWith('._'));

    // Sort files by the embedded time in the filename
    const fileInfo = files.map((file) => ({
      name: file,
      time: extractTime(file),
    }));
    fileInfo.sort((a, b) => {
      // Use localeCompare for natural alphanumeric sorting
      return a.time.localeCompare(b.time, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
    const dirList = fileInfo.map(
      (file) => `${videoDir}${window.platform.pathSeparator}${file.name}`,
    );
    if (deepequal(dirList, getDirList())) {
      return; // no change
    }
    const fileStatusList: FileStatus[] = [];
    for (const file of dirList) {
      let fileStatus = getFileStatusByName(file);
      if (fileStatus) {
        fileStatusList.push(fileStatus);
      } else {
        let videoSidecar = await loadVideoSidecar(file, true);
        if (!videoSidecar) {
          videoSidecar = await createSidecarFile(file);
        }
        fileStatus = {
          open: false,
          numFrames: 0,
          filename: file,
          startTime: 0,
          endTime: 300,
          duration: 300,
          fps: 60,
          tzOffset: -new Date().getTimezoneOffset(),
          sidecar: videoSidecar || {},
        };

        if (videoSidecar?.file) {
          fileStatus.numFrames = videoSidecar.file.numFrames;
          fileStatus.startTime = Number(videoSidecar.file.startTs) * 1000000;
          fileStatus.endTime = Number(videoSidecar.file.stopTs) * 1000000;
          fileStatus.duration = fileStatus.endTime - fileStatus.startTime;
          fileStatus.fps = videoSidecar.file.fps || 60;
          fileStatus.tzOffset =
            videoSidecar.file.tzOffset === undefined
              ? fileStatus.tzOffset
              : videoSidecar.file.tzOffset;
        }
        updateFileStatus(fileStatus);
        fileStatusList.push(fileStatus);
      }
    }

    setDirList(dirList);
    setFileStatusList(fileStatusList);

    // If no video file is selected, select the first one
    const needImage = getImage().file === '';
    if (needImage && dirList.includes(getVideoFile())) {
      setVideoFile(getVideoFile());
      requestVideoFrame({ videoFile: getVideoFile(), frameNum: 0 });
    }
    if (dirList.length > 0 && !dirList.includes(getVideoFile())) {
      // If no video file is selected, select the first one
      setVideoFile(dirList[0]);
      requestVideoFrame({ videoFile: dirList[0], frameNum: 0 });
    }
  } catch (e) {
    showErrorDialog(e);
  }
};

/**
 * The component that monitors the video directory for changes.
 */
const FileMonitor: React.FC = () => {
  const [videoDir] = useVideoDir();
  const [initializing] = useInitializing();
  const [jumpToEndPending] = useJumpToEndPending();

  useEffect(() => {
    if (initializing) {
      return undefined;
    }
    refreshDirList(videoDir);
    const timer = setInterval(
      () => {
        if (videoDir) {
          refreshDirList(videoDir);
        }
      },
      jumpToEndPending ? 500 : 4000,
    );
    return () => clearInterval(timer);
  }, [videoDir, initializing, jumpToEndPending]);

  return <></>;
};

export const archiveVideoFiles = async (fileList: FileStatus[]) => {
  if (fileList.length === 0) {
    return;
  }
  try {
    const newDir = getDirectory(
      insertDirectoryBeforeFilename(fileList[0].filename, 'archive'),
    );
    await window.Util.mkdir(newDir);
    for (let i = 0; i < fileList.length; i += 1) {
      const { filename } = fileList[i];
      if (filename === getOpenFilename()) {
        // close the old file so we can delete if necessary
        console.log('===== Closing open file ======');
        const openFileStatus = getFileStatusByName(getOpenFilename());
        if (openFileStatus?.open) {
          await VideoUtils.closeFile(getOpenFilename());
          openFileStatus.open = false;
          updateFileStatus(openFileStatus);
          setOpenFilename('');
        }
      }

      const fromFile = replaceFileSuffix(filename, 'json');
      let toFile = insertDirectoryBeforeFilename(fromFile, 'archive');

      let result = await window.Util.renameFile(fromFile, toFile).catch(
        (_e) => {
          /* ignore */
        },
      );
      toFile = insertDirectoryBeforeFilename(filename, 'archive');
      result = await window.Util.renameFile(filename, toFile).catch((e) =>
        showErrorDialog(e),
      );
      if (result && result.error) {
        showErrorDialog(result.error);
        break;
      }
    }
    await refreshDirList(getVideoDir());
  } catch (e) {
    /* ignore */
  }
};

// Init the settings handler to avoid dpenendency loops
setLoadVideoSidecar(loadVideoSidecar);
export default FileMonitor;
