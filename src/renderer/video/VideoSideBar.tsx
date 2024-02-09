import Paper from '@mui/material/Paper';
import { Button, SxProps, Theme } from '@mui/material';
const { openFileDialog, getFilesInDirectory } = window.Util;
import makeStyles from '@mui/styles/makeStyles';
import {
  getVideoFile,
  setImage,
  useVideoPosition,
  useVideoDir,
} from './VideoSettings';
import { useEffect, useState } from 'react';
import FileList from '../FileList';
import { openSelectedFile } from './VideoHelpers';
const VideoUtils = window.VideoUtils;

const useStyles = makeStyles((_theme) => ({
  button: { margin: '0.5em' },
}));

const videoFileRegex = /\.(mp4|avi|mov|wmv|flv|mkv)$/i;

// Define the types for the component's props
interface CustomTableProps {
  sx?: SxProps<Theme>;
}

/**
 * CustomTable displays a table of values using Material-UI with specified columns and width.
 *
 * @param props The properties passed to the component, expects a width.
 * @returns A Material-UI Table containing the rows of data.
 */
const VideoSideBar: React.FC<CustomTableProps> = ({ sx }) => {
  const classes = useStyles();
  const [videoPosition] = useVideoPosition();
  const [videoDir] = useVideoDir();
  const [dirList, setDirList] = useState<string[]>([]);

  useEffect(() => {
    // wait a second to ensure getVideoFile is initialized.
    openSelectedFile(getVideoFile());
    // setTimeout(() => openSelectedFile(getVideoFile()), 1000);
  }, []);
  useEffect(() => {
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
        setDirList(files.map((file) => `${videoDir}/${file}`));
        // console.log(files);
      }
    });
  }, [videoDir]);

  useEffect(() => {
    // TODO: This useEffect could be in another component so this one didn't re-render too often
    if (videoPosition.file) {
      VideoUtils.getFrame(videoPosition.file, videoPosition.frameNum)
        .then((image) => {
          // console.log(image);
          setImage(image);
        })
        .catch((_reason) => {
          console.log('error getting frame', _reason);
        });
    }
  }, [videoPosition]);

  const chooseFile = () => {
    openFileDialog()
      .then((result) => {
        if (!result.cancelled) {
          openSelectedFile(result.filePath);
        }
      })
      .catch();
  };

  return (
    <Paper
      sx={{
        maxWidth: '100%',
        ...sx,
      }}
    >
      <Button
        size="small"
        variant="contained"
        color="primary"
        className={classes.button}
        onClick={() => {
          chooseFile();
        }}
      >
        Choose Video
      </Button>
      <FileList files={dirList} />
    </Paper>
  );
};

export default VideoSideBar;
