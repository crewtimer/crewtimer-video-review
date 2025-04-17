/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { KeyMap } from 'crewtimer-common';
import React, { useEffect } from 'react';
import { UseDatum } from 'react-usedatum';
import { AppImage, Rect } from 'renderer/shared/AppTypes';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { setProgressBar, useInitializing } from 'renderer/util/UseSettings';
import { replaceFileSuffix, timeToMilli } from 'renderer/util/Util';
import deepequal from 'fast-deep-equal/es6/react';
import { getTimezoneOffset } from 'renderer/util/TimezoneSelector';
import { generateTestPattern } from '../util/ImageUtils';
import { extractTime, parseTimeToSeconds } from '../util/StringUtils';
import {
  Dir,
  getHyperZoomFactor,
  getImage,
  getVideoFile,
  getVideoSettings,
  GuideLine,
  setImage,
  setSelectedIndex,
  setVideoError,
  setVideoFile,
  setVideoFrameNum,
  setVideoSettings,
  setLoadVideoSidecar,
  useJumpToEndPending,
  useVideoDir,
  VideoGuidesKeys,
  VideoSidecar,
  getVideoDir,
  normalizeGuides,
} from './VideoSettings';
import { FileStatus } from './VideoTypes';
import {
  setFileStatusList,
  getFileStatusList,
  getFileStatusByName,
  updateFileStatus,
} from './VideoFileStatus';

const { storeJsonFile, readJsonFile, getFilesInDirectory } = window.Util;

const { VideoUtils } = window;

export const [useDirList, setDirList, getDirList] = UseDatum<string[]>([]);

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

// Define the structure for video frame request parameters.
type VideoFrameRequest = {
  videoFile: string; // The path or identifier of the video file.
  frameNum?: number; // The frame number to extract. Optional.
  seekPercent?: number; // Where in file to seek as percentage, Optional.
  fromClick?: boolean; // Whether the request is from a click.
  toTimestamp?: string; // The timestamp to seek to (HHMMSS.sss), Optional.
  zoom?: Rect; // The zoom window, Optional.
  blend?: boolean; // Whether to blend the frame with the previous frame, Optional.
  saveAs?: string; // optional filename in which to save a png image of the frame
  closeTo?: boolean; // Optional true to only get 'close' to the requested frame
};

let openFilename = '';

const doRequestVideoFrame = async ({
  videoFile,
  frameNum,
  seekPercent,
  fromClick,
  toTimestamp,
  zoom,
  blend,
  saveAs,
  closeTo,
}: VideoFrameRequest) => {
  if (!videoFile) {
    return;
  }

  try {
    let imageStart: AppImage | undefined;
    let imageEnd: AppImage | undefined;

    // Check if the file is already open
    const videoFileStatus = getFileStatusByName(videoFile);
    if (!videoFileStatus) {
      setVideoError(`Unable to open file: ${videoFile}`);
      return;
    }

    if (videoFile !== openFilename) {
      // close the old file
      const openFileStatus = getFileStatusByName(openFilename);
      if (openFileStatus?.open) {
        await VideoUtils.closeFile(openFilename);
        openFileStatus.open = false;
        updateFileStatus(openFileStatus);
        openFilename = '';
      }
    }

    if (!videoFileStatus.open) {
      const openStatus = await VideoUtils.openFile(videoFile);
      if (openStatus.status !== 'OK') {
        setVideoError(`Unable to open file: ${videoFile}`);
        return;
      }

      openFilename = videoFile;
      imageStart = await VideoUtils.getFrame(videoFile, 1, 0);
      if (!imageStart) {
        setVideoError(`Unable to get frame 1: ${videoFile}`);
        return;
      }

      // Sometimes the actaual number of frames is a bit less than noted
      for (let excessFrames = 0; excessFrames < 10; excessFrames += 1) {
        try {
          imageEnd = await VideoUtils.getFrame(
            videoFile,
            imageStart.numFrames - excessFrames,
            0,
          );
          imageStart.numFrames -= excessFrames;
          break;
        } catch (e) {
          console.log(
            `cant read frame ${imageStart.numFrames - excessFrames}, trying one less`,
          );
          /* ignore */
        }
      }

      if (!imageEnd) {
        setVideoError(
          `Unable to get frame ${imageStart.numFrames}: ${videoFile}`,
        );
        return;
      }

      const imageEndTime = imageEnd.tsMicro
        ? imageEnd.tsMicro
        : Math.trunc(
            imageStart.tsMicro +
              (1000000 * imageStart.numFrames) / imageStart.fps,
          );

      const fileStatus = getFileStatusList().find((f) => {
        return f.filename === videoFile;
      });
      updateFileStatus({
        filename: videoFile,
        open: true,
        numFrames: imageStart.numFrames,
        startTime: imageStart.tsMicro,
        endTime: imageEndTime,
        duration: imageEndTime - imageStart.tsMicro,
        fps: imageStart.fps,
        tzOffset: fileStatus?.tzOffset || -new Date().getTimezoneOffset(),
        sidecar: fileStatus?.sidecar || {},
      });
    }

    let seekPos =
      seekPercent !== undefined
        ? Math.round(1 + (videoFileStatus.numFrames - 1) * seekPercent)
        : frameNum !== undefined
          ? frameNum
          : 1;

    let utcMilli = 0;
    if (toTimestamp) {
      // seek one more time to get the requested frame
      const tsMilli = timeToMilli(toTimestamp);
      const delta = videoFileStatus.endTime - videoFileStatus.startTime;
      const tzOffsetMinutes = videoFileStatus.tzOffset;

      // calc the desired time in utc milliseconds
      const fileStartUtcMilli = Math.trunc(videoFileStatus.startTime / 1000);
      utcMilli =
        fileStartUtcMilli -
        (fileStartUtcMilli % (24 * 60 * 60 * 1000)) +
        tsMilli -
        tzOffsetMinutes * 60 * 1000;
      const startTime =
        (videoFileStatus.startTime + tzOffsetMinutes * 60 * 1000000) %
        (24 * 60 * 60 * 1000000);

      let seekFrame =
        1 +
        ((tsMilli * 1000 - startTime) / delta) *
          (videoFileStatus.numFrames - 1);

      if (getHyperZoomFactor() <= 1) {
        seekFrame = Math.round(seekFrame);
      }
      seekPos = seekFrame;
    }

    if (seekPos !== 0 || !imageStart) {
      seekPos = Math.max(1, Math.min(videoFileStatus.numFrames, seekPos));

      // const blend =
      //   zoom && zoom.width > 0 && zoom.height > 0 && (zoom.x > 0 || zoom.y > 0);

      if (!blend) {
        seekPos = Math.round(seekPos);
      }
      // console.log(
      //   `===GET FRAME=${JSON.stringify(
      //     { videoFile, seekPos, utcMilli, zoom, blend, saveAs, closeTo },
      //     null,
      //     2,
      //   )}`,
      // );
      imageStart = await VideoUtils.getFrame(
        videoFile,
        seekPos,
        utcMilli,
        zoom,
        blend,
        saveAs,
        closeTo,
      );
      if (!imageStart) {
        setImage(generateTestPattern());
        setVideoError(`failed to get frame for ${videoFile}@${seekPos}`);
        return;
      }
    }

    imageStart.fileStartTime = videoFileStatus.startTime / 1000;
    imageStart.fileEndTime = videoFileStatus.endTime / 1000;
    imageStart.tzOffset = videoFileStatus.tzOffset;
    imageStart.sidecar = videoFileStatus.sidecar;
    setImage(imageStart);
    if (fromClick) {
      // force a jump in the VideoScrubber
      setVideoFrameNum(imageStart.frameNum);
    }
    setVideoError(undefined);
  } catch (e) {
    console.log(
      `error opening and reading videoFile ${videoFile}`,
      e instanceof Error ? e.message : String(e),
    );
    setImage(generateTestPattern());
    setVideoError(e instanceof Error ? e.message : String(e));
  }
};

/**
 * Creates and returns a function capable of handling video frame requests.
 * This function uses closures to maintain state, allowing it to manage
 * concurrent requests by processing them one at a time and deferring new
 * requests until the current one finishes. If multiple requests are made
 * while one is in progress, only the last request will be executed next.
 *
 * @returns A function that accepts a VideoFrameRequest and returns a Promise.
 */
function createRequestVideoFrameHandler() {
  // Current active request, if any.
  let currentRequest: Promise<void> | null = null;
  // Next request to be executed, if any. Only the last deferred request is kept.
  let nextRequest: (() => void) | null = null;

  /**
   * The internal function that performs the actual processing of a request.
   * This is where the logic for video frame extraction should be implemented.
   *
   * @param {VideoFrameRequest} The parameters for the video frame request.
   * @returns {Promise<void>} A promise that resolves when the processing is done.
   */
  const handleRequest = async ({
    videoFile,
    frameNum,
    seekPercent,
    fromClick,
    toTimestamp,
    zoom,
    blend,
    saveAs,
    closeTo,
  }: VideoFrameRequest): Promise<void> => {
    // Start processing the request
    currentRequest = (async () => {
      await doRequestVideoFrame({
        videoFile,
        frameNum,
        seekPercent,
        fromClick,
        toTimestamp,
        zoom,
        blend,
        saveAs,
        closeTo,
      });
    })();

    // Ensure that the currentRequest is cleared and the next request is executed.
    try {
      await currentRequest;
    } finally {
      currentRequest = null;
      if (nextRequest) {
        // If there's a deferred request, execute it next.
        const toExecuteNext = nextRequest;
        nextRequest = null;
        toExecuteNext();
      }
    }
  };

  /**
   * Handles a video frame extraction request. If another request is already
   * being processed, this request is deferred until the current one completes.
   * Only the last request made during an ongoing operation will be queued next.
   *
   * @param {VideoFrameRequest} The parameters for the video frame request.
   * @returns {Promise<void>} A promise that resolves when the request is processed.
   */
  const requestVideoFrame = async ({
    videoFile,
    frameNum,
    seekPercent,
    fromClick,
    toTimestamp,
    zoom,
    blend,
    saveAs,
    closeTo,
  }: VideoFrameRequest): Promise<void> => {
    if (!getDirList().includes(videoFile)) {
      return Promise.resolve();
    }
    // Check if there is an ongoing request.
    if (currentRequest) {
      // Defer the request by wrapping it in a new Promise.
      return new Promise((resolve, reject) => {
        nextRequest = () => {
          handleRequest({
            videoFile,
            frameNum,
            seekPercent,
            fromClick,
            toTimestamp,
            zoom,
            blend,
            saveAs,
            closeTo,
          })
            .then(resolve)
            .catch(reject);
        };
      });
    }
    // If no ongoing request, handle this request immediately.
    return handleRequest({
      videoFile,
      frameNum,
      seekPercent,
      fromClick,
      toTimestamp,
      zoom,
      blend,
      saveAs,
      closeTo,
    });
  };

  // Return the requestVideoFrame function that clients can use.
  return requestVideoFrame;
}

// Create a handler for video frame requests.
export const requestVideoFrame = createRequestVideoFrameHandler();

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
  await doRequestVideoFrame({
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

export const seekToTimestamp = (timestamp: string, fromClick?: boolean) => {
  const jumpTime = parseTimeToSeconds(timestamp);
  const dirs = getDirList();
  // search files till time is > file timestamp
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
      frameNum: 1,
      fromClick,
      toTimestamp: timestamp,
      blend: fromClick !== true,
      saveAs: '',
      closeTo: false,
    }).catch(showErrorDialog);
  }
};

/**
 * Save the video guide settings to a JSON file.  The JSON file is named after the video file
 *
 * @returns
 */
export const saveVideoSidecar = () => {
  const { guides, laneBelowGuide } = getVideoSettings();

  const videoFile = getVideoFile();
  if (videoFile) {
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
    return storeJsonFile(replaceFileSuffix(videoFile, 'json'), content);
  }
  return Promise.reject(new Error('No video file'));
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
      if (filename === openFilename) {
        // close the old file so we can delete if necessary
        console.log('===== Closing open file ======');
        const openFileStatus = getFileStatusByName(openFilename);
        if (openFileStatus?.open) {
          await VideoUtils.closeFile(openFilename);
          openFileStatus.open = false;
          updateFileStatus(openFileStatus);
          openFilename = '';
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
