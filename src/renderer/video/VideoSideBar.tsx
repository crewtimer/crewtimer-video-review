import Paper from '@mui/material/Paper';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Typography,
} from '@mui/material';
const { openFileDialog, getFilesInDirectory } = window.Util;
import makeStyles from '@mui/styles/makeStyles';
import {
  getVideoFile,
  setImage,
  useVideoPosition,
  useVideoDir,
  useVideoSettings,
} from './VideoSettings';
import { useEffect, useState } from 'react';
import FileList from '../FileList';
import { openSelectedFile } from './VideoHelpers';
import MenuIcon from '@mui/icons-material/Settings';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
const VideoUtils = window.VideoUtils;

const useStyles = makeStyles((theme) => ({
  button: {
    margin: theme.spacing(2, 0, 0),
  },
}));

const videoFileRegex = /\.(mp4|avi|mov|wmv|flv|mkv)$/i;

const VideoSettings = () => {
  const [videoSettings, setVideoSettings] = useVideoSettings();
  return (
    <Box>
      <Typography>Course</Typography>
      <FormControlLabel
        labelPlacement="end"
        label="Lane 1 top"
        control={
          <Checkbox
            checked={videoSettings.lane1Top}
            onChange={() => {
              setVideoSettings(
                { ...videoSettings, lane1Top: !videoSettings.lane1Top },
                true
              );
            }}
          />
        }
      />
      <FormControlLabel
        labelPlacement="end"
        label="Travel Right to Left"
        control={
          <Checkbox
            checked={videoSettings.travelRtoL}
            onChange={() => {
              setVideoSettings(
                {
                  ...videoSettings,
                  travelRtoL: !videoSettings.travelRtoL,
                },
                true
              );
            }}
          />
        }
      />
      <Typography>Guides</Typography>
      <FormControlLabel
        labelPlacement="end"
        label="Finish"
        control={
          <Checkbox
            checked={videoSettings.guides[0].enabled}
            onChange={() => {
              const guides = [...videoSettings.guides];
              guides[0].enabled = !guides[0].enabled;
              setVideoSettings({ ...videoSettings, guides }, true);
            }}
          />
        }
      />
      <Box>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((lane) => (
          <FormControlLabel
            key={lane}
            labelPlacement="end"
            label={`Lane ${lane}`}
            control={
              <Checkbox
                checked={videoSettings.guides[lane + 1].enabled}
                onChange={() => {
                  const guides = [...videoSettings.guides]; // force 'diff'
                  videoSettings.guides[lane + 1].enabled =
                    !videoSettings.guides[lane + 1].enabled;
                  setVideoSettings({ ...videoSettings, guides }, true);
                }}
              />
            }
          />
        ))}
      </Box>
    </Box>
  );
};

// Define the types for the component's props
interface CustomTableProps {
  /**
   * Width of the table. Accepts any valid CSS width value (e.g., 500px, 100%, etc.).
   */
  width: number;
}

/**
 * CustomTable displays a table of values using Material-UI with specified columns and width.
 *
 * @param props The properties passed to the component, expects a width.
 * @returns A Material-UI Table containing the rows of data.
 */
export default function VideoSideBar(props: CustomTableProps) {
  const classes = useStyles();
  const { width } = props;
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

  const handleSettings = () => {
    setDialogConfig({
      title: `Video Settings`,
      message: ``,
      content: <VideoSettings />,
      button: 'Done',
      showCancel: false,
    });
  };
  return (
    <Paper sx={{ width: width, maxWidth: '100%' }}>
      <div>
        <IconButton onClick={handleSettings} color="inherit" size="large">
          <MenuIcon />
        </IconButton>
      </div>
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
}
