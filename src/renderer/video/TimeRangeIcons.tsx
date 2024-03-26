import React from 'react';
import Box from '@mui/material/Box';
import SouthIcon from '@mui/icons-material/South';
import { parseTimeToSeconds } from './VideoUtils';

/**
 * Represents a time object with a time property in HH:MM:SS.sss format.
 */
export type TimeObject = {
  Time: string;
};

/**
 * Props for the TimeRangeIcons component.
 * @param times - An array of time objects.
 * @param startTime - The start time in HH:MM:SS.sss format for the range.
 * @param endTime - The end time in HH:MM:SS.sss format for the range.
 * @param showBeyondRange - Whether to show icons for times outside the start and end times.
 */
type TimeRangeIconsProps = {
  times: TimeObject[];
  startTime: string;
  endTime: string;
  showBeyondRange?: boolean;
};

/**
 * A component that displays icons at positions corresponding to times within a given range.
 * Icons for times outside the start and end times are not displayed.
 * @param props - The props for the TimeRangeIcons component.
 * @returns A React component.
 */
const TimeRangeIcons: React.FC<TimeRangeIconsProps> = ({
  times,
  startTime,
  endTime,
  showBeyondRange,
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
        const totalDuration = endSeconds - startSeconds;
        let relativePosition =
          ((timeSeconds - startSeconds) / totalDuration) * 100;

        let color = '#d2122e';
        if (showBeyondRange) {
          color = '#d2122e80';
        }

        if (relativePosition < 0 || relativePosition > 100) {
          if (!showBeyondRange) {
            return <></>;
          }
          color = 'blue';
          relativePosition = Math.max(0, Math.min(100, relativePosition));
        }

        return (
          <Box
            key={index}
            sx={{
              position: 'absolute',
              left: `${relativePosition}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: '10px',
              height: '10px',
              color: { color },
            }}
            onClick={() => console.log(`click at ${timeObj.Time}`)}
          >
            <SouthIcon />
          </Box>
        );
      })}
    </Box>
  );
};

export default TimeRangeIcons;
