import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Stack,
  SxProps,
  Theme,
  Tooltip,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import makeStyles from '@mui/styles/makeStyles';
import FileList from '../FileList';
import { useDirList, useVideoDir } from './VideoSettings';

const { openDirDialog, openFileExplorer } = window.Util;

const useStyles = makeStyles((_theme) => ({
  button: { margin: '0.5em', fontSize: 10 },
}));

// Define the types for the component's props
interface CustomTableProps {
  height: number;
  sx?: SxProps<Theme>;
}

/**
 * CustomTable displays a table of values using Material-UI with specified columns and width.
 *
 * @param props The properties passed to the component, expects a width.
 * @returns A Material-UI Table containing the rows of data.
 */
const VideoSideBar: React.FC<CustomTableProps> = ({ sx, height }) => {
  const classes = useStyles();
  const [dirList] = useDirList();
  const [videoDir, setVideoDir] = useVideoDir();

  const chooseDir = () => {
    openDirDialog('Choose Video Directory', videoDir)
      .then((result) => {
        if (!result.cancelled) {
          if (result.path !== videoDir) {
            setVideoDir(result.path);
          }
        }
        return undefined;
      })
      .catch((_e) => {
        /* ignore */
      });
  };

  return (
    <Box
      sx={{
        maxWidth: '100%',
        height: height - 8,
        paddingRight: '4px',
        ...sx,
      }}
    >
      <Stack direction="row">
        <Tooltip title={videoDir} placement="bottom">
          <Button
            size="small"
            variant="contained"
            color="secondary"
            className={classes.button}
            onClick={() => {
              chooseDir();
            }}
          >
            Folder
          </Button>
        </Tooltip>
        <Tooltip title="Explore Recording Folder">
          <IconButton
            color="primary"
            aria-label="Open Folder"
            onClick={() => openFileExplorer(videoDir)}
            size="small"
          >
            <OpenInNewIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <FileList files={dirList} height={height - 8 - 35} />
    </Box>
  );
};

export default VideoSideBar;
