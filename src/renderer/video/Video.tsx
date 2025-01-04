import { Box, Typography, Stack, Tooltip, Button } from '@mui/material';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDebouncedCallback } from 'use-debounce';
import makeStyles from '@mui/styles/makeStyles';
import Measure, { ContentRect } from 'react-measure';
import { UseDatum } from 'react-usedatum';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import { convertTimestampToString } from '../shared/Util';
import VideoSideBar from './VideoSideBar';
import {
  Dir,
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoSettings,
  setVideoBow,
  setVideoTimestamp,
  useResetZoomCounter,
  useImage,
  useTravelRightToLeft,
  useVideoError,
  useVideoFile,
  resetVideoZoom,
  getVideoScaling,
  Point,
  useVideoScaling,
  getHyperZoomFactor,
  setAutoZoomPending,
  getAutoZoomPending,
} from './VideoSettings';
import VideoOverlay, {
  getNearEdge,
  useOverlayActive,
  VideoOverlayHandles,
} from './VideoOverlay';
import TimingSidebar from './TimingSidebar';
import {
  downloadImageFromCanvasLayers,
  drawText,
  findClosestLineAndPosition,
  getFinishLine,
  moveLeft,
  moveRight,
  moveToFrame,
  translateMouseEvent2Src,
} from './VideoUtils';
import FileScrubber from './FileScrubber';
import { setGenerateImageSnapshotCallback } from './ImageButton';
import VideoScrubber from './VideoScrubber';
import { performAddSplit } from './AddSplitUtil';
import Blowup from './Blowup';
import { updateVideoScaling } from '../util/ImageScaling';

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
  zoom: {
    zIndex: 400,
    background: '#ffffff80',
    color: 'black',
    border: '1px solid black',
    height: '32px',
    padding: '0.2em',
    marginLeft: '2em',
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

const [useShowBlowup, setShowBlowup] = UseDatum(false);

const applyZoom = ({ srcPoint, zoom }: { srcPoint: Point; zoom: number }) => {
  const vScaling = getVideoScaling();
  updateVideoScaling({
    zoomY: zoom,
    srcCenterPoint:
      zoom === 1
        ? { x: vScaling.srcWidth / 2, y: vScaling.srcHeight / 2 }
        : srcPoint,
  });
};

const isZooming = () => getVideoScaling().zoomY !== 1;

const clearZoom = () => {
  updateVideoScaling({
    zoomX: 1,
    zoomY: 1,
    srcCenterPoint: getVideoScaling().srcCenterPoint,
  });
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
      if (getTravelRightToLeft()) {
        moveLeft();
      } else {
        moveRight();
      }
      break;
    case 'ArrowLeft':
    case '<':
    case ',':
      if (getTravelRightToLeft()) {
        moveRight();
      } else {
        moveLeft();
      }
      break;
    case 'Shift':
      // setShowBlowup(!isZooming());
      setShowBlowup(!getNearEdge());
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
  const [overlayActive] = useOverlayActive();
  const [videoFile] = useVideoFile();
  const holdoffChanges = useRef<boolean>(false);
  const [videoError] = useVideoError();
  const [travelRightToLeft] = useTravelRightToLeft();
  const [resetZoomCount] = useResetZoomCounter();
  const destSize = useRef({ width, height });
  const srcCenter = useRef<Point>({ x: width / 2, y: height / 2 });
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [srcPos, setSrcPos] = useState<Point>({ x: 0, y: 0 });
  const [showBlowup] = useShowBlowup();
  const [videoScaling] = useVideoScaling();
  destSize.current = { width, height };

  const mouseTracking = useRef<MouseState>({
    imageLoaded: false,
    mouseDownClientX: 0,
    mouseDownClientY: 0,
    mouseDown: undefined,
  });

  holdoffChanges.current = image.file !== videoFile; // || activeVideoFile.current !== videoFile;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoOverlayRef = useRef<VideoOverlayHandles>(null);
  const offscreenCanvas = useRef(document.createElement('canvas'));

  const videoTimestamp = convertTimestampToString(
    image.timestamp,
    image.tzOffset,
  );

  useEffect(() => {
    // Refresh the offscreenCanvas if the image changes
    offscreenCanvas.current.width = image.width;
    offscreenCanvas.current.height = image.height;
    const ctx = offscreenCanvas.current?.getContext('2d');
    if (ctx && image.width) {
      ctx.putImageData(
        new ImageData(
          new Uint8ClampedArray(image.data),
          image.width,
          image.height,
        ),
        0,
        0,
      );

      drawText(
        ctx,
        '                  CrewTimer Regatta Timing                   ',
        16,
        30,
        32,
        'below',
        'left',
        '#ccc',
      );

      mouseTracking.current.imageLoaded = true;
    } else {
      mouseTracking.current.imageLoaded = false;
    }
  }, [image]);

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
          const vScaling = getVideoScaling();
          ctx.save();
          ctx.translate(vScaling.destX, vScaling.destY);
          ctx.scale(vScaling.scaleX, vScaling.scaleY);
          ctx.drawImage(offscreenCanvas.current, 0, 0);
          ctx.restore();

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
    updateVideoScaling({
      srcWidth: image.width,
      srcHeight: image.height,
      zoomX: videoScaling.zoomX, // retain zoom
      zoomY: videoScaling.zoomY,
      destWidth: width,
      destHeight: height,
      srcCenterPoint:
        videoScaling.zoomY === 1
          ? { x: image.width / 2, y: image.height / 2 }
          : videoScaling.srcCenterPoint,
    });
  }, [
    image,
    image.width,
    image.height,
    width,
    height,
    videoScaling.zoomX,
    videoScaling.zoomY,
    videoScaling.srcWidth,
    videoScaling.srcHeight,
    videoScaling.destWidth,
    videoScaling.destHeight,
    videoScaling.srcCenterPoint,
  ]);

  useEffect(() => {
    // Draw the image
    drawContentDebounced();
  }, [
    drawContentDebounced,
    image,
    videoScaling.destX,
    videoScaling.destY,
    videoScaling.scaleX,
    videoScaling.scaleY,
  ]);

  useEffect(() => {
    // A bit of a hack but set a global callback function instead of passing it down the tree
    // May not be needed now that videoScaling is a global
    setGenerateImageSnapshotCallback(() => {
      const vScaling = getVideoScaling();
      downloadImageFromCanvasLayers(
        // 'video-snapshot.png',
        `Image_${videoTimestamp}.png`,
        [canvasRef.current, videoOverlayRef.current?.getCanvas()],
        (width - vScaling.destWidth) / 2,
        0,
        vScaling.destWidth,
        vScaling.destHeight,
      );
    });
    return () => setGenerateImageSnapshotCallback(undefined);
  }, [videoTimestamp, width]);

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
          zoom: 5,
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

  const videoOverlay = useMemo(
    () => <VideoOverlay ref={videoOverlayRef} width={width} height={height} />,
    [width, height],
  );

  const selectLane = useCallback(
    (point: Point) => {
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
        getVideoSettings().laneBelowGuide ? 'below' : 'above',
      );
      if (result.closestLine >= 0) {
        const lane = laneLines[result.closestLine].lane.label.split(' ')[1];
        setVideoBow(lane);
      }
    },
    [image.width],
  );

  const handleDragStart = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    event.preventDefault();
  };

  const handleDoubleClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
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
      if (event.button !== 0) {
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
          moveToFrame(getVideoFrameNum() + 0.5); // 0.5 to trigger calc of
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
    [selectLane],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const { x, y, pt: srcCoords } = translateMouseEvent2Src(event, rect);

      setShowBlowup(event.shiftKey && !getNearEdge());
      if (event.shiftKey) {
        setMousePos({ x, y });
        setSrcPos(srcCoords);
      }

      // dont trigger mouse down move actions until we have moved slightly. This avoids
      // accidental zooming on just a click
      const downMoveY = Math.abs(mouseTracking.current.mouseDownClientY - y);
      if (event.shiftKey && mouseTracking.current.mouseDown && downMoveY > 10) {
        const vScaling = getVideoScaling();
        const deltaY = event.movementY;
        const newScale = Math.max(1, vScaling.zoomY + deltaY * 0.01);
        // Adjust the scale based on the mouse movement
        applyZoom({ zoom: newScale, srcPoint: srcCenter.current });
      }
      if (mouseTracking.current.mouseDown) {
        const downMoveX = mouseTracking.current.mouseDownClientX - x;
        // Only start tracking if we have moved a significant amount
        if (isZooming() && Math.abs(downMoveX) > 5) {
          const delta = Math.sign(downMoveX) * 1; // FIXME - use velocity to determine amount
          mouseTracking.current.mouseDownClientX = x;
          moveToFrame(getVideoFrameNum(), travelRightToLeft ? delta : -delta);
        }
      }
    },
    [travelRightToLeft],
  );

  // Clear zoom if file changes
  useEffect(() => {
    clearZoom();
  }, [image.file]);

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
  };

  const handleMouseUp = useCallback(
    (/* _event: React.MouseEvent<HTMLDivElement, MouseEvent> */) => {
      mouseTracking.current.mouseDown = false;
    },
    [],
  );

  const handleRightClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    performAddSplit();
  };

  useEffect(() => {
    videoVisible = true;
    // Cleanup the keydown listener on unmount
    return () => {
      videoVisible = false;
    };
  }, []);

  useEffect(() => {
    setVideoTimestamp(videoTimestamp);
  }, [image, videoTimestamp]);

  const frameNum = getVideoFrameNum();
  const fracFrame = frameNum - Math.trunc(frameNum);
  const hyperZoom = fracFrame > 0.001 && fracFrame < 0.999;
  const scaleText = `${videoScaling.zoomX * videoScaling.zoomY}X`;
  return (
    <Stack direction="column">
      <Box
        onMouseDown={overlayActive ? undefined : handleMouseDown}
        onMouseMove={handleMouseMove} // {adjustingOverlay ? undefined : handleMouseMove}
        onMouseUp={overlayActive ? undefined : handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDragStart={overlayActive ? undefined : handleDragStart}
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
            alignItems: 'end',
            paddingTop: '5px',
            paddingRight: '58px',
          }}
        >
          <Stack
            direction="row"
            sx={
              // travelRightToLeft
              //   ? {
              //       paddingRight: `${width / 2}px`,
              //     }
              //   : { paddingLeft: `${width / 2}px` }
              {}
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
            <Tooltip title="x-axis zoom factor">
              <Button
                size="small"
                variant="outlined"
                className={classes.zoom}
                sx={{
                  height: 24,
                  m: 0,
                  minWidth: 30,
                }}
                onClick={() => {
                  let { zoomX } = getVideoScaling();
                  if (zoomX >= 16) {
                    zoomX = 1;
                  } else {
                    zoomX *= 2;
                  }
                  updateVideoScaling({ zoomX });
                }}
              >
                {scaleText}
              </Button>
            </Tooltip>
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
            size={150} // size of the blowup circle
          />
        )}
        {videoOverlay}
      </Box>
    </Stack>
  );
};

const [useWindowSize] = UseDatum({ winWidth: 0, winHeight: 0 });

const Video = () => {
  const [{ top }, setDimensions] = useState({ top: 180, width: 1, height: 1 });
  const videoSidebarWidth = 130; // enough for '20240308_123248.mp4'
  const timingSidebarwidth = 300;
  const sidebarWidth = Math.max(60, videoSidebarWidth + timingSidebarwidth);
  const [{ winWidth, winHeight }, setWindowSize] = useWindowSize();

  const onResize = useCallback(() => {
    setWindowSize({
      winWidth: window.innerWidth,
      winHeight: window.innerHeight,
    });
  }, [setWindowSize]);

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
  }, [onResize]);
  const width = winWidth;
  const height = Math.max(winHeight - top, 1);

  // Define the type for contentRect in the callback
  const handleResize = (contentRect: ContentRect) => {
    if (contentRect.bounds) {
      setDimensions({
        top: contentRect.bounds.top,
        width: contentRect.bounds.width,
        height: contentRect.bounds.height,
      });
    }
  };

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
      <Measure bounds onResize={handleResize}>
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
                      height,
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
