import { useEffect } from 'react';
import { UseDatum } from 'react-usedatum';
import { AppImage } from 'renderer/shared/AppTypes';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { useEnableVideo, useInitializing } from 'renderer/util/UseSettings';
import { timeToMilli } from 'renderer/util/Util';
import {
  getImage,
  getTimezoneOffset,
  getVideoFile,
  setImage,
  setSelectedIndex,
  setVideoError,
  setVideoFile,
  setVideoFrameNum,
  useVideoDir,
} from './VideoSettings';
import { extractTime, parseTimeToSeconds } from './VideoUtils';

const VideoUtils = window.VideoUtils;
const { getFilesInDirectory } = window.Util;

interface OpenFileStatus {
  open: boolean;
  numFrames: number;
  filename: string;
  startTime: number;
  fps: number;
  endTime: number;
}

let openFileStatus: OpenFileStatus = {
  open: false,
  numFrames: 0,
  filename: '',
  startTime: 0,
  endTime: 0,
  fps: 60,
};

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
};

const doRequestVideoFrame = async ({
  videoFile,
  frameNum,
  seekPercent,
  fromClick,
  toTimestamp,
}: VideoFrameRequest) => {
  if (!videoFile) {
    return;
  }
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
      imageStart = await VideoUtils.getFrame(videoFile, 1);
      try {
        imageEnd = await VideoUtils.getFrame(videoFile, imageStart.numFrames);
      } catch (e) {}
      if (!imageEnd) {
        // Sometimes the frame count is one too many (e.g. output.mp4 test file).  Try reducing count by one.
        imageEnd = await VideoUtils.getFrame(
          videoFile,
          imageStart.numFrames - 1
        );
        imageStart.numFrames = imageStart.numFrames - 1;
      }
      const imageEndTime = imageEnd.timestamp
        ? imageEnd.timestamp
        : Math.trunc(
            imageStart.timestamp +
              (1000 * imageStart.numFrames) / imageStart.fps
          );

      openFileStatus = {
        filename: videoFile,
        open: true,
        numFrames: imageStart.numFrames,
        startTime: imageStart.timestamp,
        endTime: imageEndTime,
        fps: imageStart.fps,
      };
      // console.log(JSON.stringify(openFileStatus, null, 2));
    }

    let seekPos =
      seekPercent !== undefined
        ? Math.round(1 + (openFileStatus.numFrames - 1) * seekPercent)
        : frameNum !== undefined
        ? frameNum
        : 1;

    if (toTimestamp) {
      // seek one more time to get the requested frame
      const secs = timeToMilli(toTimestamp);
      const delta = openFileStatus.endTime - openFileStatus.startTime;
      const tzOffsetMinutes = getTimezoneOffset();
      const offset =
        tzOffsetMinutes !== undefined
          ? tzOffsetMinutes
          : -new Date().getTimezoneOffset();
      const startTime =
        (openFileStatus.startTime + offset * 60 * 1000) % (24 * 60 * 60 * 1000);
      const frameNum =
        1 +
        Math.trunc(
          0.5 + ((secs - startTime) / delta) * (openFileStatus.numFrames - 1)
        );
      seekPos = frameNum;
    }

    if (seekPos !== 0 || !imageStart) {
      seekPos = Math.max(1, Math.min(openFileStatus.numFrames, seekPos));
      imageStart = await VideoUtils.getFrame(videoFile, seekPos);
      if (!imageStart) {
        console.log(`failed to get frame for ${videoFile}@${seekPos}`);
      }
    }

    imageStart.fileStartTime = openFileStatus.startTime;
    imageStart.fileEndTime = openFileStatus.endTime;
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
      });
    }
  };

  /**
   * The internal function that performs the actual processing of a request.
   * This is where the logic for video frame extraction should be implemented.
   * Currently, it simulates processing with a console log and a timeout.
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
  }: VideoFrameRequest): Promise<void> => {
    // Start processing the request
    currentRequest = (async () => {
      await doRequestVideoFrame({
        videoFile,
        frameNum,
        seekPercent,
        fromClick,
        toTimestamp,
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

interface FileInfo {
  filename: string;
  numFrames?: number;
  thumbnail?: string;
}
export const [useFileList] = UseDatum<FileInfo[]>([]);
export const [useDirList, setDirList, getDirList] = UseDatum<string[]>([]);

const videoFileRegex = /\.(mp4|avi|mov|wmv|flv|mkv)$/i;
export const refreshDirList = async (videoDir: string) => {
  return new Promise((resolve, reject) => {
    getFilesInDirectory(videoDir)
      .then((result) => {
        if (!result || result?.error) {
          console.log(
            'invalid response to getFilesInDirectory for ' + videoDir
          );
          setDirList([]);
        } else {
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
          setDirList(dirList);
          const needImage = getImage().file === '';
          if (needImage && dirList.includes(getVideoFile())) {
            setVideoFile(getVideoFile());
            requestVideoFrame({ videoFile: getVideoFile(), frameNum: 0 });
          }
          if (dirList.length > 0 && !dirList.includes(getVideoFile())) {
            setVideoFile(dirList[0]);
            requestVideoFrame({ videoFile: dirList[0], frameNum: 0 });
          }
          // console.log(files);
        }
        resolve(true);
      })
      .catch(reject);
  });
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
 * The component that monitors the video directory for changes.
 */
const FileMonitor: React.FC = () => {
  const [videoDir] = useVideoDir();
  const [initializing] = useInitializing();
  const [enableVideo] = useEnableVideo();

  useEffect(() => {
    if (initializing || !enableVideo) {
      return;
    }
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
