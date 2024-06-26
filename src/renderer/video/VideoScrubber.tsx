import { Stack, Button, Box, Slider, Tooltip } from '@mui/material';
import { useRef, useEffect, useMemo, useState } from 'react';
import { convertTimestampToString } from 'renderer/shared/Util';
import { useWaypoint } from 'renderer/util/UseSettings';
import { findClosestNumAndIndex, timeToMilli } from 'renderer/util/Util';
import ImageButton from './ImageButton';
import TimeRangeIcons, { TimeObject } from './TimeRangeIcons';
import { useClickerData } from './UseClickerData';
import { requestVideoFrame } from './VideoFileUtils';
import {
  useVideoFrameNum,
  useVideoFile,
  useImage,
  useTimezoneOffset,
  getImage,
  useVideoEvent,
  useVideoBow,
} from './VideoSettings';
import { moveLeft, moveRight, parseTimeToSeconds } from './VideoUtils';

const VideoScrubber = () => {
  const [videoFrameNum, setVideoFrameNum] = useVideoFrameNum();
  const [videoFile] = useVideoFile();
  const [image] = useImage();
  const lapdata = useClickerData() as TimeObject[];
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  const lastVideoFile = useRef('');
  const [timezoneOffset] = useTimezoneOffset();
  const sliderRef = useRef<HTMLSpanElement>(null);
  const [, setSelectedEvent] = useVideoEvent();
  const [, setSelectedBow] = useVideoBow();

  const [tooltip, setTooltip] = useState<TimeObject | undefined>();
  const numFrames = image.numFrames;
  const videoFileChanging = lastVideoFile.current !== image.file;
  lastVideoFile.current = image.file;

  // If the video file changes, reset the video position to match the frame received
  useEffect(() => {
    if (videoFileChanging) {
      const newImage = getImage();
      setVideoFrameNum(newImage.frameNum);
    }
  }, [videoFileChanging]);

  const handleSlider = (_event: Event, value: number | number[]) => {
    let newValue = value as number;
    setVideoFrameNum(newValue);
    requestVideoFrame({ videoFile, frameNum: newValue });
  };

  const { startTime, endTime } = useMemo(() => {
    const startTime = convertTimestampToString(
      image.fileStartTime,
      timezoneOffset
    );
    const endTime = convertTimestampToString(image.fileEndTime, timezoneOffset);
    return { startTime, endTime };
  }, [image.fileStartTime, image.fileEndTime, timezoneOffset]);

  const [filteredTimes, filteredScoredTimes, relativePositions] =
    useMemo(() => {
      const startSeconds = parseTimeToSeconds(startTime);
      const endSeconds = parseTimeToSeconds(endTime);
      const totalDuration = endSeconds - startSeconds;

      const relativePositions: { pos: number; data: TimeObject }[] = [];
      // Filter times to only include those within the start and end times.
      const filteredTimes = lapdata.filter((timeObj) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const valid = timeSeconds >= startSeconds && timeSeconds <= endSeconds;
        if (valid) {
          const relativePosition = (timeSeconds - startSeconds) / totalDuration;
          relativePositions.push({ pos: relativePosition, data: timeObj });
        }
        return valid;
      });
      const filteredScoredTimes = scoredLapdata.filter((timeObj) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const valid = timeSeconds >= startSeconds && timeSeconds <= endSeconds;
        if (valid) {
          const relativePosition = (timeSeconds - startSeconds) / totalDuration;
          relativePositions.push({ pos: relativePosition, data: timeObj });
        }
        return valid;
      });
      relativePositions.sort((a, b) => a.pos - b.pos);
      return [filteredTimes, filteredScoredTimes, relativePositions] as [
        typeof filteredTimes,
        typeof filteredScoredTimes,
        typeof relativePositions
      ];
    }, [lapdata, startTime, endTime, scoredLapdata]);

  /**
   * Given a mouse click, find the nearest click event.
   * @param event - The mouse click event.
   * @returns The nearest click event or undefined if none are near.
   */
  const findNearestClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    let x = event.clientX - (rect?.left ?? 0);
    const pos = x / (rect?.width ?? 1);
    const candidates = relativePositions.map(({ pos: p }) => p);
    const [index, value] = findClosestNumAndIndex(candidates, pos);
    const dist = Math.abs(value - pos) * (rect?.width ?? 1);
    if (index >= 0 && dist < 10) {
      const item = relativePositions[index].data;
      return item;
    }
    return undefined;
  };

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const click = findNearestClick(event);
    if (click) {
      setTooltip(click);
    } else {
      setTooltip(undefined);
    }
  };

  const onSliderClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    const click = findNearestClick(event);
    if (!click) {
      return;
    }
    const secs = timeToMilli(click.Time);
    const delta = image.fileEndTime - image.fileStartTime;
    const frame =
      1 + ((secs - timeToMilli(startTime)) / delta) * (image.numFrames - 1);
    setVideoFrameNum(frame);
    requestVideoFrame({ videoFile, frameNum: frame });
    if (click.EventNum !== '?') {
      setSelectedEvent(click.EventNum);
    }
    if (click.Bow && click.Bow !== '*') {
      setSelectedBow(click.Bow);
    }
  };

  console.log(`videoFrameNum: ${videoFrameNum}/${numFrames}`);
  const sliderValue = videoFrameNum;
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
    >
      <Button
        variant="contained"
        onClick={moveLeft}
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
          marginLeft: '1em',
          marginRight: '1em',
        }}
      >
        <TimeRangeIcons
          times={filteredTimes}
          startTime={startTime}
          endTime={endTime}
          iconType="lower"
        />
        <TimeRangeIcons
          times={filteredScoredTimes}
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
            backgroundColor: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          <Tooltip
            title={
              tooltip === undefined
                ? ''
                : tooltip.Bow === '?'
                ? `? ${tooltip.Time}`
                : `E${tooltip.EventNum}-${tooltip.Bow}: ${tooltip.Time}`
            }
            placement="top"
            followCursor
          >
            <Slider
              ref={sliderRef}
              value={sliderValue}
              min={1}
              max={numFrames}
              onClick={onSliderClick}
              onChange={handleSlider}
              onMouseMove={onMouseMove}
              aria-labelledby="video-scrubber"
              sx={{
                // marginLeft: '1em',
                // marginRight: '1em',
                flex: 1,
                '& .MuiSlider-thumb': {
                  transition: 'none',
                  width: 16, // Set the width of the thumb
                  height: 16, // Set the height of the thumb
                },
                '& .MuiSlider-track': {
                  transition: 'none',
                },
                '& .MuiSlider-rail': {
                  transition: 'none',
                },
              }}
              track={false}
            />
          </Tooltip>
        </Box>
      </Box>
      <Button
        variant="contained"
        onClick={moveRight}
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
      <ImageButton />
    </Stack>
  );
};

export default VideoScrubber;
