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
import { useWaypoint } from 'renderer/util/UseSettings';

export const moveToFileIndex = (
  index: number,
  seekPercent: number,
  fromClick: boolean
) => {
  const dirList = getDirList();
  index = Math.max(0, Math.min(index, dirList.length - 1));
  const videoFile = dirList[index];
  setSelectedIndex(index);
  setVideoFile(videoFile);
  requestVideoFrame({ videoFile, seekPercent, fromClick });
};
export const prevFile = () => {
  moveToFileIndex(getSelectedIndex() - 1, 1, true);
};
export const nextFile = () => {
  moveToFileIndex(getSelectedIndex() + 1, 0, true);
};

interface SxPropsArgs {
  sx?: SxProps<Theme>;
}

const FileScrubber: React.FC<SxPropsArgs> = ({ sx }) => {
  const [, setFileIndex] = useSelectedIndex();
  const [dirList] = useDirList();
  let lapdata = useClickerData() as TimeObject[];
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];

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
          frameNum: 1,
          fromClick: false,
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
        <TimeRangeIcons
          times={scoredLapdata}
          startTime={startTime}
          endTime={endTime}
          iconColor="#2e7d32"
          iconType="caret"
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
            onChange={(newValue, pct, fromClick) => {
              moveToFileIndex(newValue, pct, fromClick);
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
