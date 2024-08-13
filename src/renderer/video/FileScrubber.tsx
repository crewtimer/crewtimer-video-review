import { Box, Button, Stack, SxProps, Theme } from '@mui/material';
import FastForwardIcon from '@mui/icons-material/FastForward';
import React, { useMemo } from 'react';
import {
  getDirList,
  refreshDirList,
  requestVideoFrame,
  useDirList,
  useFileStatusList,
} from './VideoFileUtils';
import {
  moveToFileIndex,
  nextFile,
  prevFile,
  triggerFileSplit,
} from './VideoUtils';
import {
  getSelectedIndex,
  getVideoDir,
  setVideoFile,
  useSelectedIndex,
  useTimezoneOffset,
} from './VideoSettings';
import TimeRangeIcons, { TimeObject } from './TimeRangeIcons';
import TimeSegments from './TimeSegments';
import { useClickerData } from './UseClickerData';
import { useWaypoint } from 'renderer/util/UseSettings';
import {
  convertTimestampToLocalMicros,
  convertTimestampToString,
} from 'renderer/shared/Util';
import { TimeSegment } from './VideoTypes';

interface SxPropsArgs {
  sx?: SxProps<Theme>;
}

const FileScrubber: React.FC<SxPropsArgs> = ({ sx }) => {
  const [, setFileIndex] = useSelectedIndex();
  const [dirList] = useDirList();
  const [fileStatusList] = useFileStatusList();
  const [timezoneOffset] = useTimezoneOffset();
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

  // Calc the time segment list
  const segmentList = useMemo(() => {
    let totalTime = 0;
    fileStatusList.forEach((item) => {
      totalTime += item.duration;
    });
    let pctOffset = 0;
    const segments = fileStatusList.map((item) => {
      let startTime = convertTimestampToString(
        item.startTime / 1000,
        timezoneOffset
      );
      let endTime = convertTimestampToString(
        item.endTime / 1000,
        timezoneOffset
      );

      const pct = item.duration / totalTime;
      const segment: TimeSegment = {
        startTsMicro: convertTimestampToLocalMicros(
          item.startTime,
          timezoneOffset
        ),
        endTsMicro: convertTimestampToLocalMicros(item.endTime, timezoneOffset),
        startTime,
        endTime,
        pctOffset,
        pct,
        label: item.filename.replace(/.*\//, ''),
      };
      pctOffset += pct;
      return segment;
    });
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
          segments={segmentList}
          times={lapdata}
          startTime={startTime}
          endTime={endTime}
          showBeyondRange={true}
          iconType="lower"
        />
        <TimeRangeIcons
          segments={segmentList}
          times={scoredLapdata}
          startTime={startTime}
          endTime={endTime}
          iconColor="#2e7d32"
          iconType="upper"
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
