import React from 'react';
import Paper from '@mui/material/Paper';
import { Button, SxProps, Theme, Tooltip } from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import FileList from '../FileList';
import { useDirList } from './VideoFileUtils';
import { useVideoDir } from './VideoSettings';

const { openDirDialog } = window.Util;

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
    <Paper
      sx={{
        maxWidth: '100%',
        height: height - 8,
        ...sx,
      }}
    >
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
          Choose Folder
        </Button>
      </Tooltip>
      <FileList files={dirList} height={height - 8 - 35} />
    </Paper>
  );
};

export default VideoSideBar;
