import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

/**
 * Represents a time segment with start and end times.
 */
type TimeSegment = {
  /** The start time of the segment in HH:MM:SS.sss format. */
  startTime: string;
  /** The end time of the segment in HH:MM:SS.sss format. */
  endTime: string;
  label: string;
};

/**
 * Props for the TimeSegments component.
 */
type TimeSegmentsProps = {
  /** An array of time segments. */
  segments: TimeSegment[];
  /** The index of the active segment. */
  activeIndex: number;
  /** A callback function that is called when a segment is clicked. */
  onChange: (index: number, pct: number, fromClick: boolean) => void;
  /** The start time in HH:MM:SS.sss format for the range. */
  startTime: string;
  /** The end time in HH:MM:SS.sss format for the range. */
  endTime: string;
};

/**
 * Parses a time string in HH:MM:SS.sss format to seconds.
 * @param time - A string representing time in HH:MM:SS.sss format.
 * @returns The time converted to seconds.
 */
const parseTimeToSeconds = (time: string): number => {
  const [hours, minutes, seconds] = time.split(':').map(parseFloat);
  return hours * 3600 + minutes * 60 + seconds;
};

/**
 * A component that visualizes time segments within a given range. Each segment
 * can be clicked to be highlighted as the active segment.
 * @param props - The props for the TimeSegments component.
 * @returns A React component displaying the time segments.
 */
const TimeSegments: React.FC<TimeSegmentsProps> = ({
  segments,
  activeIndex,
  onChange,
  startTime,
  endTime,
}) => {
  /**
   * Handles the click event on a segment, marking it as active.
   * @param index - The index of the clicked segment.
   */
  const handleSegmentClick = (event: React.MouseEvent, index: number) => {
    // Ensure that event.target is an Element to access getBoundingClientRect
    let pct = 0;
    if (event.target instanceof Element) {
      const { clientX } = event;
      const elementLeft = event.target.getBoundingClientRect().left;
      const xRelativeToElement = clientX - elementLeft;
      pct = xRelativeToElement / (event.target.clientWidth - 1);
    }
    onChange(index, pct, true);
  };

  if (segments.length === 0) {
    return <></>;
  }
  const rangeStartSeconds = parseTimeToSeconds(startTime);
  const rangeEndSeconds = parseTimeToSeconds(endTime);
  const totalDuration = rangeEndSeconds - rangeStartSeconds;
  let lastEndSeconds = rangeStartSeconds;
  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        height: '15px',
      }}
    >
      {segments.map((segment, index) => {
        const startSeconds = parseTimeToSeconds(segment.startTime);
        if (
          startSeconds < rangeStartSeconds ||
          startSeconds > rangeEndSeconds
        ) {
          return <div key={`${index}`}></div>;
        }
        const endSeconds = parseTimeToSeconds(segment.endTime);
        const segmentDuration = endSeconds - startSeconds;
        const widthPercent = (segmentDuration / totalDuration) * 100;
        const marginLeftPercent =
          ((startSeconds - lastEndSeconds) / totalDuration) * 100; // Adjust for gaps
        lastEndSeconds = endSeconds;

        return (
          <Tooltip
            key={`${index}`}
            title={`${segment.label} ${segment.startTime} - ${segment.endTime}`}
            enterTouchDelay={0}
          >
            <Box
              onClick={(event) => handleSegmentClick(event, index)}
              sx={{
                width: `${widthPercent}%`,
                marginLeft: `${marginLeftPercent}%`,
                backgroundColor:
                  index === activeIndex ? '#556cd680' : '#19857b40',
                borderRight: '1px solid',
                borderLeft: '1px solid',
                paddingLeft: '-1px',
                paddingRight: '-px',
                minWidth: '2px',
                cursor: 'pointer',
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default TimeSegments;
