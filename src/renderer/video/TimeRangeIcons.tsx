import React from 'react';
import Box from '@mui/material/Box';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import { TimeObject, TimeSegment } from './VideoTypes';
import { parseTimeToSeconds } from '../util/StringUtils';

/**
 * Finds the TimeSegment where the given timestamp in microseconds falls between startTsMicro and endTsMicro.
 * Uses binary search for efficiency, assuming the array is sorted by startTsMicro.
 * @param segments - Array of TimeSegment objects sorted by startTsMicro.
 * @param timestampMicro - Timestamp in microseconds.
 * @returns The TimeSegment where the timestamp falls, or undefined if not found.
 */
function findTimeSegment(
  segments: TimeSegment[],
  timestampMicro: number,
): TimeSegment | undefined {
  if (segments.length === 0) {
    return undefined;
  }
  if (
    timestampMicro < segments[0].startTsMicro ||
    timestampMicro > segments[segments.length - 1].endTsMicro
  ) {
    return undefined;
  }
  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid];

    if (timestampMicro < segment.startTsMicro) {
      high = mid - 1;
    } else if (timestampMicro > segment.endTsMicro) {
      low = mid + 1;
    } else {
      return segment; // The timestamp falls within the current segment
    }
  }

  return undefined; // No matching segment found
}

/**
 * Props for the TimeRangeIcons component.
 * @param times - An array of time objects.
 * @param startTime - The start time in HH:MM:SS.sss format for the range.
 * @param endTime - The end time in HH:MM:SS.sss format for the range.
 * @param showBeyondRange - Whether to show icons for times outside the start and end times.
 */
type TimeRangeIconsProps = {
  segments: TimeSegment[];
  times: TimeObject[];
  startTime: string;
  endTime: string;
  showBeyondRange?: boolean;
  iconColor?: string;
  iconType?: 'upper' | 'lower';
};

/**
 * A component that displays icons at positions corresponding to times within a given range.
 * Icons for times outside the start and end times are not displayed.
 * @param props - The props for the TimeRangeIcons component.
 * @returns A React component.
 */
const TimeRangeIcons: React.FC<TimeRangeIconsProps> = ({
  segments,
  times,
  startTime,
  endTime,
  showBeyondRange,
  iconColor,
  iconType = 'lower',
}) => {
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);

  // Filter times to only include those within the start and end times.
  const validTimes = showBeyondRange
    ? times
    : times.filter((timeObj) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        return timeSeconds >= startSeconds && timeSeconds <= endSeconds;
      });

  return (
    <Box
      sx={{
        width: '100%',
        position: 'relative',
        height: '40px',
      }}
    >
      {validTimes.map((timeObj, index) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const timeMicroSeconds = timeSeconds * 1000000;
        let relativePosition = 101;
        const segment = findTimeSegment(segments, timeMicroSeconds);
        if (segment) {
          relativePosition =
            (segment.pctOffset +
              (segment.pct * (timeMicroSeconds - segment.startTsMicro)) /
                (segment.endTsMicro - segment.startTsMicro)) *
            100;
        } else {
          relativePosition = 101;
        }

        let color = iconColor || '#d2122e';
        // if (showBeyondRange) {
        //   color = '#d2122e80';
        // }
        const key = `${timeObj.Time}-${index}`;
        if (relativePosition < 0 || relativePosition > 100) {
          if (!showBeyondRange) {
            return <Box key={key} sx={{ display: 'none' }} />;
          }
          color = 'blue';
          relativePosition = Math.max(0, Math.min(100, relativePosition));
        }

        return (
          <Box
            key={key}
            sx={{
              position: 'absolute',
              left: `${relativePosition}%`,
              top: iconType === 'lower' ? '50%' : '-85%',
              transform: 'translate(-50%, -50%)',
              fontSize: '10px',
              height: '10px',
              color: { color },
              zIndex: 3,
              pointerEvents: 'none',
            }}
            onClick={() => console.log(`click at ${timeObj.Time}`)}
          >
            {iconType === 'lower' ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />}
          </Box>
        );
      })}
    </Box>
  );
};

export default TimeRangeIcons;
