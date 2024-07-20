import { Box, Typography, Stack, Tooltip } from '@mui/material';
import React, {
  useCallback,
  useEffect,
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
  getMouseWheelFactor,
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoSettings,
  setVideoBow,
  setVideoTimestamp,
  setZoomWindow,
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
} from './VideoSettings';
import VideoOverlay, {
  useAdjustingOverlay,
  useNearEdge,
  VideoOverlayHandles,
} from './VideoOverlay';
import { Rect } from 'renderer/shared/AppTypes';
import TimingSidebar from './TimingSidebar';
import {
  downloadImageFromCanvasLayers,
  findClosestLineAndPosition,
  moveLeft,
  moveRight,
  moveToFrame,
} from './VideoUtils';
import FileScrubber from './FileScrubber';
import Measure from 'react-measure';
import { UseDatum } from 'react-usedatum';
import { setGenerateImageSnapshotCallback } from './ImageButton';
import VideoScrubber from './VideoScrubber';
import { performAddSplit } from './AddSplitUtil';
import ZoomInIcon from '@mui/icons-material/ZoomIn';

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
    background: '#ffffffa0',
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
    background: '#ffffffa0',
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

interface DrawImageProps {
  srcCanvas: HTMLCanvasElement;
  destCanvas: HTMLCanvasElement | null;
  destWidth: number;
  destHeight: number;
  srcPoint: { x: number; y: number };
  zoom: number;
}

const genHelperFunctions = ({
  srcCanvas,
  destCanvas,
  destWidth,
  destHeight,
  srcPoint,
  zoom,
}: DrawImageProps) => {
  if (!srcCanvas || !destCanvas) {
    return;
  }
  const srcCtx = srcCanvas.getContext('2d');
  const destCtx = destCanvas.getContext('2d');

  if (!srcCtx || !destCtx) {
    return;
  }

  const destZoomWidth = destWidth * zoom;
  const destZoomHeight = destHeight * zoom;

  const srcWidth = srcCanvas.width;
  const srcHeight = srcCanvas.height;

  if (srcPoint.x === 0) {
    srcPoint = { x: srcWidth / 2, y: srcHeight / 2 };
  }

  // Calculate the aspect ratio
  const srcAspectRatio = srcWidth / srcHeight;
  const destAspectRatio = destZoomWidth / destZoomHeight;

  let scaledWidth: number;
  let scaledHeight: number;
  // Maintain the aspect ratio
  if (srcAspectRatio > destAspectRatio) {
    // Source is wider relative to destination
    scaledWidth = destZoomWidth;
    scaledHeight = destZoomWidth / srcAspectRatio;
  } else {
    // Source is taller relative to destination
    scaledWidth = destZoomHeight * srcAspectRatio;
    scaledHeight = destZoomHeight;
  }

  const destX = destWidth / 2 - scaledWidth * (srcPoint.x / srcWidth);
  const destY = Math.min(
    0,
    destHeight / 2 - scaledHeight * (srcPoint.y / srcHeight)
  );
  console.log(
    JSON.stringify(
      {
        srcWidth,
        srcHeight,
        destZoomWidth,
        destZoomHeight,
        zoom,
        destX,
        destY,
      },
      null,
      2
    )
  );

  setVideoScaling({
    destX,
    destY,
    destWidth,
    destHeight,
    srcWidth,
    srcHeight,
    scaledWidth,
    scaledHeight,
    zoom,
  });
};

interface CalPoint {
  ts: number;
  px: number;
  scale: number;
}

interface ZoomState {
  mouseMove: number;
  mouseDownClientX: number;
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
  calPoints: CalPoint[];
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
  const [, forceRender] = useReducer((s) => s + 1, 0);
  const [computedTime, setComputedTime] = useState(0);
  const [adjustingOverlay] = useAdjustingOverlay();
  const [, setNearEdge] = useNearEdge();
  const [timezoneOffset] = useTimezoneOffset();
  const [videoFile] = useVideoFile();
  const holdoffChanges = useRef<boolean>(false);
  const [videoError] = useVideoError();
  const [wheelInverted] = useMouseWheelInverted();
  const [travelRightToLeft] = useTravelRightToLeft();
  const [resetZoomCount] = useResetZoomCounter();
  const imageToCanvasScale = useRef(1);
  const destSize = useRef({ width, height });
  console.log(`size: ${width}x${height}`);
  destSize.current = { width, height };

  const mouseTracking = useRef<ZoomState>({
    zoomWindow: { x: 0, y: 0, width: 0, height: 0 },
    zoomStartWindow: { x: 0, y: 0, width: 0, height: 0 },
    imageScale: 1,
    scale: 1,
    imageLoaded: false,
    mouseDownClientX: 0,
    mouseDownClientY: 0,
    mouseDownPositionY: 0,
    mouseDownPositionX: 0,
    mouseMove: 0,
    mouseDown: undefined,
    isPinching: false,
    isZooming: false,
    initialPinchDistance: 0,
    initialPinchRange: { min: 0, max: 100 },
    calPoints: [
      { ts: 0, px: 0, scale: 1 },
      { ts: 0, px: 0, scale: 1 },
    ],
  });

  holdoffChanges.current = image.file !== videoFile; // || activeVideoFile.current !== videoFile;

  const infoRowHeight = 0; // 40;
  height = height - infoRowHeight;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoOverlayRef = useRef<VideoOverlayHandles>(null);
  const offscreenCanvas = useRef(document.createElement('canvas'));

  const setScale = useCallback((scale: number) => {
    mouseTracking.current.scale = scale;
    drawContent();
  }, []);

  const updateImageHelpers = () => {
    console.log(
      `updating image helpers image ${image.width}x${image.height} canvas ${width}x${height}`
    );
    genHelperFunctions({
      srcCanvas: offscreenCanvas.current,
      destCanvas: canvasRef.current,
      destWidth: destSize.current.width,
      destHeight: destSize.current.height,
      zoom: mouseTracking.current.scale,
      srcPoint: {
        x: mouseTracking.current.isZooming
          ? mouseTracking.current.mouseDownPositionX
          : 0,
        y: mouseTracking.current.isZooming
          ? mouseTracking.current.mouseDownPositionY
          : 0,
      },
    });
  };

  // useEffect(() => {
  //   updateImageHelpers();
  // }, [image.width, image.height, width, height]);

  const initScaling = useCallback(() => {
    setScale(1);
    mouseTracking.current.mouseDown = false;
    mouseTracking.current.isPinching = false;
    mouseTracking.current.isZooming = false;
    mouseTracking.current.calPoints[0].ts = 0;
    mouseTracking.current.calPoints[1].ts = 0;

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

  const xPadding = Math.round((width - destWidth) / 2);

  useEffect(() => {
    // A bit of a hack but set a global callback function instead of passing it down the tree
    setGenerateImageSnapshotCallback(() => {
      downloadImageFromCanvasLayers(
        // 'video-snapshot.png',
        `Image_${videoTimestamp}.png`,
        [canvasRef.current, videoOverlayRef.current?.getCanvas()],
        xPadding,
        0,
        destWidth,
        destHeight
      );
    });
    return () => setGenerateImageSnapshotCallback(undefined);
  }, [xPadding, destWidth, destHeight]);

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
          if (mouseTracking.current.calPoints[0].ts !== 0) {
            const x =
              canvas.width / 2 +
              (mouseTracking.current.calPoints[0].px *
                mouseTracking.current.scale) /
                mouseTracking.current.calPoints[0].scale;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, destHeight);
            ctx.strokeStyle = 'blue';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (mouseTracking.current.calPoints[1].ts !== 0) {
            const x =
              canvas.width / 2 +
              (mouseTracking.current.calPoints[1].px *
                mouseTracking.current.scale) /
                mouseTracking.current.calPoints[1].scale;
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

  const drawContent = () => {
    updateImageHelpers();
    drawContentDebounced();
  };

  useEffect(() => {
    // Make note of basic underlying scale
    console.log(`canvas dims: ${width}x${height}`);
    console.log(`image dims: ${image.width}x${image.height}`);
    const scaleX = width / image.width;
    const scaleY = height / image.height;
    imageToCanvasScale.current = Math.min(scaleX, scaleY);
    console.log(`imageToCanvasScale: ${imageToCanvasScale.current}`);

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

    const { calPoints } = mouseTracking.current;
    let calPoint = calPoints[1];
    if (Math.abs(mousePositionX - calPoints[1].px) < 30) {
      // close to point 1, replace it
    } else {
      calPoints[0] = { ...calPoints[1] }; // shift and replace
    }

    calPoint.ts = image.timestamp;
    calPoint.px = mousePositionX;
    calPoint.scale = mouseTracking.current.scale;
    if (calPoints[0].ts && calPoints[1].ts) {
      let { pt1, pt2 } = getVideoSettings().guides[0];
      const zoomWindow = mouseTracking.current.zoomWindow;
      const finyPct = (zoomWindow.y + zoomWindow.height / 2) / image.height;
      const finx = (destWidth / image.width) * (pt1 + (pt2 - pt1) * finyPct);
      const deltaT = calPoints[1].ts - calPoints[0].ts;
      const deltaPx =
        calPoints[1].px * calPoints[1].scale -
        calPoints[0].px * calPoints[0].scale;
      const t = Math.round(
        calPoints[0].ts +
          ((-(calPoints[0].px - finx) * calPoints[0].scale) / deltaPx) * deltaT
      );

      // setToast({
      //   severity: 'info',
      //   msg: `px=${calPoints[1].px - calPoints[0].px}, dt=${deltaT}, t=${t}`,
      // });
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
    resetVideoZoom();
  };

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (event.button != 0) {
        return;
      }
      selectLane(event);
      mouseTracking.current.mouseDownClientY = event.clientY;
      mouseTracking.current.mouseDownClientX = event.clientX;
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

      if (!mouseTracking.current.isZooming) {
        doZoom(5);
      }
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
      // const newWidth = image.width / zoomFactor;
      const newHeight = image.height / zoomFactor;
      const newWidth = Math.max(
        image.width / zoomFactor,
        ((1 / imageToCanvasScale.current) * width) / zoomFactor
      );
      console.log(`image size: ${image.width}x${image.height}`);
      console.log(`canvas size: ${width}x${height}`);
      console.log(`imageToCanvasScale: ${imageToCanvasScale.current}`);
      console.log(
        `newWidth=Math.max(${image.width / zoomFactor}, ${
          ((1 / imageToCanvasScale.current) * width) / zoomFactor
        }), newHeight=${newHeight}, `
      );

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
      mouseTracking.current.calPoints[0].ts = 0;
      mouseTracking.current.calPoints[1].ts = 0;
      mouseTracking.current.isZooming = true;

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
      if (mouseTracking.current.mouseDown) {
        let downMoveX = mouseTracking.current.mouseDownClientX - event.clientX;
        // Only start tracking if we have moved a significant amount
        if (mouseTracking.current.isZooming && Math.abs(downMoveX) > 10) {
          const delta = Math.sign(downMoveX);
          mouseTracking.current.mouseDownClientX = event.clientX;
          moveToFrame(getVideoFrameNum(), travelRightToLeft ? delta : -delta);
        }
      }
    },
    [image, destHeight, destWidth]
  );
  console.log(
    `frame: ${getVideoFrameNum()}, motion: ${JSON.stringify(image.motion)} ${
      image.width
    }x${image.height}`
  );

  useEffect(() => {
    doZoom(1);
    // Trigger a reload of this frame as we exit zoom
    const frameNum = getVideoFrameNum();
    const intFrame = Math.trunc(frameNum);
    moveToFrame(intFrame, frameNum - intFrame);
  }, [resetZoomCount]);

  const handleMouseUp = useCallback(
    (_event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      mouseTracking.current.mouseDown = false;

      // if (event.button != 0) {
      //   return;
      // }
      // event.preventDefault();
      // doZoom(1);
      // // Trigger a reload of this frame as we exit zoom
      // const frameNum = getVideoFrameNum();
      // const intFrame = Math.trunc(frameNum);
      // moveToFrame(intFrame, frameNum - intFrame);
    },
    [image]
  );

  // useEffect(() => {
  //   window.addEventListener('mouseup', handleMouseUp);
  //   // Cleanup the mouseup listener on unmount
  //   return () => {
  //     window.removeEventListener('mouseup', handleMouseUp);
  //   };
  // }, [handleMouseUp]);

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
            event.deltaY / getMouseWheelFactor() / mouseTracking.current.scale
          )
        )
      );
    if (!mouseTracking.current.isZooming && Math.abs(delta) > 3) {
      delta = Math.sign(delta) * 3;
    }
    console.log('delta', delta);
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
        onMouseMove={adjustingOverlay ? undefined : handleMouseMove}
        onMouseUp={adjustingOverlay ? undefined : handleMouseUp}
        onMouseLeave={adjustingOverlay ? undefined : () => setNearEdge(false)}
        onDragStart={adjustingOverlay ? undefined : handleDragStart}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleRightClick}
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
            {/* <Typography
              onClick={
                holdoffChanges.current
                  ? undefined
                  : travelRightToLeft
                  ? moveRight
                  : moveLeft
              }
              className={classes.text}
            >
              &nbsp;&lt;&nbsp;
            </Typography> */}
            {hyperZoom && <Box className={classes.hyperpadding} />}
            <Typography className={classes.tstext}>{videoTimestamp}</Typography>
            {hyperZoom && (
              <Tooltip title="Hyperzoom generated timestamp">
                <ZoomInIcon className={classes.hyperzoom} />
              </Tooltip>
            )}
            {/* <Typography
              onClick={
                holdoffChanges.current
                  ? undefined
                  : travelRightToLeft
                  ? moveLeft
                  : moveRight
              }
              className={classes.text}
            >
              &nbsp;&gt;&nbsp;
            </Typography> */}
            <div style={{ flex: 1 }} />
          </Stack>
          {computedTime
            ? mouseTracking.current.calPoints[0].ts &&
              mouseTracking.current.calPoints[1].ts && (
                <Typography
                  className={classes.computedtext}
                  align="center"
                  onClick={() => storeComputedTime(computedTime)}
                >
                  {convertTimestampToString(computedTime, timezoneOffset)}
                </Typography>
              )
            : null}
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
        <VideoOverlay
          ref={videoOverlayRef}
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
  const videoSidebarWidth = 170; // enough for '20240308_123248.mp4'
  const timingSidebarwidth = 300;
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
