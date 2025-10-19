import { Box, Button, Stack, SxProps, Theme, Tooltip } from '@mui/material';
import FastForwardIcon from '@mui/icons-material/FastForward';
import React, { useMemo } from 'react';
import { useWaypoint } from 'renderer/util/UseSettings';
import {
  convertTimestampToLocalMicros,
  convertTimestampToString,
} from 'renderer/shared/Util';
import {
  moveToFileIndex,
  nextFile,
  prevFile,
  triggerFileSplit,
} from './VideoUtils';
import { useSelectedIndex } from './VideoSettings';
import TimeRangeIcons from './TimeRangeIcons';
import TimeSegments from './TimeSegments';
import { useClickerData } from './UseClickerData';
import { TimeObject, TimeSegment } from './VideoTypes';
import { useFileStatusList } from './VideoFileStatus';

interface SxPropsArgs {
  sx?: SxProps<Theme>;
}

const FileScrubber: React.FC<SxPropsArgs> = ({ sx }) => {
  const [selectedIndex] = useSelectedIndex();
  const [fileStatusList] = useFileStatusList();
  const lapdata = useClickerData() as TimeObject[];
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];

  // Calc the time segment list
  const segmentList = useMemo(() => {
    let totalTime = 0;
    fileStatusList.forEach((item) => {
      totalTime += item.duration;
    });
    let pctOffset = 0;
    const segments = fileStatusList.map((item) => {
      const startTime = convertTimestampToString(
        item.startTime / 1000,
        item.tzOffset,
      );
      const endTime = convertTimestampToString(
        item.endTime / 1000,
        item.tzOffset,
      );

      const pct = item.duration / totalTime;
      const segment: TimeSegment = {
        startTsMicro: convertTimestampToLocalMicros(
          item.startTime,
          item.tzOffset,
        ),
        endTsMicro: convertTimestampToLocalMicros(item.endTime, item.tzOffset),
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
  }, [fileStatusList]);

  const startTime = segmentList[0]?.startTime || '12:00:00';
  const endTime = segmentList[segmentList.length - 1]?.endTime || '17:00:00';

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
      <Tooltip title="Previous video file" placement="top">
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
      </Tooltip>
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
          times={scoredLapdata}
          startTime={startTime}
          endTime={endTime}
          iconColor="#2e7d32"
          iconType="lower"
          fileStatusList={fileStatusList}
          resetClickTally
        />
        <TimeRangeIcons
          segments={segmentList}
          times={lapdata}
          startTime={startTime}
          endTime={endTime}
          showBeyondRange
          iconColor="#d2122e"
          iconType="upper"
          fileStatusList={fileStatusList}
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
            activeIndex={selectedIndex}
            onChange={(newValue, pct) => {
              moveToFileIndex(newValue, pct);
            }}
            fileStatusList={fileStatusList}
          />
        </Box>
      </Box>
      <Tooltip title="Next video file" placement="top">
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
      </Tooltip>
      <Tooltip title="Request recorder to split video" placement="top">
        <Button
          variant="contained"
          onClick={triggerFileSplit}
          size="small"
          sx={{
            height: 24,
            m: 0,
            minWidth: 24,
            background: '#19857b',
            marginLeft: '0.5em',
          }}
        >
          <FastForwardIcon fontSize="small" />
        </Button>
      </Tooltip>
    </Stack>
  );
};

export default FileScrubber;
