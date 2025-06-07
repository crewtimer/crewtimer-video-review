import React from 'react';
import IconButton from '@mui/material/IconButton';
import PhotoCamera from '@mui/icons-material/PhotoCamera';

let generateImageSnapshot: (() => void) | undefined;
export const setGenerateImageSnapshotCallback = (
  callback: undefined | (() => void),
) => {
  generateImageSnapshot = callback;
};

const ImageButton: React.FC = () => {
  return (
    <IconButton
      color="primary"
      aria-label="upload picture"
      component="span"
      onClick={() => {
        generateImageSnapshot?.();
      }}
    >
      <PhotoCamera />
    </IconButton>
  );
};

export default ImageButton;
