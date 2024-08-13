import { KeyMap } from 'crewtimer-common';
import { useEffect } from 'react';
import { UseDatum } from 'react-usedatum';
import { AppImage, Rect } from 'renderer/shared/AppTypes';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { setProgressBar, useInitializing } from 'renderer/util/UseSettings';
import { replaceFileSuffix, timeToMilli } from 'renderer/util/Util';
import {
  getHyperZoomFactor,
  getImage,
  getTimezoneOffset,
  getVideoFile,
  getVideoSettings,
  setImage,
  setSelectedIndex,
  setVideoError,
  setVideoFile,
  setVideoFrameNum,
  setVideoSettings,
  useVideoDir,
} from './VideoSettings';
import { extractTime, parseTimeToSeconds } from './VideoUtils';
import deepequal from 'fast-deep-equal/es6/react';
import { getAutoZoomPending } from './Video';

const { storeJsonFile, readJsonFile, getFilesInDirectory } = window.Util;

const VideoUtils = window.VideoUtils;

interface OpenFileStatus {
  open: boolean;
  numFrames: number;
  filename: string;
  startTime: number;
  endTime: number;
  duration: number;
  fps: number;
  sidecar: KeyMap;
}

let openFileStatus: OpenFileStatus = {
  open: false,
  numFrames: 0,
  filename: '',
  startTime: 0,
  endTime: 0,
  duration: 0,
  fps: 60,
  sidecar: {},
};

export const [useFileStatusList, setFileStatusList] = UseDatum<
  OpenFileStatus[]
>([]);
const fileStatusByName = new Map<string, OpenFileStatus>();

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

// Define the structure for video frame request parameters.
type VideoFrameRequest = {
  videoFile: string; // The path or identifier of the video file.
  frameNum?: number; // The frame number to extract. Optional.
  seekPercent?: number; // Where in file to seek as percentage, Optional.
  fromClick?: boolean; // Whether the request is from a click.
  toTimestamp?: string; // The timestamp to seek to (HHMMSS.sss), Optional.
  zoom?: Rect; // The zoom window, Optional.
};

const doRequestVideoFrame = async ({
  videoFile,
  frameNum,
  seekPercent,
  fromClick,
  toTimestamp,
  zoom,
}: VideoFrameRequest) => {
  if (!videoFile) {
    return;
  }
  // console.log(
  //   JSON.stringify({ videoFile, frameNum, seekPercent, fromClick, toTimestamp })
  // );
  try {
    let imageStart: AppImage | undefined;
    let imageEnd: AppImage | undefined;
    // Check if the file is already open
    if (openFileStatus.open && openFileStatus.filename !== videoFile) {
      // Changing files, close the old file
      VideoUtils.closeFile(openFileStatus.filename);
      openFileStatus.open = false;
      openFileStatus.filename = '';
    }

    if (!openFileStatus.open) {
      let openStatus = await VideoUtils.openFile(videoFile);
      if (openStatus.status !== 'OK') {
        setVideoError(`Unable to open file: ${videoFile}`);
        return;
      }
      imageStart = await VideoUtils.getFrame(videoFile, 1, 0);
      if (!imageStart) {
        setVideoError(`Unable to get frame 1: ${videoFile}`);
        return;
      }
      try {
        imageEnd = await VideoUtils.getFrame(
          videoFile,
          imageStart.numFrames,
          0
        );
      } catch (e) {}
      if (!imageEnd) {
        // Sometimes the frame count is one too many (e.g. output.mp4 test file).  Try reducing count by one.
        imageEnd = await VideoUtils.getFrame(
          videoFile,
          imageStart.numFrames - 1,
          0
        );
        imageStart.numFrames = imageStart.numFrames - 1;
        if (!imageEnd) {
          // Still not found
          setVideoError(
            `Unable to get frame ${imageStart.numFrames}: ${videoFile}`
          );
          return;
        }
      }
      const imageEndTime = imageEnd.tsMicro
        ? imageEnd.tsMicro
        : Math.trunc(
            imageStart.tsMicro +
              (1000000 * imageStart.numFrames) / imageStart.fps
          );

      openFileStatus = {
        filename: videoFile,
        open: true,
        numFrames: imageStart.numFrames,
        startTime: imageStart.tsMicro,
        endTime: imageEndTime,
        duration: imageEndTime - imageStart.tsMicro,
        fps: imageStart.fps,
        sidecar: {},
      };
      // console.log(JSON.stringify(openFileStatus, null, 2));
    }

    let seekPos =
      seekPercent !== undefined
        ? Math.round(1 + (openFileStatus.numFrames - 1) * seekPercent)
        : frameNum !== undefined
        ? frameNum
        : 1;

    let utcMilli = 0;
    if (toTimestamp) {
      // seek one more time to get the requested frame
      const tsMilli = timeToMilli(toTimestamp);
      const delta = openFileStatus.endTime - openFileStatus.startTime;
      const tzOffsetMinutes = getTimezoneOffset();
      const offset =
        tzOffsetMinutes !== undefined
          ? tzOffsetMinutes
          : -new Date().getTimezoneOffset();

      // calc the desired time in utc milliseconds
      const fileStartUtcMilli = Math.trunc(openFileStatus.startTime / 1000);
      utcMilli =
        fileStartUtcMilli -
        (fileStartUtcMilli % (24 * 60 * 60 * 1000)) +
        tsMilli -
        offset * 60 * 1000;
      const startTime =
        (openFileStatus.startTime + offset * 60 * 1000000) %
        (24 * 60 * 60 * 1000000);

      let frameNum =
        1 +
        ((tsMilli * 1000 - startTime) / delta) * (openFileStatus.numFrames - 1);

      if (getHyperZoomFactor() <= 1) {
        frameNum = Math.round(frameNum);
      }
      console.log('seeking to ' + frameNum);
      seekPos = frameNum;
    }

    if (seekPos !== 0 || !imageStart) {
      seekPos = Math.max(1, Math.min(openFileStatus.numFrames, seekPos));
      const autoZoomCoords = getAutoZoomPending();
      const zoomArg =
        autoZoomCoords && zoom?.x
          ? {
              ...zoom,
              x: autoZoomCoords.x - zoom.width / 2,
            }
          : {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
            };
      imageStart = await VideoUtils.getFrame(
        videoFile,
        seekPos,
        utcMilli,
        zoomArg
      );
      if (!imageStart) {
        console.log(`failed to get frame for ${videoFile}@${seekPos}`);
        setVideoError(`failed to get frame for ${videoFile}@${seekPos}`);
        return;
      }
    }

    imageStart.fileStartTime = openFileStatus.startTime / 1000;
    imageStart.fileEndTime = openFileStatus.endTime / 1000;
    setImage(imageStart);
    if (fromClick) {
      // force a jump in the VideoScrubber
      setVideoFrameNum(imageStart.frameNum);
    }
    setVideoError(undefined);
  } catch (e) {
    console.log(
      `error opening and reading videoFile ${videoFile}`,
      e instanceof Error ? e.message : String(e)
    );
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
  }: VideoFrameRequest): Promise<void> => {
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
          })
            .then(resolve)
            .catch(reject);
        };
      });
    } else {
      // If no ongoing request, handle this request immediately.
      return handleRequest({
        videoFile,
        frameNum,
        seekPercent,
        fromClick,
        toTimestamp,
        zoom,
      });
    }
  };

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

  // Return the requestVideoFrame function that clients can use.
  return requestVideoFrame;
}

// Create a handler for video frame requests.
export const requestVideoFrame = createRequestVideoFrameHandler();

export const [useDirList, setDirList, getDirList] = UseDatum<string[]>([]);

const videoFileRegex = /\.(mp4|avi|mov|wmv|flv|mkv)$/i;
export const refreshDirList = async (videoDir: string) => {
  try {
    const result = await getFilesInDirectory(videoDir);
    if (!result || result?.error) {
      setDirList([]);
      return;
    }

    const files = result.files
      .filter((file) => videoFileRegex.test(file))
      .filter((file) => !file.includes('tmp'));

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
      (file) => `${videoDir}${window.platform.pathSeparator}${file.name}`
    );
    if (deepequal(dirList, getDirList())) {
      return; // no change
    }
    const fileStatusList: OpenFileStatus[] = [];
    for (const file of dirList) {
      let fileStatus = fileStatusByName.get(file);
      if (fileStatus) {
        fileStatusList.push(fileStatus);
      } else {
        const videoSidecar = await loadVideoSidecar(file);
        fileStatus = {
          open: false,
          numFrames: 0,
          filename: file,
          startTime: 0,
          endTime: 300,
          duration: 300,
          fps: 60,
          sidecar: {},
        };
        if (videoSidecar.file) {
          fileStatus.numFrames = videoSidecar.file.numFrames;
          fileStatus.startTime = Number(videoSidecar.file.startTs) * 1000000;
          fileStatus.endTime = Number(videoSidecar.file.stopTs) * 1000000;
          fileStatus.duration = fileStatus.endTime - fileStatus.startTime;
          fileStatus.fps = videoSidecar.file.fps || 60;
          fileStatus.sidecar = videoSidecar;
        }
        fileStatusByName.set(file, fileStatus);
        fileStatusList.push(fileStatus);
      }
      setFileStatusList(fileStatusList);
    }
    setDirList(dirList);

    // If no video file is selected, select the first one
    const needImage = getImage().file === '';
    if (needImage && dirList.includes(getVideoFile())) {
      setVideoFile(getVideoFile());
      requestVideoFrame({ videoFile: getVideoFile(), frameNum: 0 });
    }
    if (dirList.length > 0 && !dirList.includes(getVideoFile())) {
      setVideoFile(dirList[0]);
      requestVideoFrame({ videoFile: dirList[0], frameNum: 0 });
    }
  } catch (e) {
    showErrorDialog(e);
  }
};

export const seekToTimestamp = (timestamp: string, fromClick?: boolean) => {
  const jumpTime = parseTimeToSeconds(timestamp);
  const dirs = getDirList();
  // search files till time is > file timestamp
  let fileIndex = -1;
  for (let i = 0; i < dirs.length; i++) {
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
    const fileInfo = fileStatusByName.get(videoFile);
    const content: KeyMap = {
      ...fileInfo?.sidecar,
      guides,
      laneBelowGuide,
    };
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
export const loadVideoSidecar = (videoFile: string): Promise<KeyMap> => {
  let videoSidecar = {};
  return readJsonFile(replaceFileSuffix(videoFile, 'json'))
    .then((result) => {
      if (result.status === 'OK') {
        videoSidecar = { ...result?.json };
        setVideoSettings({
          ...getVideoSettings(),
          ...result?.json,
          sidecarSource: videoFile,
        });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return videoSidecar;
    })
    .catch((error) => {
      showErrorDialog(error);
      return {};
    });
};

export const addSidecarFiles = async () => {
  try {
    const files = getDirList();
    let count = 0;
    for (const file of files) {
      await doRequestVideoFrame({
        videoFile: file,
        frameNum: 1,
      });
      const image = getImage();
      if (image) {
        const sidecar = await loadVideoSidecar(file);
        if (sidecar.file) {
          console.log(`skipping ${file}.  file info already exists`);
        } else {
          console.log(`updating ${file}`);
          await storeJsonFile(replaceFileSuffix(file, 'json'), {
            file: {
              startTs: `${image.fileStartTime / 1000}`,
              stopTs: `${image.fileEndTime / 1000}`,
              numFrames: image.numFrames,
            },
            ...sidecar,
          });
        }
      }
      setProgressBar((++count / files.length) * 100);
    }
    fileStatusByName.clear();
    setDirList([]); // Trigger reload of the video list
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

  useEffect(() => {
    if (initializing) {
      return;
    }
    fileStatusByName.clear();
    setFileStatusList([]);
    refreshDirList(videoDir);
    const timer = setInterval(() => {
      if (videoDir) {
        refreshDirList(videoDir);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [videoDir, initializing]);

  return <></>;
};
export default FileMonitor;
