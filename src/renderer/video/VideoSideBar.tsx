import Paper from '@mui/material/Paper';
import { Button, SxProps, Theme } from '@mui/material';
const { openFileDialog } = window.Util;
import makeStyles from '@mui/styles/makeStyles';
import FileList from '../FileList';
import { openSelectedFile } from './VideoFileUtils';
import { useDirList } from './VideoFileUtils';

const useStyles = makeStyles((_theme) => ({
  button: { margin: '0.5em' },
}));

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
  const [dirList] = useDirList();

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
