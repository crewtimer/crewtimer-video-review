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
 */
type TimeRangeIconsProps = {
  times: TimeObject[];
  startTime: string;
  endTime: string;
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
}) => {
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);

  // Filter times to only include those within the start and end times.
  const validTimes = times.filter((timeObj) => {
    const timeSeconds = parseTimeToSeconds(timeObj.Time);
    return timeSeconds >= startSeconds && timeSeconds <= endSeconds;
  });

  return (
    <Box
      sx={{
        width: '100%',
        position: 'relative',
        height: '50px',
        backgroundColor: '#f0f0f0',
      }}
    >
      {validTimes.map((timeObj, index) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const totalDuration = endSeconds - startSeconds;
        const relativePosition =
          ((timeSeconds - startSeconds) / totalDuration) * 100;

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
              color: 'red',
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
