import React from 'react';
import IconButton from '@mui/material/IconButton';
import PhotoCamera from '@mui/icons-material/PhotoCamera';

let generateImageSnapshot: ((rawFrame: boolean) => void) | undefined;
export const setGenerateImageSnapshotCallback = (
  callback: undefined | ((rawFrame: boolean) => void),
) => {
  generateImageSnapshot = callback;
};

const ImageButton: React.FC = () => {
  return (
    <IconButton
      color="primary"
      aria-label="Save image. Shift-click saves the raw video frame."
      title="Save image (Shift-click for raw video frame)"
      component="span"
      onClick={(event) => {
        generateImageSnapshot?.(event.shiftKey);
      }}
    >
      <PhotoCamera />
    </IconButton>
  );
};

export default ImageButton;
