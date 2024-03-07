import { useEffect } from 'react';
import { UseDatum } from 'react-usedatum';
import { AppImage } from 'renderer/shared/AppTypes';
import {
  getImage,
  getVideoFile,
  setImage,
  setVideoDir,
  setVideoFile,
  setVideoPosition,
  useVideoDir,
  useVideoFile,
  useVideoPosition,
} from './VideoSettings';

const VideoUtils = window.VideoUtils;
const { getFilesInDirectory } = window.Util;

interface OpenFileStatus {
  open: boolean;
  numFrames: number;
}

const FileCache = new Map<string, OpenFileStatus>();

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
const getDirectory = (fullFilename: string): string => {
  // Regex to match the last occurrence of a slash (either forward or backward)
  const regex = /[/\\](?=[^/\\]*$)/;

  // Find the last occurrence of a slash
  const index = fullFilename.search(regex);

  // If a slash is found, return the substring up to the slash
  // If no slash is found, return an empty string indicating the file is in the current directory
  return index >= 0 ? fullFilename.substring(0, index) : '';
};

export const openSelectedFile = async (
  videoFile: string,
  seekToEnd: boolean = false
) => {
  if (!videoFile) {
    return;
  }

  try {
    let image: AppImage | undefined;
    // Check if the file is already open
    let fileStatus = FileCache.get(videoFile);
    if (!fileStatus) {
      let openStatus = await VideoUtils.openFile(videoFile);
      if (openStatus.status !== 'OK') {
        return;
      }
      image = await VideoUtils.getFrame(videoFile, 1);
      fileStatus = { open: true, numFrames: image.numFrames };
      FileCache.set(videoFile, fileStatus);
    }

    const seekPos = seekToEnd ? fileStatus.numFrames : 1;
    if (seekPos !== 0 || !image) {
      image = await VideoUtils.getFrame(videoFile, seekPos);
    }

    setVideoPosition({ file: videoFile, frameNum: seekPos });
    setVideoFile(videoFile);
    setVideoDir(getDirectory(videoFile));
    setImage(image);
  } catch (e) {
    console.log(
      `error opening videoFile ${videoFile}`,
      e instanceof Error ? e.message : String(e)
    );
  }
};

interface FileInfo {
  filename: string;
  numFrames?: number;
  thumbnail?: string;
}
export const [useFileList] = UseDatum<FileInfo[]>([]);
export const [useDirList, setDirList, getDirList] = UseDatum<string[]>([]);

const videoFileRegex = /\.(mp4|avi|mov|wmv|flv|mkv)$/i;
const refreshDirList = (videoDir: string) => {
  getFilesInDirectory(videoDir).then((result) => {
    if (!result || result?.error) {
      console.log('invalid response to getFilesInDirectory for ' + videoDir);
    } else {
      const files = result.files.filter((file) => videoFileRegex.test(file));
      files.sort((a, b) => {
        // Use localeCompare for natural alphanumeric sorting
        return a.localeCompare(b, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      });
      const dirList = files.map((file) => `${videoDir}/${file}`);
      setDirList(dirList);
      if (dirList.length > 0 && !dirList.includes(getVideoFile())) {
        openSelectedFile(dirList[0]);
      }
      // console.log(files);
    }
  });
};

const FileMonitor: React.FC = () => {
  const [videoDir] = useVideoDir();
  const [videoPosition] = useVideoPosition();
  const [videoFile] = useVideoFile();

  useEffect(() => {
    const timer = setInterval(() => {
      if (videoDir) {
        refreshDirList(videoDir);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [videoDir]);

  useEffect(() => {
    if (!videoPosition.file) {
      if (videoFile) {
        openSelectedFile(videoFile);
      }
      return;
    }

    if (videoPosition.file === getImage().file) {
      // Check position range
      if (videoPosition.frameNum < 1) {
        const dirList = getDirList();
        const index = dirList.indexOf(videoPosition.file);
        if (index > 0) {
          // go to end of the previous file
          openSelectedFile(dirList[index - 1], true);
        } else {
          // no prior files, stick with frameNum 1
          setVideoPosition({ ...videoPosition, frameNum: 1 });
        }
        return;
      } else if (videoPosition.frameNum > getImage().numFrames) {
        const dirList = getDirList();
        const index = dirList.indexOf(videoPosition.file);
        if (index >= 0 && index < dirList.length - 1) {
          openSelectedFile(dirList[index + 1]);
        } else {
          setVideoPosition({
            ...videoPosition,
            frameNum: getImage().numFrames,
          });
        }
        return;
      }
    }

    if (videoPosition.file) {
      VideoUtils.getFrame(videoFile, videoPosition.frameNum)
        .then((image) => {
          setImage(image);
        })
        .catch((_reason) => {
          // FIXME - set an error image?
          console.log(
            `1 error opening videoFile ${videoFile}`,
            _reason instanceof Error ? _reason.message : String(_reason)
          );
        });
    }
  }, [videoPosition, videoFile]);

  return <></>;
};
export default FileMonitor;
