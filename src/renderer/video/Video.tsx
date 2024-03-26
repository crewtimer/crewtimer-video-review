import { Box, Slider, Typography, Stack, Button } from '@mui/material';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { convertTimestampToString } from '../shared/Util';
import { useDebouncedCallback } from 'use-debounce';
import makeStyles from '@mui/styles/makeStyles';
import VideoSideBar from './VideoSideBar';
import {
  Dir,
  getImage,
  getVideoFrameNum,
  getVideoSettings,
  setVideoBow,
  setVideoFrameNum,
  setVideoTimestamp,
  setZoomWindow,
  useImage,
  useTimezoneOffset,
  useVideoFile,
  useVideoFrameNum,
  useVideoSettings,
} from './VideoSettings';
import VideoOverlay, { useAdjustingOverlay, useNearEdge } from './VideoOverlay';
import { Rect } from 'renderer/shared/AppTypes';
import TimingSidebar from './TimingSidebar';
import { findClosestLineAndPosition } from './VideoUtils';
import { useEnableVideoTiming } from 'renderer/util/UseSettings';
import FileScrubber, { nextFile, prevFile } from './FileScrubber';
import Measure from 'react-measure';
import { UseDatum } from 'react-usedatum';
import { requestVideoFrame } from './VideoFileUtils';
import TimeRangeIcons, { TimeObject } from './TimeRangeIcons';
import { useClickerData } from './UseClickerData';

const useStyles = makeStyles({
  text: {
    zIndex: 200,
    background: '#ffffffa0',
    color: 'black',
    border: '1px solid black',
    height: 'fit-content',
    padding: '0.2em',
  },
  tstext: {
    zIndex: 1,
    background: '#ffffffa0',
    color: 'black',
    border: '1px solid black',
    height: 'fit-content',
    padding: '0.2em',
  },
  computedtext: {
    zIndex: 200,
    background: '#ffffffa0',
    color: 'black',
    border: '1px solid red',
    height: 'fit-content',
    padding: '0.2em',
  },
});

interface CalPoint {
  ts: number;
  px: number;
  scale: number;
}

interface ZoomState {
  mouseMove: number;
  mouseDownClientY: number;
  mouseDownPositionY: number;
  mouseDownPositionX: number;
  mouseDown: boolean | undefined;
  initialPinchDistance: number;
  isPinching: boolean;
  isZooming: boolean;
  initialPinchRange: { min: number; max: number };
  zoomWindow: Rect; // Current applied zoom window
  zoomStartWindow: Rect; // The zoom window when zooming started
  imageScale: number;
  imageLoaded: boolean;
  scale: number;
  calPointLeft: CalPoint;
  calPointRight: CalPoint;
}

const moveToFrame = (frameNum: number) => {
  const image = getImage();
  if (frameNum < 1) {
    prevFile();
  } else if (frameNum > getImage().numFrames) {
    nextFile();
  } else {
    setVideoFrameNum(frameNum);
    requestVideoFrame({ videoFile: image.file, frameNum });
  }
};

const moveRight = () => {
  const prev = getVideoFrameNum();
  const frameNum = prev + 1;
  moveToFrame(frameNum);
};
const moveLeft = () => {
  const prev = getVideoFrameNum();
  const frameNum = prev - 1;
  moveToFrame(frameNum);
};

const handleKeyDown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowRight':
    case '>':
    case '.':
      moveRight();
      break;
    case 'ArrowLeft':
    case '<':
    case ',':
      moveLeft();
      break;
    default:
      break; // ignore
  }
};

const VideoScrubber = () => {
  const [videoFrameNum, setVideoFrameNum] = useVideoFrameNum();
  const [videoFile] = useVideoFile();
  const [image] = useImage();
  const lapdata = useClickerData() as TimeObject[];
  const lastVideoFile = useRef('');
  const [timezoneOffset] = useTimezoneOffset();
  const numFrames = image.numFrames;
  const videoFileChanging = lastVideoFile.current !== image.file;
  lastVideoFile.current = image.file;

  // console.log(
  //   `numFrames: ${numFrames} videoPosition: ${videoPosition.frameNum}`
  // );

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
          times={lapdata}
          startTime={startTime}
          endTime={endTime}
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
          <Slider
            value={sliderValue}
            min={1}
            max={numFrames}
            onChange={handleSlider}
            aria-labelledby="video-scrubber"
            sx={{
              // marginLeft: '1em',
              // marginRight: '1em',
              flex: 1,
              '& .MuiSlider-thumb': {
                transition: 'none',
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
        }}
      >
        &gt;
      </Button>
    </Stack>
  );
};
const VideoImage: React.FC<{ width: number; height: number }> = ({
  width,
  height,
}) => {
  const [image] = useImage();
  const classes = useStyles();
  const [, forceRender] = useReducer((s) => s + 1, 0);
  const [computedTime, setComputedTime] = useState(0);
  const [adjustingOverlay] = useAdjustingOverlay();
  const [, setNearEdge] = useNearEdge();
  const [timezoneOffset] = useTimezoneOffset();
  const [videoFile] = useVideoFile();
  const holdoffChanges = useRef<boolean>(false);
  const mouseTracking = useRef<ZoomState>({
    zoomWindow: { x: 0, y: 0, width: 0, height: 0 },
    zoomStartWindow: { x: 0, y: 0, width: 0, height: 0 },
    imageScale: 1,
    scale: 1,
    imageLoaded: false,
    mouseDownClientY: 0,
    mouseDownPositionY: 0,
    mouseDownPositionX: 0,
    mouseMove: 0,
    mouseDown: undefined,
    isPinching: false,
    isZooming: false,
    initialPinchDistance: 0,
    initialPinchRange: { min: 0, max: 100 },
    calPointLeft: { ts: 0, px: 0, scale: 1 },
    calPointRight: { ts: 0, px: 0, scale: 1 },
  });

  holdoffChanges.current = image.file !== videoFile; // || activeVideoFile.current !== videoFile;

  const infoRowHeight = 0; // 40;
  height = height - infoRowHeight;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvas = useRef(document.createElement('canvas'));

  const setScale = useCallback((scale: number) => {
    mouseTracking.current.scale = scale;
    drawContent();
  }, []);

  const initScaling = useCallback(() => {
    setScale(1);
    mouseTracking.current.mouseDown = false;
    mouseTracking.current.isPinching = false;
    mouseTracking.current.isZooming = false;
    mouseTracking.current.calPointLeft.ts = 0;
    mouseTracking.current.calPointRight.ts = 0;

    mouseTracking.current.zoomWindow = {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    };
    mouseTracking.current.zoomStartWindow = mouseTracking.current.zoomWindow;
    setZoomWindow(mouseTracking.current.zoomWindow);
  }, [image.width, image.height]);

  useEffect(() => {
    initScaling();
  }, [image.width, image.height]);

  useEffect(() => {
    offscreenCanvas.current.width = image.width;
    offscreenCanvas.current.height = image.height;
    const ctx = offscreenCanvas.current?.getContext('2d');
    if (ctx && image.width) {
      ctx.putImageData(
        new ImageData(
          new Uint8ClampedArray(image.data),
          image.width,
          image.height
        ),
        0,
        0
      );
      mouseTracking.current.imageLoaded = true;
      drawContent();
    } else {
      mouseTracking.current.imageLoaded = false;
    }
  }, [image]);

  const { zoomWindow, isZooming } = mouseTracking.current;
  let imgScale = 1.0;
  let destWidth = width;
  let destHeight = height;
  if (isZooming) {
    const scaleX = width / zoomWindow.width;
    const scaleY = height / zoomWindow.height;
    imgScale = Math.min(scaleX, scaleY);
    destHeight = imgScale * zoomWindow.height;
    destWidth = imgScale * zoomWindow.width;
  } else if (image.width > 0 && image.height > 0) {
    const scaleX = width / image.width;
    const scaleY = height / image.height;
    imgScale = Math.min(scaleX, scaleY);
    destHeight = imgScale * image.height;
    destWidth = imgScale * image.width;
  }

  mouseTracking.current.imageScale = imgScale;

  const xPadding = (width - destWidth) / 2;

  const drawContent = useDebouncedCallback(() => {
    if (mouseTracking.current.imageLoaded && canvasRef?.current) {
      const canvas = canvasRef.current;
      if (canvas.width <= 1) {
        return;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);

        const { zoomWindow } = mouseTracking.current;
        if (image.width) {
          ctx.drawImage(
            // imageFrame.current,
            offscreenCanvas.current,
            zoomWindow.x,
            zoomWindow.y,
            zoomWindow.width,
            zoomWindow.height,
            (canvas.width - destWidth) / 2, // center the image
            0,
            destWidth,
            destHeight
          );

          ctx.beginPath();

          // Draw a border as a Rectangle
          ctx.strokeStyle = 'black'; // You can choose any color
          ctx.lineWidth = 1; // Width of the border
          ctx.strokeRect(
            (canvas.width - destWidth) / 2,
            0,
            destWidth - 1,
            destHeight - 1
          );

          // Draw measurement markers
          if (mouseTracking.current.calPointLeft.ts !== 0) {
            const x =
              canvas.width / 2 +
              (mouseTracking.current.calPointLeft.px *
                mouseTracking.current.scale) /
                mouseTracking.current.calPointLeft.scale;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, destHeight);
            ctx.strokeStyle = 'blue';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (mouseTracking.current.calPointRight.ts !== 0) {
            const x =
              canvas.width / 2 +
              (mouseTracking.current.calPointRight.px *
                mouseTracking.current.scale) /
                mouseTracking.current.calPointRight.scale;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, destHeight);
            ctx.strokeStyle = 'blue';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
    }
  }, 10);

  useEffect(() => {
    drawContent();
  }, [width, height]);

  useEffect(() => {
    // initialize zoom tracking if not already initialized
    if (mouseTracking.current.zoomWindow.width !== 0) {
      return;
    }
    mouseTracking.current.zoomWindow = {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    };
    mouseTracking.current.zoomStartWindow = mouseTracking.current.zoomWindow;

    setZoomWindow(mouseTracking.current.zoomWindow);
  }, [image]);

  const selectLane = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const yScale = mouseTracking.current.zoomWindow.width / destWidth;
    const x =
      mouseTracking.current.zoomWindow.x +
      (event.clientX - event.currentTarget.getBoundingClientRect().left) *
        yScale;
    const y =
      mouseTracking.current.zoomWindow.y +
      (event.clientY - event.currentTarget.getBoundingClientRect().top) *
        yScale;
    const laneLines = getVideoSettings()
      .guides.filter((lane) => lane.dir === Dir.Horiz && lane.enabled)
      .map((lane) => ({
        pt1: { x: 0, y: lane.pt1 },
        pt2: { x: image.width, y: lane.pt2 },
        lane,
      }));
    const result = findClosestLineAndPosition(
      { x: x - xPadding, y: y },
      laneLines,
      getVideoSettings().laneBelowGuide ? 'below' : 'above'
    );
    if (result.closestLine >= 0) {
      const lane = laneLines[result.closestLine].lane.label.split(' ')[1];
      setVideoBow(lane);
    }
  };

  const storeComputedTime = (t: number) => {
    const ts = convertTimestampToString(t, timezoneOffset);
    setVideoTimestamp(ts);
  };
  const handleSingleClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    const mousePositionY =
      event.clientY - event.currentTarget.getBoundingClientRect().top;
    const mousePositionX =
      event.clientX - event.currentTarget.getBoundingClientRect().width / 2;

    // If we are near the edge, allow the VideoOverlay to interpret what is happening
    if (
      mousePositionY < 30 ||
      mousePositionY > destHeight - 20 ||
      mousePositionX < -destWidth / 2 + 20 ||
      mousePositionX > destWidth / 2 - 20
    ) {
      return;
    }

    // Single click requires a shift key
    if (!event.shiftKey) {
      return;
    }

    event.preventDefault();

    const { calPointLeft, calPointRight } = mouseTracking.current;
    const calPoint = mousePositionX < 0 ? calPointLeft : calPointRight;

    calPoint.ts = image.timestamp;
    calPoint.px = mousePositionX;
    calPoint.scale = mouseTracking.current.scale;
    if (calPointLeft.ts && calPointRight.ts) {
      const deltaT = calPointRight.ts - calPointLeft.ts;
      const deltaPx =
        calPointRight.px * calPointRight.scale -
        calPointLeft.px * calPointLeft.scale;
      const t = Math.round(
        calPointLeft.ts +
          ((-calPointLeft.px * calPointLeft.scale) / deltaPx) * deltaT
      );
      setComputedTime(t);
      storeComputedTime(t);
    }

    drawContent();
    forceRender();
  };

  const handleDragStart = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    event.preventDefault();
  };

  const handleDoubleClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    const mousePositionY =
      event.clientY - event.currentTarget.getBoundingClientRect().top;
    if (mousePositionY < 30) {
      event.preventDefault();
      return;
    }
    initScaling();
  };

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      selectLane(event);
      mouseTracking.current.mouseDownClientY = event.clientY;
      const mousePositionY = Math.min(
        destHeight,
        Math.max(
          0,
          event.clientY - event.currentTarget.getBoundingClientRect().top
        )
      );

      mouseTracking.current.mouseDown = true;
      mouseTracking.current.zoomStartWindow = mouseTracking.current.zoomWindow;

      // Reference back to the original frame x and y
      const yScale = mouseTracking.current.zoomWindow.width / destWidth;
      mouseTracking.current.mouseDownPositionY =
        mouseTracking.current.zoomWindow.y + mousePositionY * yScale;

      // compute the x pos of the finish line in the frame before scalechanges
      let { pt1, pt2 } = getVideoSettings().guides[0];
      pt1 += image.width / 2;
      pt2 += image.width / 2;

      mouseTracking.current.mouseDownPositionX =
        pt1 +
        (pt2 - pt1) * (mouseTracking.current.mouseDownPositionY / image.height);
    },
    [image, xPadding, destWidth]
  );

  const doZoom = useCallback(
    /**
     * Zoom the image based on the initial mouse down position.  The
     * approximate finish line position is maintained on the x axis while the
     * y axis is zoomed around the y click point.
     *
     * @param zoomFactor New zoom factor
     */
    (zoomFactor: number) => {
      if (zoomFactor < 1.01) {
        initScaling();
        return;
      }
      // Compute new sizes.  X and Y are scaled equally to maintain aspect ratio
      const newWidth = image.width / zoomFactor;
      const newHeight = image.height / zoomFactor;

      // mouseDownPositionY represents the y position in the image coordinates where centering should occur
      let newY = mouseTracking.current.mouseDownPositionY - newHeight / 2; // force to middle
      newY = Math.max(0, newY); // make sure we don't go off the top
      newY = Math.min(newY, image.height - newHeight); // make sure we don't go off the bottom

      const priorXScale = mouseTracking.current.zoomWindow.width / destWidth;
      const newXScale = Math.min(image.width, newWidth) / destWidth;

      const screenPixelsToFinishLine =
        (mouseTracking.current.mouseDownPositionX -
          mouseTracking.current.zoomWindow.x) /
        priorXScale;

      const newX =
        mouseTracking.current.mouseDownPositionX -
        screenPixelsToFinishLine * newXScale;

      // Apply the new zoom window and scale
      mouseTracking.current.zoomWindow = {
        x: newX,
        y: newY,
        width: Math.min(image.width, newWidth),
        height: Math.min(image.height, newHeight),
      };

      setZoomWindow(mouseTracking.current.zoomWindow);
      // console.log(JSON.stringify(mouseTracking.current, null, 2));
      setScale(zoomFactor);
    },
    [image, destHeight, destWidth]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      let x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      const nearEdge =
        y <= destHeight &&
        x <= destWidth + xPadding &&
        x > xPadding &&
        (y < 20 ||
          y > destHeight - 20 ||
          x < 20 + xPadding ||
          x > destWidth - 20 + xPadding);
      setNearEdge(nearEdge && !mouseTracking.current.isZooming);
      // console.log(`near edge: ${nearEdge} x: ${x} y: ${y}`);
      // dont trigger mouse down move actions until we have moved slightly. This avoids
      // accidental zooming on just a click
      const downMoveY = Math.abs(
        mouseTracking.current.mouseDownClientY - event.clientY
      );
      if (mouseTracking.current.mouseDown && downMoveY > 10) {
        mouseTracking.current.isZooming = true;
        const deltaY = event.movementY;
        const newScale = Math.max(
          1,
          mouseTracking.current.scale + deltaY * 0.01
        );
        // Adjust the scale based on the mouse movement
        doZoom(newScale);
      }
    },
    [image, destHeight, destWidth]
  );

  const handleMouseUp = useCallback(() => {
    mouseTracking.current.mouseDown = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    // Cleanup the mouseup listener on unmount
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseUp]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (holdoffChanges.current) {
        return;
      }
      if (event.deltaY < 0) {
        moveRight();
      } else if (event.deltaY > 0) {
        moveLeft();
      }
    },
    [moveLeft, moveRight]
  );

  useEffect(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.addEventListener('keydown', handleKeyDown);
    // Cleanup the keydown listener on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const videoTimestamp = convertTimestampToString(
    image.timestamp,
    timezoneOffset
  );

  useEffect(() => {
    setVideoTimestamp(videoTimestamp);
  }, [image]);

  return (
    <Stack direction="column">
      {/* <Box
        sx={{
          height: infoRowHeight,
          width: '100%',
          display: 'flex',
          padding: '2px',
        }}
      >
        <div style={{ flex: 1 }} />
        <Stack direction="row">
          <Typography onClick={moveLeft} className={classes.text}>
            &nbsp;&lt;&nbsp;
          </Typography>
          <Typography className={classes.text}>
            {convertTimestampToString(image.timestamp, timezoneOffset)}
          </Typography>
          <Typography onClick={moveRight} className={classes.text}>
            &nbsp;&gt;&nbsp;
          </Typography>
        </Stack>
        <div style={{ flex: 1 }} />
      </Box> */}
      <Box
        onWheel={adjustingOverlay ? undefined : handleWheel}
        onMouseDown={adjustingOverlay ? undefined : handleMouseDown}
        onMouseMove={adjustingOverlay ? undefined : handleMouseMove}
        onMouseUp={adjustingOverlay ? undefined : handleMouseUp}
        onMouseLeave={adjustingOverlay ? undefined : () => setNearEdge(false)}
        onDragStart={adjustingOverlay ? undefined : handleDragStart}
        onDoubleClick={handleDoubleClick}
        onClick={adjustingOverlay ? undefined : handleSingleClick}
        sx={{
          // margin: '16px', // Use state variable for padding
          width: `100%`, // Fill the width of the content area
          height: `100%`, // Fill the height of the content area
          maxHeight: `100%`,
          display: 'flex', // Use flexbox for centering
          // justifyContent: 'center', // Center horizontally
          alignItems: 'top', //  vertically
          overflow: 'hidden', // In case the image is too big
        }}
      >
        <Stack
          direction="column"
          sx={{
            width: `${width}px`,
            alignItems: 'center',
            paddingTop: '10px',
          }}
        >
          <Stack direction="row">
            <div />
            <Typography
              onClick={holdoffChanges.current ? undefined : moveLeft}
              className={classes.text}
            >
              &nbsp;&lt;&nbsp;
            </Typography>
            <Typography className={classes.tstext}>{videoTimestamp}</Typography>
            <Typography
              onClick={holdoffChanges.current ? undefined : moveRight}
              className={classes.text}
            >
              &nbsp;&gt;&nbsp;
            </Typography>
            <div style={{ flex: 1 }} />
          </Stack>
          {computedTime
            ? mouseTracking.current.calPointLeft.ts &&
              mouseTracking.current.calPointRight.ts && (
                <Typography
                  className={classes.computedtext}
                  align="center"
                  onClick={() => storeComputedTime(computedTime)}
                >
                  {convertTimestampToString(computedTime, timezoneOffset)}
                </Typography>
              )
            : null}
        </Stack>
        <canvas
          ref={canvasRef}
          width={`${width}px`}
          height={`${height}px`}
          style={{
            position: 'absolute', // keeps the size from influencing the parent size
          }}
        />
        <VideoOverlay
          width={width}
          height={height}
          destHeight={destHeight}
          destWidth={destWidth}
        />
      </Box>
    </Stack>
  );
};

const [useWindowSize] = UseDatum({ winWidth: 0, winHeight: 0 });

const Video = () => {
  const [{ top }, setDimensions] = useState({ top: 170, width: 1, height: 1 });
  const [videoSettings] = useVideoSettings();
  const [enableVideoTiming] = useEnableVideoTiming();
  const videoSidebarWidth = videoSettings.videoPanel ? 150 : 0;
  const timingSidebarwidth = enableVideoTiming ? 300 : 0;
  const sidebarWidth = Math.max(60, videoSidebarWidth + timingSidebarwidth);
  const [{ winWidth, winHeight }, setWindowSize] = useWindowSize();

  const onResize = () => {
    setWindowSize({
      winWidth: window.innerWidth,
      winHeight: window.innerHeight,
    });
    // clearTimeout(updateTimer.current);
    // updateTimer.current = setTimeout(
    //   () => setTableWidth(window.innerWidth),
    //   16
    // );
  };

  useEffect(() => {
    const win = window;
    if (win.addEventListener) {
      win.addEventListener('resize', onResize, false);
      // } else if (win.attachEvent) {
      //   win.attachEvent('onresize', onResize);
    } else {
      win.onresize = onResize;
    }
    onResize();
  }, []);
  const width = winWidth;
  const height = Math.max(winHeight - top, 1);
  // console.log(`width: ${width}x${height}`);
  return (
    <div
      style={{
        // margin: '16px', // Use state variable for padding
        width: '100%', // Fill the width of the content area
        height: '100%', // Fill the height of the content area
        display: 'flex', // Use flexbox for centering
        justifyContent: 'center', // Center horizontally
        alignItems: 'center', // Center vertically
        overflow: 'hidden', // In case the image is too big
        flexDirection: 'column',
      }}
    >
      <FileScrubber />
      <VideoScrubber />
      <Measure
        bounds
        onResize={(contentRect) => {
          if (contentRect.bounds) {
            setDimensions({
              top: contentRect.bounds.top,
              width: contentRect.bounds.width,
              height: contentRect.bounds.height,
            });
          }
          // console.log(JSON.stringify(contentRect.bounds));
        }}
      >
        {({ measureRef }) => (
          <div ref={measureRef} style={{ flexGrow: 1, width: '100%' }}>
            <Stack direction="row">
              <VideoImage
                width={(width || sidebarWidth + 1) - sidebarWidth}
                height={height || 1}
              />
              <Stack direction="column" sx={{ width: sidebarWidth }}>
                <Stack direction="row" sx={{ flexGrow: 1 }}>
                  {enableVideoTiming && (
                    <TimingSidebar
                      height={height}
                      sx={{
                        width: timingSidebarwidth,
                        height: height,
                      }}
                    />
                  )}
                  {videoSettings.videoPanel && (
                    <VideoSideBar
                      height={height}
                      sx={{
                        width: videoSidebarWidth,
                      }}
                    />
                  )}
                </Stack>
              </Stack>
            </Stack>
          </div>
        )}
      </Measure>
    </div>
  );
};

export default Video;
