import React from 'react';
import Box from '@mui/material/Box';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import Blinking from 'renderer/Blinking';
import { FileStatus, TimeObject, TimeSegment } from './VideoTypes';
import { parseTimeToSeconds } from '../util/StringUtils';

import { findTimeSegment } from './TimeSegmentUtils';

/**
 * Props for the TimeRangeIcons component.
 * @param times - An array of time objects.
 * @param endTime - The end time in HH:MM:SS.sss format for the range.
 * @param showBeyondRange - Whether to show icons for times outside the start and end times.
 */
type TimeRangeIconsProps = {
  segments: TimeSegment[];
  times: TimeObject[];
  endTime: string;
  showBeyondRange?: boolean;
  iconColor?: string;
  iconType?: 'upper' | 'lower';
  fileStatusList?: FileStatus[];
  resetClickTally?: boolean;
  /**
   * Optional position (0..1) of a timestamp within a segment. Defaults to a
   * linear position based on the segment's pctOffset and pct.
   */
  positionOf?: (segmentIndex: number, tsMicro: number) => number;
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
  endTime,
  showBeyondRange,
  iconColor,
  iconType = 'lower',
  fileStatusList,
  resetClickTally,
  positionOf,
}) => {
  const endSeconds = parseTimeToSeconds(endTime);

  // Filter times to only include those within the start and end times.
  let timeAfterEnd = false;
  const validTimes = times.filter((timeObj) => {
    if (!timeObj.Time) {
      return false;
    }
    const timeSeconds = parseTimeToSeconds(timeObj.Time);
    const { segment } = findTimeSegment(segments, timeSeconds * 1000000);
    timeAfterEnd ||= !segment && timeSeconds > endSeconds;
    return Boolean(segment);
  });
  timeAfterEnd = timeAfterEnd && showBeyondRange;
  if (resetClickTally) {
    fileStatusList?.forEach((fileStatus) => {
      fileStatus.numClicks = 0;
    });
  }

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
        const { segment, segmentIndex } = findTimeSegment(
          segments,
          timeMicroSeconds,
        );
        if (segment) {
          // Hints within half a frame outside the file sit on its edge.
          const markerTime = Math.min(
            Math.max(timeMicroSeconds, segment.startTsMicro),
            segment.endTsMicro,
          );
          relativePosition = positionOf
            ? positionOf(segmentIndex, markerTime) * 100
            : (segment.pctOffset +
                (segment.pct * (markerTime - segment.startTsMicro)) /
                  (segment.endTsMicro - segment.startTsMicro || 1)) *
              100;
          const fileStatus = fileStatusList?.[segmentIndex];
          if (fileStatus) {
            fileStatus.numClicks = (fileStatus.numClicks || 0) + 1;
          }
        } else {
          relativePosition = 101;
        }

        const color = iconColor || '#d2122e';
        const key = `${timeObj.Time}-${index}`;
        if (relativePosition < 0 || relativePosition > 100) {
          return <Box key={key} sx={{ display: 'none' }} />;
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
      {timeAfterEnd && (
        <Blinking>
          <Box
            sx={{
              position: 'absolute',
              left: `${100}%`,
              top: '-50%',
              marginLeft: '-12px',
              transform: 'translate(-50%, -50%) rotate(-90deg)',
              fontSize: '10px',
              height: '10px',
              color: iconColor,
              zIndex: 3,
              pointerEvents: 'none',
            }}
            onClick={() => console.log(`out of bounds timestamp`)}
          >
            <ArrowDropDownIcon />
          </Box>
        </Blinking>
      )}
    </Box>
  );
};

export default TimeRangeIcons;
