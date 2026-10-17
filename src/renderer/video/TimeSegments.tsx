import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { FileStatus, TimeSegment } from './VideoTypes';

/**
 * Props for the TimeSegments component.
 */
type TimeSegmentsProps = {
  /** An array of time segments. */
  segments: TimeSegment[];
  /** The index of the active segment. */
  activeIndex: number;
  /** A callback function that is called when a segment is clicked. */
  onChange: (index: number, pct: number) => void;
  /** The start time in HH:MM:SS.sss format for the range. */
  startTime: string;
  /** The end time in HH:MM:SS.sss format for the range. */
  endTime: string;
  fileStatusList?: FileStatus[];
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
  fileStatusList,
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
    onChange(index, pct);
  };

  const displaySegments =
    segments.length === 0
      ? [
          {
            startTime,
            endTime,
            label: 'No Data Available',
            pctOffset: 0,
            pct: 1,
          },
        ]
      : segments;

  // Segments are absolutely positioned from pctOffset/pct so they line up
  // exactly with the icons drawn by TimeRangeIcons. A flex layout lets borders
  // and minWidth on narrow segments push later segments out of position.
  // The outline (rather than a border) keeps the full width for segments.
  return (
    <Box
      sx={{
        width: '100%',
        position: 'relative',
        height: '20px',
        outline: '1px solid #bbbbbb',
      }}
    >
      {displaySegments.map((segment, index) => {
        const leftPercent = segment.pctOffset * 100;
        const widthPercent = segment.pct * 100;
        const title = `${segment.label} ${segment.startTime} - ${segment.endTime}`;
        const key = `${title}-${index}`;
        const numClicks = fileStatusList?.[index]?.numClicks || 0;
        const style =
          numClicks === 0
            ? {
                backgroundImage: `
          linear-gradient(45deg, #ccc 25%, transparent 25%),
          linear-gradient(-45deg, #ccc 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #ccc 75%),
          linear-gradient(-45deg, transparent 75%, #ccc 75%)
        `,
                backgroundSize: '4px 4px',
              }
            : {};
        return (
          <Tooltip key={key} title={title} enterTouchDelay={0} placement="top">
            <Box
              onClick={(event) => handleSegmentClick(event, index)}
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${leftPercent}%`,
                width: `${widthPercent}%`,
                backgroundColor: index === activeIndex ? '#00ffff' : '#f0f0f0',
                borderRight: '1px solid #888',
                borderLeft: '1px solid #888',
                minWidth: '2px',
                cursor: 'pointer',
                ...style,
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default TimeSegments;
