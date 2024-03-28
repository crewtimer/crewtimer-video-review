import { Box, Button, Stack, SxProps, Theme } from '@mui/material';
import FastForwardIcon from '@mui/icons-material/FastForward';
import React, { useMemo } from 'react';
import {
  getDirList,
  refreshDirList,
  requestVideoFrame,
  useDirList,
} from './VideoFileUtils';
import {
  extractTime,
  formatSecondsAsTime,
  parseTimeToSeconds,
  triggerFileSplit,
} from './VideoUtils';
import {
  getSelectedIndex,
  getVideoDir,
  setSelectedIndex,
  setVideoFile,
  useSelectedIndex,
} from './VideoSettings';
import TimeRangeIcons, { TimeObject } from './TimeRangeIcons';
import TimeSegments from './TimeSegments';
import { useClickerData } from './UseClickerData';

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
  const [, setFileIndex] = useSelectedIndex();
  const [dirList] = useDirList();
  let lapdata = useClickerData() as TimeObject[];

  // console.log(`lapdata: ${Object.keys(lapdata || {}).length}`);

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
          seekToEnd: false,
        });
      }
    }, 1200);
  };

  let prevStartTime = '00:00:00';
  // Calc the time segment list
  const segmentList = useMemo(() => {
    const segments = dirList.map((item) => {
      let startTime = extractTime(item);
      // If not time in filename, bump prev start time by 120s
      if (!startTime) {
        startTime = formatSecondsAsTime(
          parseTimeToSeconds(prevStartTime) + 120
        );
      }
      prevStartTime = startTime;
      return { startTime, endTime: '', label: item.replace(/.*\//, '') };
    });
    segments.forEach((item, index) => {
      if (index < segments.length - 1) {
        item.endTime = segments[index + 1].startTime;
      }
    });
    if (segments.length > 0) {
      segments[segments.length - 1].endTime = formatSecondsAsTime(
        parseTimeToSeconds(segments[segments.length - 1]?.startTime) + 120
      );
    }
    return segments;
  }, [dirList]);

  const startTime = segmentList[0]?.startTime || '12:00:00';
  let endTime = segmentList[segmentList.length - 1]?.endTime || '17:00:00';

  // if (segmentList.length > 0) {
  //   // we really dont know how long a segment is until it is read. estimate instead
  //   let lastClick = Math.trunc(
  //     parseTimeToSeconds(lapdata[lapdata.length - 1]?.Time || '00:00:00')
  //   );
  //   const clickPastEnd = lastClick - parseTimeToSeconds(endTime);
  //   if (clickPastEnd > 0 && clickPastEnd < 60 * 60) {
  //     endTime = formatSecondsAsTime(lastClick + 20);
  //     segmentList[segmentList.length - 1].endTime = endTime;
  //   }
  // }
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
        &lt;
      </Button>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: '40px',

          marginLeft: '0.5em',
          marginRight: '0.5em',
        }}
      >
        <TimeRangeIcons
          times={lapdata}
          startTime={startTime}
          endTime={endTime}
          showBeyondRange={true}
        />
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <TimeSegments
            segments={segmentList}
            startTime={startTime}
            endTime={endTime}
            activeIndex={getSelectedIndex()}
            onChange={(newValue) => {
              moveToIndex(newValue, false);
            }}
          />
        </Box>
      </Box>
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
        &gt;
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
