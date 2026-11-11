import React, { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import PhotoCamera from '@mui/icons-material/PhotoCamera';
import { showErrorDialog } from 'renderer/util/ErrorDialog';

export type ImageSnapshot = { canvas: HTMLCanvasElement; filename: string };

let generateImageSnapshot:
  ((rawFrame: boolean) => ImageSnapshot | undefined) | undefined;
export const setGenerateImageSnapshotCallback = (
  callback: undefined | ((rawFrame: boolean) => ImageSnapshot | undefined),
) => {
  generateImageSnapshot = callback;
};

/** Save the snapshot through a save dialog, then open its folder. */
const saveSnapshot = async (rawFrame: boolean) => {
  const snapshot = generateImageSnapshot?.(rawFrame);
  if (!snapshot) {
    return;
  }
  const base64 = snapshot.canvas
    .toDataURL('image/png')
    .replace(/^data:image\/png;base64,/, '');
  // Timestamps such as 14:23:22.123 hold colons, which Finder shows as
  // slashes and Windows rejects, so keep only digits, letters, '.', '_', '-'.
  const filename = snapshot.filename.replace(/[^A-Za-z0-9._-]/g, '');
  const result = await window.Util.savePngFile(filename, [
    { suffix: '', base64 },
  ]);
  if (result.error) {
    showErrorDialog(`Failed to save image: ${result.error}`);
    return;
  }
  if (result.canceled || !result.filePath) {
    return;
  }
  const sep =
    result.filePath.lastIndexOf('\\') > result.filePath.lastIndexOf('/')
      ? '\\'
      : '/';
  await window.Util.openFileExplorer(
    result.filePath.slice(0, result.filePath.lastIndexOf(sep)),
  );
};

const ImageButton: React.FC = () => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const choose = (rawFrame: boolean) => {
    setAnchor(null);
    saveSnapshot(rawFrame).catch((error) =>
      showErrorDialog(error instanceof Error ? error.message : String(error)),
    );
  };

  return (
    <>
      <Tooltip title="Save image">
        <IconButton
          color="primary"
          aria-label="Save image"
          aria-haspopup="menu"
          component="span"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <PhotoCamera />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => choose(false)}>As shown on screen</MenuItem>
        <MenuItem onClick={() => choose(true)}>Raw Image</MenuItem>
      </Menu>
    </>
  );
};

export default ImageButton;
