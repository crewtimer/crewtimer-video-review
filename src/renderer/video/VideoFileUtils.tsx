import { useEffect } from 'react';
import { UseDatum } from 'react-usedatum';
import { AppImage } from 'renderer/shared/AppTypes';
import {
  getImage,
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

function getDirectory(filePath: string): string {
  const parts = filePath.split('/');
  // Remove the last part (filename)
  parts.pop();
  // Rejoin the remaining parts to get the directory path
  return parts.join('/');
}

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
      image = await VideoUtils.getFrame(videoFile, 0);
      fileStatus = { open: true, numFrames: image.numFrames };
      FileCache.set(videoFile, fileStatus);
    }

    const seekPos = seekToEnd ? fileStatus.numFrames - 1 : 0;
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
    if (videoPosition.file === getImage().file) {
      // Check position range
      if (videoPosition.frameNum < 0) {
        const dirList = getDirList();
        const index = dirList.indexOf(videoPosition.file);
        if (index > 0) {
          // go to end of the previous file
          openSelectedFile(dirList[index - 1], true);
        } else {
          // no prior files, stick with frameNum 0
          setVideoPosition({ ...videoPosition, frameNum: 0 });
        }
        return;
      } else if (videoPosition.frameNum >= getImage().numFrames) {
        const dirList = getDirList();
        const index = dirList.indexOf(videoPosition.file);
        if (index >= 0 && index < dirList.length - 1) {
          openSelectedFile(dirList[index + 1]);
        } else {
          setVideoPosition({
            ...videoPosition,
            frameNum: getImage().numFrames - 1,
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
