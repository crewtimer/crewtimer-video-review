import { Stack, Button, Box, Slider, Tooltip } from '@mui/material';
import React, { useRef, useEffect, useMemo, useState } from 'react';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import {
  convertTimestampToLocalMicros,
  convertTimestampToString,
} from 'renderer/shared/Util';
import { useWaypoint } from '../util/UseSettings';
import { findClosestNumAndIndex } from '../util/Util';
import ImageButton from './ImageButton';
import FinishPhotoButton from './FinishPhotoButton';
import TimeRangeIcons from './TimeRangeIcons';
import { useClickerData } from './UseClickerData';
import {
  useVideoFrameNum,
  useVideoFile,
  useImage,
  getImage,
  useVideoEvent,
  resetVideoZoom,
  setLastSeekTime,
  setVideoBow,
  setVideoBowUuid,
} from './VideoSettings';
import { TimeObject, TimeSegment } from './VideoTypes';
import {
  fileSegmentBounds,
  findTimeSegment,
  ownedFrames,
  ownedRange,
} from './TimeSegmentUtils';
import { useFileStatusList } from './VideoFileStatus';
import { moveLeft, moveRight } from './VideoUtils';
import { parseTimeToSeconds } from '../util/StringUtils';
import { requestVideoFrame, seekToTimestampAndWait } from './RequestVideoFrame';

/** True for mouse, pointer and touch input; false for keyboard steps. */
const isPointerEvent = (event: Event | React.SyntheticEvent) => {
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
  return (
    nativeEvent instanceof MouseEvent ||
    (typeof TouchEvent !== 'undefined' && nativeEvent instanceof TouchEvent)
  );
};

const VideoScrubber = () => {
  const [videoFrameNum, setVideoFrameNum] = useVideoFrameNum();
  const [videoFile] = useVideoFile();
  const [image] = useImage();
  const [fileStatusList] = useFileStatusList();
  const lapdata = useClickerData() as TimeObject[];
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  const lastVideoFile = useRef('');
  const sliderRef = useRef<HTMLSpanElement>(null);
  const [, setSelectedEvent] = useVideoEvent();
  const ignoreNextChange = useRef(false);
  const sliderValueEvent = useRef(0);
  const timestampSeekRequest = useRef(0);

  const [tooltip, setTooltip] = useState<TimeObject | undefined>();
  const { numFrames } = image;
  const videoFileChanging = lastVideoFile.current !== image.file;
  lastVideoFile.current = image.file;

  // If the video file changes, reset the video position to match the frame received
  useEffect(() => {
    if (videoFileChanging) {
      const newImage = getImage();
      setVideoFrameNum(newImage.frameNum);
      // console.log(
      //   `File:${newImage.file} fps: ${newImage.fps} frames: ${
      //     newImage.numFrames
      //   } sec: ${
      //     (newImage.fileEndTime - newImage.fileStartTime) / 1000
      //   } time: ${newImage.fileStartTime}->${newImage.fileEndTime}`
      // );
    }
  }, [setVideoFrameNum, videoFileChanging]);

  const handleSlider = (event: Event, value: number | number[]) => {
    // Dragging leaves the hint.  A keyboard step moves one frame like the
    // arrow buttons, so it keeps the hint association.
    if (isPointerEvent(event)) {
      setVideoBowUuid('');
    }
    timestampSeekRequest.current += 1;
    sliderValueEvent.current = value as number;
    const newValue = value as number;
    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
      return;
    }

    setVideoFrameNum(newValue);
    requestVideoFrame({ videoFile, frameNum: newValue });
  };

  // The slider covers only the part of the file it owns. Where files overlap,
  // the frames past the split belong to the neighbouring file.
  const { endTime, segments, firstFrame, lastFrame } = useMemo(() => {
    const fileIndex = fileStatusList.findIndex(
      (item) => item.filename === image.file,
    );
    const fileStartMicro = convertTimestampToLocalMicros(
      image.fileStartTime * 1000,
      image.tzOffset,
    );
    const fileEndMicro = convertTimestampToLocalMicros(
      image.fileEndTime * 1000,
      image.tzOffset,
    );
    const ownedTimes =
      fileIndex >= 0
        ? ownedRange(fileSegmentBounds(fileStatusList), fileIndex)
        : undefined;
    const frames =
      fileIndex >= 0 ? ownedFrames(fileStatusList, fileIndex) : undefined;
    const startTsMicro = ownedTimes?.startTsMicro ?? fileStartMicro;
    const endTsMicro = ownedTimes?.endTsMicro ?? fileEndMicro;
    // Owned times are local; shift them back onto the file's UTC times.
    const toUtcMilli = (localMicro: number) =>
      image.fileStartTime + (localMicro - fileStartMicro) / 1000;
    const start = convertTimestampToString(
      toUtcMilli(startTsMicro),
      image.tzOffset,
    );
    const end = convertTimestampToString(
      toUtcMilli(endTsMicro),
      image.tzOffset,
    );
    const segment: TimeSegment = {
      startTsMicro,
      endTsMicro,
      fps: image.fps,
      startTime: start,
      endTime: end,
      pctOffset: 0,
      pct: 1,
      label: image.file.replace(/.*\//, ''),
    };
    return {
      endTime: end,
      segments: [segment],
      firstFrame: frames?.first ?? 1,
      lastFrame: frames?.last ?? numFrames,
    };
  }, [
    fileStatusList,
    image.fileStartTime,
    image.tzOffset,
    image.fileEndTime,
    image.file,
    image.fps,
    numFrames,
  ]);

  const [filteredTimes, filteredScoredTimes, relativePositions] =
    useMemo(() => {
      const startSeconds = segments[0].startTsMicro / 1000000;
      const endSeconds = segments[0].endTsMicro / 1000000;
      const totalDuration = endSeconds - startSeconds;

      // Ownership is decided across all files so a hint between two files
      // shows only on the file with the nearer frame.
      const fileIndex = fileStatusList.findIndex(
        (item) => item.filename === image.file,
      );
      const fileBounds = fileSegmentBounds(fileStatusList);
      const ownsTime = (timeMicro: number) =>
        fileIndex >= 0
          ? findTimeSegment(fileBounds, timeMicro).segmentIndex === fileIndex
          : Boolean(findTimeSegment(segments, timeMicro).segment);

      const relPositions: { pos: number; data: TimeObject }[] = [];
      // Filter times to only include those owned by the video file.
      const inFile = (timeObj: TimeObject) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const valid = ownsTime(timeSeconds * 1000000);
        if (valid) {
          const relativePosition = Math.max(
            0,
            Math.min(1, (timeSeconds - startSeconds) / (totalDuration || 1)),
          );
          relPositions.push({ pos: relativePosition, data: timeObj });
        }
        return valid;
      };
      const filtTimes = lapdata.filter(inFile);
      const filtScoredTimes = scoredLapdata.filter(inFile);
      relPositions.sort((a, b) => a.pos - b.pos);

      // Find the nearest click and jump there if found
      // const candidates = relativePositions.map(({ pos: p }) => p);
      // const pos = getImage().frameNum / getImage().numFrames;
      // const [index] = findClosestNumAndIndex(candidates, pos);
      // const item = relativePositions[index]?.data;
      // if (item) {
      //   setTimeout(() => {
      //     seekToTimestamp(item.Time);
      //     if (item.EventNum !== '?') {
      //       setSelectedEvent(item.EventNum);
      //     }
      //     if (item.Bow && item.Bow !== '*') {
      //       setSelectedBow(item.Bow);
      //     }
      //   }, 100);
      // }

      return [filtTimes, filtScoredTimes, relPositions] as [
        typeof filtTimes,
        typeof filtScoredTimes,
        typeof relPositions,
      ];
    }, [lapdata, segments, scoredLapdata, fileStatusList, image.file]);

  /**
   * Given a mouse click, find the nearest click event.
   * @param event - The mouse click event.
   * @returns The nearest click event or undefined if none are near.
   */
  const findNearestClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
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

  const onMouseDown = (
    _event: React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    ignoreNextChange.current = true;
  };
  const onMouseUp = (_event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    ignoreNextChange.current = false;
  };

  const onSliderClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    const click = findNearestClick(event);
    if (!click) {
      setVideoBowUuid('');
      const requestId = timestampSeekRequest.current + 1;
      timestampSeekRequest.current = requestId;
      const frameNum = Math.round(sliderValueEvent.current);
      resetVideoZoom()
        .then(() => {
          if (requestId !== timestampSeekRequest.current) {
            return undefined;
          }
          setVideoFrameNum(frameNum);
          requestVideoFrame({ videoFile, frameNum });
          setLastSeekTime({ time: '', bow: '' });
          return undefined;
        })
        .catch(showErrorDialog);
      return;
    }
    const requestId = timestampSeekRequest.current + 1;
    timestampSeekRequest.current = requestId;
    resetVideoZoom()
      .then(() =>
        seekToTimestampAndWait({
          time: click.Time,
          bow: click.Bow,
          interpolate: true,
          commitGuard: () => requestId === timestampSeekRequest.current,
        }),
      )
      .catch(showErrorDialog);
    if (click.EventNum !== '?') {
      setSelectedEvent(click.EventNum);
    }
    if (click.Bow && click.Bow !== '*') {
      // Landing on a hint associates it, as auto advance does.
      setVideoBow(click.Bow, click.uuid);
    } else {
      setVideoBowUuid('');
    }
  };

  const onSliderCommitted = (event: Event | React.SyntheticEvent) => {
    // MUI leaves focus on the thumb, which would capture the arrow keys from
    // the video's frame stepping (and hyperzoom) after any scrubber click.
    if (
      isPointerEvent(event) &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }
  };

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
          segments={segments}
          times={filteredScoredTimes}
          endTime={endTime}
          iconColor="#2e7d32"
          iconType="lower"
        />
        <TimeRangeIcons
          segments={segments}
          times={filteredTimes}
          endTime={endTime}
          iconColor="#d2122e"
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
                  : `Bow ${tooltip.Bow}:E${tooltip.EventNum} ${tooltip.Time}`
            }
            placement="top"
            followCursor
          >
            <Slider
              ref={sliderRef}
              value={sliderValue}
              min={firstFrame}
              max={lastFrame}
              onClick={onSliderClick}
              onChange={handleSlider}
              onChangeCommitted={onSliderCommitted}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseMove={onMouseMove}
              onKeyDown={(event) => {
                // MUI handles the slider step itself. Do not also let the
                // window-level video shortcut move a second frame.
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.stopPropagation();
                }
              }}
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
      <FinishPhotoButton />
    </Stack>
  );
};

export default VideoScrubber;
