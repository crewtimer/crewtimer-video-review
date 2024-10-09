import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { TimeSegment } from './VideoTypes';

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

  const displaySegments =
    segments.length === 0
      ? [
          {
            startTime,
            endTime,
            label: 'No Data Available',
            pct: 100,
          },
        ]
      : segments;

  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        height: '20px',
        border: '1px solid #bbbbbb',
      }}
    >
      {displaySegments.map((segment, index) => {
        const widthPercent = segment.pct * 100;

        return (
          <Tooltip
            key={`${index}`}
            title={`${segment.label} ${segment.startTime} - ${segment.endTime}`}
            enterTouchDelay={0}
            placement="top"
          >
            <Box
              onClick={(event) => handleSegmentClick(event, index)}
              sx={{
                width: `${widthPercent}%`,
                backgroundColor: index === activeIndex ? '#00ffff' : '#f0f0f0',
                borderRight: '1px solid #888',
                borderLeft: '1px solid #888',
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
