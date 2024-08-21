import { Box, Typography, Stack, Tooltip } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { convertTimestampToString } from '../shared/Util';
import { useDebouncedCallback } from 'use-debounce';
import makeStyles from '@mui/styles/makeStyles';
import VideoSideBar from './VideoSideBar';
import {
  Dir,
  getMouseWheelFactor,
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoSettings,
  setVideoBow,
  setVideoTimestamp,
  useResetZoomCounter,
  useImage,
  useMouseWheelInverted,
  useTimezoneOffset,
  useTravelRightToLeft,
  useVideoError,
  useVideoFile,
  resetVideoZoom,
  setVideoScaling,
  getVideoScaling,
  Point,
  useVideoScaling,
  getHyperZoomFactor,
} from './VideoSettings';
import VideoOverlay, {
  useAdjustingOverlay,
  useNearEdge,
  VideoOverlayHandles,
} from './VideoOverlay';
import TimingSidebar from './TimingSidebar';
import {
  downloadImageFromCanvasLayers,
  findClosestLineAndPosition,
  getFinishLine,
  moveLeft,
  moveRight,
  moveToFrame,
  translateMouseEvent2Src,
} from './VideoUtils';
import FileScrubber from './FileScrubber';
import Measure from 'react-measure';
import { UseDatum } from 'react-usedatum';
import { setGenerateImageSnapshotCallback } from './ImageButton';
import VideoScrubber from './VideoScrubber';
import { performAddSplit } from './AddSplitUtil';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import Blowup from './Blowup';

const useStyles = makeStyles({
  text: {
    zIndex: 200,
    background: '#ffffffa0',
    color: 'black',
    border: '1px solid black',
    height: '32px',
    padding: '0.2em',
  },
  tstext: {
    zIndex: 1,
    background: '#ffffff80',
    color: 'black',
    border: '1px solid black',
    height: '32px',
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
  hyperzoom: {
    zIndex: 200,
    background: '#ffffff80',
    color: 'black',
    height: '32px',
    width: '24px',
    border: '1px solid black',
  },
  hyperpadding: {
    height: '32px',
    width: '24px',
    border: '1px solid transparent',
  },
});

export const [useAutoZoomPending, setAutoZoomPending, getAutoZoomPending] =
  UseDatum<undefined | Point>(undefined);

const [useShowBlowup, setShowBlowup] = UseDatum(false);

const applyZoom = ({ srcPoint, zoom }: { srcPoint: Point; zoom: number }) => {
  const videoScaling = getVideoScaling();

  const destZoomWidth = videoScaling.destWidth * zoom;
  const destZoomHeight = videoScaling.destHeight * zoom;

  const srcWidth = videoScaling.srcWidth;
  const srcHeight = videoScaling.srcHeight;

  if (srcPoint.x === 0) {
    srcPoint = { x: srcWidth / 2, y: srcHeight / 2 };
  }

  // Calculate the aspect ratio
  const srcAspectRatio = srcWidth / srcHeight;
  const destAspectRatio = destZoomWidth / destZoomHeight;

  let scaledWidth: number;
  let scaledHeight: number;
  let pixScale: number;
  // Maintain the aspect ratio
  if (srcAspectRatio > destAspectRatio) {
    // Source is wider relative to destination
    scaledWidth = destZoomWidth;
    scaledHeight = destZoomWidth / srcAspectRatio;
    pixScale = srcHeight / scaledHeight;
  } else {
    // Source is taller relative to destination
    scaledWidth = destZoomHeight * srcAspectRatio;
    scaledHeight = destZoomHeight;
    pixScale = srcWidth / scaledWidth;
  }

  const destX =
    videoScaling.destWidth / 2 - scaledWidth * (srcPoint.x / srcWidth);
  const destY = Math.min(
    0,
    videoScaling.destHeight / 2 - scaledHeight * (srcPoint.y / srcHeight)
  );

  setVideoScaling((prior) => ({
    ...prior,
    destX,
    destY,
    srcCenterPoint: srcPoint,
    scaledWidth,
    scaledHeight,
    zoom,
    pixScale,
  }));
};

const isZooming = () => getVideoScaling().zoom !== 1;

const clearZoom = () => {
  applyZoom({ zoom: 1, srcPoint: getVideoScaling().srcCenterPoint });
};

interface MouseState {
  mouseDownClientX: number;
  mouseDownClientY: number;
  mouseDown: boolean | undefined;
  imageLoaded: boolean;
}

// Setting the window.removeEventListener in a useEffect for some reason ended up
// with multiple callback calls.  As a workaround, try using a global variable to
// gate the functions actions.
let videoVisible = false;
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!videoVisible) {
    return;
  }
  switch (event.key) {
    case 'ArrowRight':
    case '>':
    case '.':
      getTravelRightToLeft() ? moveLeft() : moveRight();
      break;
    case 'ArrowLeft':
    case '<':
    case ',':
      getTravelRightToLeft() ? moveRight() : moveLeft();
      break;
    case 'Shift':
      // setShowBlowup(!isZooming());
      setShowBlowup(true);
      break;

    default:
      break; // ignore
  }
});

window.addEventListener('keyup', (event: KeyboardEvent) => {
  if (!videoVisible) {
    return;
  }
  switch (event.key) {
    case 'Shift':
      setShowBlowup(false);
      break;
    default:
      break; // ignore
  }
});

const VideoImage: React.FC<{ width: number; height: number }> = ({
  width,
  height,
}) => {
  const [image] = useImage();
  const classes = useStyles();
  const [adjustingOverlay] = useAdjustingOverlay();
  const [, setNearEdge] = useNearEdge();
  const [timezoneOffset] = useTimezoneOffset();
  const [videoFile] = useVideoFile();
  const holdoffChanges = useRef<boolean>(false);
  const [videoError] = useVideoError();
  const [wheelInverted] = useMouseWheelInverted();
  const [travelRightToLeft] = useTravelRightToLeft();
  const [resetZoomCount] = useResetZoomCounter();
  const destSize = useRef({ width, height });
  const srcCenter = useRef<Point>({ x: width / 2, y: height / 2 });
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [srcPos, setSrcPos] = useState<Point>({ x: 0, y: 0 });
  const [showBlowup, setShowBlowup] = useShowBlowup();
  const [videoScaling] = useVideoScaling();
  destSize.current = { width, height };

  const mouseTracking = useRef<MouseState>({
    imageLoaded: false,
    mouseDownClientX: 0,
    mouseDownClientY: 0,
    mouseDown: undefined,
  });

  holdoffChanges.current = image.file !== videoFile; // || activeVideoFile.current !== videoFile;

  const infoRowHeight = 0; // 40;
  height = height - infoRowHeight;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoOverlayRef = useRef<VideoOverlayHandles>(null);
  const offscreenCanvas = useRef(document.createElement('canvas'));

  useEffect(() => {
    mouseTracking.current.mouseDown = false;
    srcCenter.current = { x: image.width / 2, y: image.height / 2 };
    setVideoScaling((prior) => ({
      ...prior,
      srcWidth: image.width,
      srcHeight: image.height,
      destWidth: width,
      destHeight: height,
    }));
    applyZoom({
      zoom: 1,
      srcPoint: { x: image.width / 2, y: image.height / 2 },
    });
    drawContentDebounced();
  }, [image.width, image.height, width, height]);

  useEffect(() => {
    console.log(`frame=${image.frameNum} dx=${image.motion.x}`);
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
      drawContentDebounced();
    } else {
      mouseTracking.current.imageLoaded = false;
    }
  }, [image, videoScaling.zoom]);

  useEffect(() => {
    // A bit of a hack but set a global callback function instead of passing it down the tree
    setGenerateImageSnapshotCallback(() => {
      const videoScaling = getVideoScaling();
      downloadImageFromCanvasLayers(
        // 'video-snapshot.png',
        `Image_${videoTimestamp}.png`,
        [canvasRef.current, videoOverlayRef.current?.getCanvas()],
        (width - videoScaling.destWidth) / 2,
        0,
        videoScaling.destWidth,
        videoScaling.destHeight
      );
    });
    return () => setGenerateImageSnapshotCallback(undefined);
  }, []);

  const drawContentDebounced = useDebouncedCallback(() => {
    if (mouseTracking.current.imageLoaded && canvasRef?.current) {
      const canvas = canvasRef.current;
      if (canvas.width <= 1) {
        return;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        if (image.width) {
          const videoScaling = getVideoScaling();

          ctx.drawImage(
            offscreenCanvas.current,
            0,
            0,
            videoScaling.srcWidth,
            videoScaling.srcHeight,
            videoScaling.destX,
            videoScaling.destY,
            videoScaling.scaledWidth,
            videoScaling.scaledHeight
          );

          // ctx.beginPath();
          // Draw a border as a Rectangle
          // ctx.strokeStyle = 'black'; // You can choose any color
          // ctx.lineWidth = 1; // Width of the border
          // ctx.strokeRect(
          //   (canvas.width - destWidth) / 2,
          //   0,
          //   destWidth - 1,
          //   destHeight - 1
          // );
        }
      }
    }
  }, 10);

  useEffect(() => {
    const zoomPoint = getAutoZoomPending();

    if (zoomPoint && image.motion.valid) {
      setAutoZoomPending(undefined);
      if (Math.abs(image.motion.x) > 0.1 && Math.abs(image.motion.x) < 15) {
        // Calculate movement
        const finish = getFinishLine();
        const dx = image.width / 2 + finish.pt1 - zoomPoint.x;
        const ticks = dx / image.motion.x;
        console.log(`Ticks: ${ticks} (${dx} / ${image.motion.x})`);
        // subtract 0.5 as that was used to trigger calc of dx
        let destFrame = getVideoFrameNum() + ticks - 0.5;
        if (getHyperZoomFactor() === 0) {
          destFrame = Math.round(destFrame);
        }
        moveToFrame(destFrame);
        applyZoom({
          zoom: 4,
          srcPoint: {
            x: getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2,
            y: zoomPoint.y,
          },
        });
      } else {
        console.log(`Failed to auto-zoom rx frame=${image.frameNum}`);
      }
    }
  }, [image]);

  const selectLane = (point: Point) => {
    const laneLines = getVideoSettings()
      .guides.filter((lane) => lane.dir === Dir.Horiz && lane.enabled)
      .map((lane) => ({
        pt1: { x: 0, y: lane.pt1 },
        pt2: { x: image.width, y: lane.pt2 },
        lane,
      }));
    const result = findClosestLineAndPosition(
      point,
      laneLines,
      getVideoSettings().laneBelowGuide ? 'below' : 'above'
    );
    if (result.closestLine >= 0) {
      const lane = laneLines[result.closestLine].lane.label.split(' ')[1];
      setVideoBow(lane);
    }
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
    resetVideoZoom();
  };

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (event.button != 0) {
        return;
      }
      setShowBlowup(false);

      const rect = canvasRef.current?.getBoundingClientRect();
      const {
        x,
        y,
        pt: srcCoords,
        withinBounds,
      } = translateMouseEvent2Src(event, rect);
      if (!withinBounds) {
        return;
      }

      mouseTracking.current.mouseDown = true;
      mouseTracking.current.mouseDownClientX = x;
      mouseTracking.current.mouseDownClientY = y;

      const videoSettings = getVideoSettings();
      if (videoSettings.enableLaneGuides) {
        selectLane(srcCoords);
      }
      if (event.shiftKey) {
        if (videoSettings.enableAutoZoom) {
          setAutoZoomPending(srcCoords);
          moveToFrame(getVideoFrameNum() + 0.5); //0.5 to trigger calc of
        }
      } else if (!isZooming()) {
        const finish = getFinishLine();
        applyZoom({
          zoom: 5,
          srcPoint: {
            x: getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2,
            y: srcCoords.y,
          },
        });
      }
    },
    []
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const {
        x,
        y,
        pt: srcCoords,
        withinBounds,
      } = translateMouseEvent2Src(event, rect);

      setMousePos({ x, y });
      setSrcPos(srcCoords);
      const videoScaling = getVideoScaling();
      setShowBlowup(event.shiftKey);

      const nearVerticalEdge =
        srcCoords.y < 20 || srcCoords.y > videoScaling.srcHeight - 20;

      const nearHorizontalEdge =
        srcCoords.x < 20 || srcCoords.x > videoScaling.srcWidth - 20;

      const nearEdge = withinBounds && (nearVerticalEdge || nearHorizontalEdge);
      setNearEdge(nearEdge && !isZooming());

      // dont trigger mouse down move actions until we have moved slightly. This avoids
      // accidental zooming on just a click
      const downMoveY = Math.abs(mouseTracking.current.mouseDownClientY - y);
      if (event.shiftKey && mouseTracking.current.mouseDown && downMoveY > 10) {
        const deltaY = event.movementY;
        const newScale = Math.max(1, videoScaling.zoom + deltaY * 0.01);
        // Adjust the scale based on the mouse movement
        applyZoom({ zoom: newScale, srcPoint: srcCenter.current });
      }
      if (mouseTracking.current.mouseDown) {
        let downMoveX = mouseTracking.current.mouseDownClientX - x;
        // Only start tracking if we have moved a significant amount
        if (isZooming() && Math.abs(downMoveX) > 5) {
          const delta = Math.sign(downMoveX) * 8; // FIXME - use velocity to determine amount
          mouseTracking.current.mouseDownClientX = x;
          moveToFrame(getVideoFrameNum(), travelRightToLeft ? delta : -delta);
        }
      }
      drawContentDebounced();
    },
    []
  );

  useEffect(() => {
    clearZoom();
    // Trigger a reload of this frame as we exit zoom.
    // This frame will be generated without alpha blending but simply moving the frame
    // so it doesn't look fuzzy.
    // const frameNum = getVideoFrameNum();
    moveToFrame(getVideoFrameNum(), undefined, false); // keep to trigger refresh on exiting zoom
  }, [resetZoomCount]);

  const handleMouseLeave = () => {
    setShowBlowup(false);
    adjustingOverlay ? undefined : () => setNearEdge(false);
  };

  const handleMouseUp = useCallback(
    (_event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      mouseTracking.current.mouseDown = false;
    },
    [image]
  );

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (holdoffChanges.current) {
      return;
    }

    let delta =
      (wheelInverted ? -1 : 1) *
      Math.sign(event.deltaY) *
      Math.max(
        1,
        Math.trunc(
          Math.abs(
            event.deltaY / getMouseWheelFactor() / getVideoScaling().zoom
          )
        )
      );
    if (!isZooming() && Math.abs(delta) > 6) {
      delta = Math.sign(delta) * 6;
    }
    moveToFrame(getVideoFrameNum(), delta);
  }, []);

  const handleRightClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    performAddSplit();
  };

  useEffect(() => {
    videoVisible = true;
    // Cleanup the keydown listener on unmount
    return () => {
      videoVisible = false;
    };
  }, []);

  const videoTimestamp = convertTimestampToString(
    image.timestamp,
    timezoneOffset
  );

  useEffect(() => {
    setVideoTimestamp(videoTimestamp);
  }, [image]);

  const frameNum = getVideoFrameNum();
  const fracFrame = frameNum - Math.trunc(frameNum);
  const hyperZoom = fracFrame > 0.001 && fracFrame < 0.999;
  return (
    <Stack direction="column">
      <Box
        onWheel={adjustingOverlay ? undefined : handleWheel}
        onMouseDown={adjustingOverlay ? undefined : handleMouseDown}
        onMouseMove={handleMouseMove} //{adjustingOverlay ? undefined : handleMouseMove}
        onMouseUp={adjustingOverlay ? undefined : handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDragStart={adjustingOverlay ? undefined : handleDragStart}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleRightClick}
        sx={{
          // margin: '16px', // Use state variable for padding
          width: `100%`, // Fill the width of the content area
          height: `100%`, // Fill the height of the content area
          maxHeight: `100%`,
          display: 'flex', // Use flexbox for centering
          // justifyContent: 'center', // Center horizontally
          alignItems: 'top', //  vertically
          overflow: 'hidden', // In case the image is too big
          // cursor: showBlowup ? 'none' : 'auto',
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
          <Stack
            direction="row"
            sx={
              travelRightToLeft
                ? {
                    paddingRight: `${width / 2}px`,
                  }
                : { paddingLeft: `${width / 2}px` }
            }
          >
            <div />
            {hyperZoom && <Box className={classes.hyperpadding} />}
            <Typography className={classes.tstext}>{videoTimestamp}</Typography>
            {hyperZoom && (
              <Tooltip title="Hyperzoom generated timestamp">
                <ZoomInIcon className={classes.hyperzoom} />
              </Tooltip>
            )}
            <div />
          </Stack>
          {!!videoError && (
            <Typography
              className={classes.computedtext}
              align="center"
              sx={{ marginTop: '24px' }}
            >
              {videoError}
            </Typography>
          )}
        </Stack>
        <canvas
          ref={canvasRef}
          width={`${width}px`}
          height={`${height}px`}
          style={{
            position: 'absolute', // keeps the size from influencing the parent size
          }}
        />
        {showBlowup && (
          <Blowup
            canvas={offscreenCanvas.current}
            mousePos={mousePos}
            srcPos={srcPos}
            size={videoScaling.zoom > 1 ? 100 : 100 / videoScaling.pixScale} // size of the blowup circle
            zoom={
              videoScaling.zoom > 1
                ? 1 / videoScaling.pixScale
                : 2 / videoScaling.pixScale
            }
          />
        )}
        <VideoOverlay
          ref={videoOverlayRef}
          width={width}
          height={height}
          destHeight={getVideoScaling().destHeight}
          destWidth={getVideoScaling().destWidth}
        />
      </Box>
    </Stack>
  );
};

const [useWindowSize] = UseDatum({ winWidth: 0, winHeight: 0 });

const Video = () => {
  const [{ top }, setDimensions] = useState({ top: 170, width: 1, height: 1 });
  const videoSidebarWidth = 170; // enough for '20240308_123248.mp4'
  const timingSidebarwidth = 300;
  const sidebarWidth = Math.max(60, videoSidebarWidth + timingSidebarwidth);
  const [{ winWidth, winHeight }, setWindowSize] = useWindowSize();

  const onResize = () => {
    setWindowSize({
      winWidth: window.innerWidth,
      winHeight: window.innerHeight,
    });
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
                  <TimingSidebar
                    height={height}
                    width={timingSidebarwidth}
                    sx={{
                      width: timingSidebarwidth,
                      height: height,
                    }}
                  />
                  <VideoSideBar
                    height={height}
                    sx={{
                      width: videoSidebarWidth,
                    }}
                  />
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
