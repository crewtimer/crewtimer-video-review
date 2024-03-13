import {
  Button,
  Slider,
  SliderThumb,
  Stack,
  SxProps,
  Theme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FastForwardIcon from '@mui/icons-material/FastForward';
import React from 'react';
import {
  getDirList,
  refreshDirList,
  requestVideoFrame,
  useDirList,
} from './VideoFileUtils';
import { triggerFileSplit } from './VideoUtils';
import {
  getSelectedIndex,
  getVideoDir,
  setSelectedIndex,
  setVideoFile,
  useSelectedIndex,
} from './VideoSettings';

interface CustomThumbComponentProps extends React.HTMLAttributes<unknown> {}

function CustomThumbComponent(props: CustomThumbComponentProps) {
  const { children, ...other } = props;
  return (
    <SliderThumb {...other}>
      {children}
      <div style={{ width: 24, height: 24, backgroundColor: 'green' }} />
    </SliderThumb>
  );
}

const moveToIndex = (index: number, seekToEnd: boolean) => {
  const dirList = getDirList();
  index = Math.max(0, Math.min(index, dirList.length - 1));
  const videoFile = dirList[index];
  setSelectedIndex(index);
  setVideoFile(videoFile);
  requestVideoFrame({ videoFile, seekToEnd });
};
export const prevFile = () => {
  moveToIndex(getSelectedIndex() - 1, true);
};
export const nextFile = () => {
  moveToIndex(getSelectedIndex() + 1, false);
};
interface SxPropsArgs {
  sx?: SxProps<Theme>;
}

const FileScrubber: React.FC<SxPropsArgs> = ({ sx }) => {
  const [fileIndex, setFileIndex] = useSelectedIndex();
  const [dirList] = useDirList();
  const numFiles = dirList.length;

  const handleSlider = (_event: Event, value: number | number[]) => {
    let newValue = value as number;
    moveToIndex(newValue, false);
  };

  const jumpToEnd = () => {
    // Trigger a file split, then read the files and jump to the end
    triggerFileSplit();
    setTimeout(async () => {
      await refreshDirList(getVideoDir());
      const dirs = getDirList();
      if (dirs.length) {
        setFileIndex(dirs.length - 1);
        const videoFile = dirs[dirs.length - 1];
        setVideoFile(videoFile);
        requestVideoFrame({
          videoFile: videoFile,
          seekToEnd: true,
        });
      }
    }, 400);
  };

  return (
    <Stack
      direction="row"
      style={{
        alignItems: 'center',
        width: '100%',
        paddingLeft: '0.5em',
        paddingRight: '0.5em',
        display: 'flex',
      }}
      sx={sx}
    >
      {/* <Button
        variant="contained"
        onClick={prevFile}
        size="small"
        sx={{
          height: 24,
          m: 0,
          minWidth: 24,
          background: '#19857b',
        }}
      >
        <FastRewindIcon fontSize={'small'} />
      </Button> */}
      <Button
        variant="contained"
        onClick={prevFile}
        size="small"
        sx={{
          height: 24,
          m: 0,
          minWidth: 24,
          background: '#19857b',
        }}
      >
        <ArrowBackIcon fontSize={'small'} />
      </Button>
      <Slider
        value={fileIndex}
        min={0}
        max={numFiles - 1}
        onChange={handleSlider}
        aria-labelledby="file-scrubber"
        sx={{
          marginLeft: '1em',
          marginRight: '1em',
          flex: 1,
          '& .MuiSlider-thumb': {
            transition: 'none',
          },
          '& .MuiSlider-track': {
            transition: 'none',
          },
          '& .MuiSlider-rail': {
            transition: 'none',
          },
        }}
        color="secondary"
        slots={{ thumb: CustomThumbComponent }}
        track={false}
        marks
        valueLabelFormat={() => 'test'}
      />
      <Button
        variant="contained"
        onClick={nextFile}
        size="small"
        sx={{
          height: 24,
          m: 0,
          minWidth: 24,
          background: '#19857b',
        }}
      >
        <ArrowForwardIcon fontSize={'small'} />
      </Button>
      <Button
        variant="contained"
        onClick={jumpToEnd}
        size="small"
        sx={{
          height: 24,
          m: 0,
          minWidth: 24,
          background: '#19857b',
          marginLeft: '0.5em',
        }}
      >
        <FastForwardIcon fontSize={'small'} />
      </Button>
    </Stack>
  );
};

export default FileScrubber;
