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
import { createFocusScale, focusWindow } from './FocusScale';

/** Time around the selected file shown at full scale, in microseconds. */
const FOCUS_MICRO = 4 * 60 * 1000000;
/** Fraction of the scrubber width given to the focus time. */
const FOCUS_FRACTION = 0.6;

interface SxPropsArgs {
  sx?: SxProps<Theme>;
}

const FileScrubber: React.FC<SxPropsArgs> = ({ sx }) => {
  const [selectedIndex] = useSelectedIndex();
  const [fileStatusList] = useFileStatusList();
  const lapdata = useClickerData() as TimeObject[];
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];

  // Calc the time segment list. Files are laid end to end (gaps removed) and
  // drawn on a focus scale: FOCUS_MICRO around the selected file gets
  // FOCUS_FRACTION of the width and other files are compressed around it.
  const { segmentList, segmentStarts, scale } = useMemo(() => {
    const starts: number[] = [];
    let totalTime = 0;
    fileStatusList.forEach((item) => {
      starts.push(totalTime);
      totalTime += item.duration;
    });
    const selected = fileStatusList[selectedIndex];
    const selectedStart = starts[selectedIndex] ?? 0;
    const selectedDuration = selected?.duration ?? 0;
    const window = focusWindow(
      totalTime,
      selectedStart + selectedDuration / 2,
      Math.max(FOCUS_MICRO, selectedDuration),
    );
    const focusScale = createFocusScale(
      totalTime,
      window.start,
      window.end,
      FOCUS_FRACTION,
    );
    const segments = fileStatusList.map((item, index) => {
      const startTime = convertTimestampToString(
        item.startTime / 1000,
        item.tzOffset,
      );
      const endTime = convertTimestampToString(
        item.endTime / 1000,
        item.tzOffset,
      );

      const pctOffset = focusScale.toPct(starts[index]);
      const pct = focusScale.toPct(starts[index] + item.duration) - pctOffset;
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
      return segment;
    });
    return { segmentList: segments, segmentStarts: starts, scale: focusScale };
  }, [fileStatusList, selectedIndex]);

  /** Position (0..1) of a local timestamp within a file on the focus scale. */
  const positionOf = (segmentIndex: number, tsMicro: number) => {
    const segment = segmentList[segmentIndex];
    const duration = fileStatusList[segmentIndex]?.duration ?? 0;
    const span = segment.endTsMicro - segment.startTsMicro || 1;
    const fileFraction = (tsMicro - segment.startTsMicro) / span;
    return scale.toPct(segmentStarts[segmentIndex] + fileFraction * duration);
  };

  /** Converts a click position within a segment to a position within its file. */
  const onSegmentClick = (index: number, clickPct: number) => {
    const segment = segmentList[index];
    const duration = fileStatusList[index]?.duration || 1;
    const time = scale.fromPct(segment.pctOffset + clickPct * segment.pct);
    const filePct = Math.min(
      1,
      Math.max(0, (time - segmentStarts[index]) / duration),
    );
    moveToFileIndex(index, filePct);
  };

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
          positionOf={positionOf}
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
          positionOf={positionOf}
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
            onChange={onSegmentClick}
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
