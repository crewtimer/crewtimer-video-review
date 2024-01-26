import {
  setImage,
  setVideoDir,
  setVideoFile,
  setVideoPosition,
} from './VideoSettings';

const VideoUtils = window.VideoUtils;

function getDirectory(filePath: string): string {
  const parts = filePath.split('/');
  // Remove the last part (filename)
  parts.pop();
  // Rejoin the remaining parts to get the directory path
  return parts.join('/');
}

export const openSelectedFile = (videoFile: string) => {
  if (videoFile) {
    VideoUtils.openFile(videoFile)
      .then((result) => {
        if (result.status === 'OK') {
          VideoUtils.getFrame(videoFile, 0)
            .then((image) => {
              setVideoFile(videoFile);
              setVideoDir(getDirectory(videoFile));
              setVideoPosition({ file: videoFile, frameNum: 0 });
              setImage(image);
            })
            .catch((_reason) => {
              console.log(
                `1 error opening videoFile ${videoFile}`,
                _reason instanceof Error ? _reason.message : String(_reason)
              );
            });
        } else {
          console.log(`2 error opening videoFile ${videoFile}`, result);
        }
      })
      .catch((_reason) => {
        console.log(
          `3 error opening videoFile ${videoFile}`,
          _reason instanceof Error ? _reason.message : String(_reason)
        );
      });
  }
};
