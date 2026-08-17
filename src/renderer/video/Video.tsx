import { Box, Typography, Stack, Tooltip, Button } from '@mui/material';
import { alpha } from '@mui/material/styles';
import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDebouncedCallback } from 'use-debounce';
import makeStyles from '@mui/styles/makeStyles';
import _Measure, { ContentRect, MeasureProps } from 'react-measure';
import { UseDatum } from 'react-usedatum';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import { convertTimestampToString } from '../shared/Util';
import VideoSideBar from './VideoSideBar';
import {
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoSettings,
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
  getImage,
  getVideoBow,
  setAnnotatedBow,
  setVideoBow,
  useVideoBow,
  completeVideoZoomReset,
  useBowSeekPending,
  getVideoEvent,
} from './VideoSettings';
import VideoOverlay, {
  getNearEdge,
  useOverlayActive,
  VideoOverlayHandles,
} from './VideoOverlay';
import TimingSidebar from './TimingSidebar';
import {
  downloadCanvasImage,
  downloadImageFromCanvasLayers,
  getFinishLine,
  moveLeft,
  moveRight,
  moveToFrame,
  translateMouseEventCoords,
} from './VideoUtils';
import FileScrubber from './FileScrubber';
import { setGenerateImageSnapshotCallback } from './ImageButton';
import VideoScrubber from './VideoScrubber';
import { performAddSplit } from './AddSplitUtil';
import Blowup from './Blowup';
import { updateVideoScaling } from '../util/ImageScaling';
import {
  performAutoZoomSeek,
  videoRequestQueueRunning,
} from './RequestVideoFrame';
import { useSingleAndDoubleClick } from '../util/UseSingleAndDoubleClick';
import type { BowDetection, Rect } from '../shared/AppTypes';
import {
  getAutoZoomToFinish,
  getWaypoint,
  useLabelBoats,
  useLabelCardsWithoutBoat,
} from '../util/UseSettings';
import { getEntryResult } from '../util/LapStorageDatum';
import { gateFromWaypoint, timeToMilli } from '../util/Util';
import {
  adjustInterpolatedBoatDetection,
  autoZoomToFinish,
  extendAutoZoomInterpolation,
  getCachedAutoZoomDetections,
  getInterpolatedBowDetections,
  hasAutoZoomInterpolation,
  hasAutoZoomInterpolationAtFrame,
  restoreMissingCardDetections,
} from './AutoZoomToFinish';

// Avoid 'not a JSX component' warning
const Measure = _Measure as unknown as FC<MeasureProps>;

type BowLabelHitRegion = {
  box: Rect;
  value: string;
};

const drawBowDetections = (
  ctx: CanvasRenderingContext2D,
  detections: BowDetection[],
  currentBow: string,
  travelRightToLeft: boolean,
) => {
  const hitRegions: BowLabelHitRegion[] = [];
  const zoomedIn = getVideoScaling().zoomY !== 1;
  detections.forEach((detection) => {
    const { boatBox, box } = detection;
    if (boatBox.width > 0 && boatBox.height > 0) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 255, 76, 0.25)';
      ctx.beginPath();
      ctx.moveTo(boatBox.x, boatBox.y);
      ctx.lineTo(boatBox.x + boatBox.width, boatBox.y);
      ctx.moveTo(boatBox.x, boatBox.y + boatBox.height);
      ctx.lineTo(boatBox.x + boatBox.width, boatBox.y + boatBox.height);
      ctx.stroke();

      if (!zoomedIn) {
        ctx.strokeStyle = 'rgba(0, 255, 76, 0.35)';
        ctx.beginPath();
        ctx.moveTo(boatBox.x, boatBox.y);
        ctx.lineTo(boatBox.x, boatBox.y + boatBox.height);
        ctx.moveTo(boatBox.x + boatBox.width, boatBox.y);
        ctx.lineTo(boatBox.x + boatBox.width, boatBox.y + boatBox.height);
        ctx.stroke();
      }
    }
    if (box.width > 0 && box.height > 0) {
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
    }
  });

  // Draw labels after every bounding box so overlapping boat/card outlines
  // cannot cover the annotation panel.
  detections.forEach((detection) => {
    const { box } = detection;
    const scaling = getVideoScaling();
    const screenScaleX = Math.max(0.001, Math.abs(scaling.scaleX));
    const screenScaleY = Math.max(0.001, Math.abs(scaling.scaleY));
    const fontSize = Math.max(14, 14 / screenScaleY);
    ctx.font = `bold ${fontSize}px sans-serif`;
    if (detection.text && box.width > 0 && box.height > 0) {
      const number = detection.text;
      const labelWidth = Math.max(
        box.width + 4,
        ctx.measureText(number).width + 12,
      );
      const panelWidth = labelWidth + 12;
      const panelHeight = Math.max(box.height, 20, 20 / screenScaleY);
      let panelX = travelRightToLeft
        ? box.x + box.width + 6
        : box.x - panelWidth - 6;
      let panelY = box.y + box.height / 2 - panelHeight / 2;
      if (zoomedIn) {
        const visibleLeft = -scaling.destX / screenScaleX;
        const visibleRight = (ctx.canvas.width - scaling.destX) / screenScaleX;
        const visibleTop = -scaling.destY / screenScaleY;
        const visibleBottom =
          (ctx.canvas.height - scaling.destY) / screenScaleY;
        const annotationClipped =
          panelX < visibleLeft ||
          panelX + panelWidth > visibleRight ||
          panelY < visibleTop ||
          panelY + panelHeight > visibleBottom;
        if (annotationClipped) {
          const edgeInset = 2 / screenScaleX;
          const verticalGap = 4 / screenScaleY;
          panelX = travelRightToLeft
            ? visibleRight - panelWidth - edgeInset
            : visibleLeft + edgeInset;
          panelY = box.y - panelHeight - verticalGap;
          panelX = Math.max(
            visibleLeft,
            Math.min(visibleRight - panelWidth, panelX),
          );
          panelY = Math.max(
            visibleTop,
            Math.min(visibleBottom - panelHeight, panelY),
          );
        }
      }
      const labelX = panelX + panelWidth / 2;
      const numberY = panelY + Math.max(14, 14 / screenScaleY);
      const barX = panelX + 6;
      const barY = numberY + Math.max(2, 2 / screenScaleY);
      const barHeight = Math.max(3, 3 / screenScaleY);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
      ctx.fillStyle = currentBow === number ? '#ffffff' : '#ff3b30';
      ctx.textAlign = 'center';
      ctx.fillText(number, labelX, numberY);
      hitRegions.push({
        box: {
          x: panelX,
          y: panelY,
          width: panelWidth,
          height: panelHeight,
        },
        value: number,
      });
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(barX, barY, labelWidth, barHeight);
      const confidence = Math.max(0, Math.min(1, detection.confidence));
      ctx.fillStyle = `hsl(${confidence * 120}, 90%, 45%)`;
      ctx.fillRect(barX, barY, labelWidth * confidence, barHeight);
      ctx.textAlign = 'start';
    }
  });
  return hitRegions;
};

const selectFinishAnnotation = (
  detections: BowDetection[],
  imageWidth: number,
) => {
  const finish = getFinishLine();
  const finishX = imageWidth / 2 + (finish.pt1 + finish.pt2) / 2;
  return detections
    .filter(({ text, boatBox }) => text && boatBox.width > 0)
    .sort((first, second) => {
      const edgeDistance = ({ boatBox }: BowDetection) =>
        Math.min(
          Math.abs(boatBox.x - finishX),
          Math.abs(boatBox.x + boatBox.width - finishX),
        );
      return edgeDistance(first) - edgeDistance(second);
    })[0]?.text;
};

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

const applyZoom = ({
  srcPoint,
  zoom,
  srcClickPoint,
}: {
  srcPoint: Point;
  srcClickPoint?: Point;
  zoom: number;
}) => {
  const vScaling = getVideoScaling();
  const autoZoomed = zoom === 1 ? false : vScaling.autoZoomed;

  updateVideoScaling({
    zoomY: zoom,
    srcCenterPoint:
      zoom === 1
        ? { x: vScaling.srcWidth / 2, y: vScaling.srcHeight / 2 }
        : srcPoint,
    srcClickPoint,
    autoZoomed,
  });
  if (zoom > 1) {
    moveToFrame(getVideoFrameNum(), 0, true);
  }
};

const isZooming = () => getVideoScaling().zoomY !== 1;

const clearZoom = () => {
  updateVideoScaling({
    zoomX: 1,
    zoomY: 1,
    srcCenterPoint: getVideoScaling().srcCenterPoint,
    autoZoomed: false,
  });
};

interface MouseState {
  mouseDownClientX: number;
  mouseDownClientY: number;
  mouseDown: boolean | undefined;
  imageLoaded: boolean;
}

let playIntervalTimer: NodeJS.Timeout | undefined;
const playVideo = (dumpWhenFinished: boolean) => {
  const history: [number, number][] = [];
  const dumpResults = () => {
    if (!dumpWhenFinished) {
      return;
    }
    console.log(history.map((item) => item.join(',')).join('\n'));
  };
  if (playIntervalTimer) {
    clearInterval(playIntervalTimer);
    playIntervalTimer = undefined;
    dumpResults();
    return;
  }

  let lastImage = getImage();
  playIntervalTimer = setInterval(() => {
    const image = getImage();
    if (image !== lastImage) {
      const delta = image.timestamp - lastImage.timestamp;
      // console.log(`${image.frameNum}, ${delta}`);
      history.push([image.frameNum, delta]);
      lastImage = image;
    }
    if (image.frameNum >= image.numFrames) {
      clearInterval(playIntervalTimer);
      playIntervalTimer = undefined;
      dumpResults();
    }

    if (!videoRequestQueueRunning()) {
      moveRight();
    }
  }, 10);
};

// Setting the window.removeEventListener in a useEffect for some reason ended up
// with multiple callback calls.  As a workaround, try using a global variable to
// gate the functions actions.
let videoVisible = false;
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!videoVisible) {
    return;
  }
  switch (event.key) {
    case 'P':
      playVideo(true);
      break;
    case 'p':
      playVideo(false);
      break;
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
    case 'z':
    case 'Z':
    case '/':
    case 'Escape':
      resetVideoZoom();
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

export const VideoBow: FC = () => {
  const [videoBow] = useVideoBow();
  if (!videoBow) {
    return null;
  }
  return (
    <Box
      role="button"
      tabIndex={0}
      sx={{
        zIndex: 400,
        mt: '0.5em',
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-end',
        justifyContent: 'center',
        width: 'auto',
        minWidth: '40px',
        maxWidth: '80px',
        height: 28,
        px: '8px',
        border: '1px solid white',
        borderRadius: 1,
        backgroundColor: (theme) => {
          return alpha(theme.palette.primary.main, 0.4);
        },
        color: 'primary.contrastText',
        userSelect: 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <Typography sx={{ fontSize: 13, lineHeight: '1.2' }}>
        {videoBow}
      </Typography>
    </Box>
  );
};

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
  const [showFloatingBow, setShowFloatingBow] = useState(false);
  const [floatingBowPos, setFloatingBowPos] = useState<Point>({ x: 0, y: 0 });
  const [showBlowup] = useShowBlowup();
  const [videoScaling] = useVideoScaling();
  const [labelBoats] = useLabelBoats();
  const [labelCardsWithoutBoat] = useLabelCardsWithoutBoat();
  const [videoBow] = useVideoBow();
  const [bowSeekPending] = useBowSeekPending();
  const [bowDetections, setBowDetections] = useState<BowDetection[]>([]);
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
  const bowDetectionRequestId = useRef(0);
  const bowDetectionVideoFile = useRef('');
  const bowDetectionsFrame = useRef(Number.NaN);
  const bowLabelHitRegions = useRef<BowLabelHitRegion[]>([]);
  const holdCanvasDuringZoomReset = useRef(false);
  const [holdOverlayDuringZoomReset, setHoldOverlayDuringZoomReset] =
    useState(false);

  const videoTimestamp = convertTimestampToString(
    image.timestamp,
    image.tzOffset,
  );

  useEffect(() => {
    console.log(
      `frame ${image.frameNum}/${image.numFrames}, ${videoTimestamp} ts=${image.timestamp}`,
    );
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

      // Cover the early version watermark timestamp
      // drawText(
      //   ctx,
      //   '                  CrewTimer Regatta Timing                   ',
      //   16,
      //   30,
      //   32,
      //   'below',
      //   'left',
      //   '#ccc',
      // );

      mouseTracking.current.imageLoaded = true;
    } else {
      mouseTracking.current.imageLoaded = false;
    }
  }, [image, videoTimestamp]);

  const drawContentDebounced = useDebouncedCallback(() => {
    if (holdCanvasDuringZoomReset.current) {
      return;
    }
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
          const useTrackedInterpolation =
            hasAutoZoomInterpolation(image.file) &&
            (isZooming() ||
              hasAutoZoomInterpolationAtFrame(image.file, image.frameNum));
          const visibleBowDetections = bowSeekPending
            ? []
            : useTrackedInterpolation
              ? adjustInterpolatedBoatDetection(
                  image.file,
                  image.frameNum,
                  bowDetections,
                )
              : Math.abs(bowDetectionsFrame.current - image.frameNum) <= 0.01
                ? bowDetections
                : [];
          bowLabelHitRegions.current = drawBowDetections(
            ctx,
            visibleBowDetections,
            videoBow,
            travelRightToLeft,
          );
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

  const labelBoatsDebounced = useDebouncedCallback(
    async (videoFileName: string, frameNum: number, requestId: number) => {
      const detectionStarted = performance.now();
      try {
        const requestIsCurrent =
          getImage().file === videoFileName &&
          Math.abs(getVideoFrameNum() - frameNum) <= 0.01;
        const interpolationExtended =
          isZooming() && requestIsCurrent
            ? await extendAutoZoomInterpolation(videoFileName, frameNum)
            : false;
        if (
          interpolationExtended &&
          requestId === bowDetectionRequestId.current
        ) {
          setBowDetections((current) => [...current]);
        }
        const interpolatedDetections = labelCardsWithoutBoat
          ? undefined
          : await getInterpolatedBowDetections(videoFileName, frameNum);
        let detections: BowDetection[];
        if (interpolatedDetections) {
          detections = interpolatedDetections;
        } else {
          const result = await window.VideoUtils.detectBow({
            videoFile: videoFileName,
            frameNum,
            detectCardsWithoutBoat: labelCardsWithoutBoat,
          });
          const cachedResult = await getCachedAutoZoomDetections(
            videoFileName,
            frameNum,
          )?.catch(() => undefined);
          detections = cachedResult
            ? restoreMissingCardDetections(
                result.detections,
                cachedResult.detections,
              )
            : result.detections;
        }
        const detectionMs = performance.now() - detectionStarted;
        const cardCount = detections.filter(
          ({ box }) => box.width > 0 && box.height > 0,
        ).length;
        console.log(
          `Bow detection frame=${frameNum} detections=${detections.length} cards=${cardCount} ` +
            `fallback=${labelCardsWithoutBoat} elapsed=${detectionMs.toFixed(1)}ms`,
        );
        if (requestId === bowDetectionRequestId.current) {
          // The native decoder may report the nearby decoded source frame for
          // a scrubber seek. The request id proves this result belongs to the
          // currently displayed request, so associate it with that requested
          // position rather than hiding it due to a small frame discrepancy.
          bowDetectionsFrame.current = frameNum;
          setBowDetections(detections);
          setAnnotatedBow(
            selectFinishAnnotation(detections, getImage().width) || '',
          );
        }
      } catch (error) {
        const detectionMs = performance.now() - detectionStarted;
        console.error(
          `Bow detection failed frame=${frameNum} ` +
            `elapsed=${detectionMs.toFixed(1)}ms`,
        );
        if (requestId === bowDetectionRequestId.current) {
          if (!hasAutoZoomInterpolation(videoFileName)) {
            bowDetectionsFrame.current = Number.NaN;
            setBowDetections([]);
            setAnnotatedBow('');
          }
          console.error('Unable to label boats', error);
        }
      }
    },
    500,
  );

  useEffect(() => {
    const requestId = bowDetectionRequestId.current + 1;
    bowDetectionRequestId.current = requestId;
    labelBoatsDebounced.cancel();

    if (labelBoats && image.file && image.width > 0 && image.height > 0) {
      if (
        !isZooming() &&
        !hasAutoZoomInterpolationAtFrame(image.file, image.frameNum)
      ) {
        bowDetectionsFrame.current = Number.NaN;
        setBowDetections([]);
        setAnnotatedBow('');
      }
      if (bowDetectionVideoFile.current !== image.file) {
        bowDetectionVideoFile.current = image.file;
        bowDetectionsFrame.current = Number.NaN;
        setBowDetections([]);
        setAnnotatedBow('');
      }
      labelBoatsDebounced(image.file, image.frameNum, requestId);
      if (isZooming()) {
        labelBoatsDebounced.flush();
      }
    } else {
      bowDetectionVideoFile.current = '';
      bowDetectionsFrame.current = Number.NaN;
      setBowDetections([]);
      setAnnotatedBow('');
    }

    return () => labelBoatsDebounced.cancel();
  }, [
    image,
    image.file,
    image.frameNum,
    image.height,
    image.width,
    videoScaling.zoomY,
    labelBoats,
    labelCardsWithoutBoat,
    labelBoatsDebounced,
  ]);

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
    bowDetections,
    bowSeekPending,
    videoBow,
    travelRightToLeft,
  ]);

  useEffect(() => {
    // A bit of a hack but set a global callback function instead of passing it down the tree
    // May not be needed now that videoScaling is a global
    setGenerateImageSnapshotCallback((rawFrame) => {
      if (rawFrame) {
        downloadCanvasImage(
          offscreenCanvas.current,
          `Image_${videoTimestamp}_raw.png`,
        );
        return;
      }
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

  const videoOverlay = useMemo(
    () => (
      <VideoOverlay
        ref={videoOverlayRef}
        width={width}
        height={height}
        suspendDraw={holdOverlayDuringZoomReset}
      />
    ),
    [width, height, holdOverlayDuringZoomReset],
  );

  const handleDragStart = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
  ) => {
    event.preventDefault();
  };

  const handleSingleClick = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
  ) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const { pt: srcCoords, withinBounds } = translateMouseEventCoords(
      event,
      rect,
    );
    if (withinBounds) {
      const clickedLabel = bowLabelHitRegions.current.find(
        ({ box }) =>
          srcCoords.x >= box.x &&
          srcCoords.x <= box.x + box.width &&
          srcCoords.y >= box.y &&
          srcCoords.y <= box.y + box.height,
      );
      if (clickedLabel) {
        setAnnotatedBow(clickedLabel.value);
        setVideoBow(clickedLabel.value);
        event.preventDefault();
        return;
      }
    }

    const videoSettings = getVideoSettings();
    if (
      (event.shiftKey || getVideoScaling().autoZoomed) &&
      videoSettings.enableAutoZoom &&
      !getNearEdge()
    ) {
      if (!withinBounds) {
        return;
      }
      performAutoZoomSeek(srcCoords);
    }
  };

  const handleDoubleClick = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
  ) => {
    const mousePositionY =
      event.clientY - event.currentTarget.getBoundingClientRect().top;
    if (mousePositionY < 30) {
      event.preventDefault();
      return;
    }
    const mousePositionX =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    if (mousePositionX < 30) {
      event.preventDefault();
      return;
    }

    const autoZoomRequested =
      getVideoSettings().enableAutoZoom && event.shiftKey;
    if (!isZooming() || autoZoomRequested) {
      const finish = getFinishLine();
      const rect = canvasRef.current?.getBoundingClientRect();

      const { pt: srcCoords, withinBounds } = translateMouseEventCoords(
        event,
        rect,
      );
      if (!withinBounds) {
        return;
      }

      const applyNormalDoubleClickZoom = () => {
        applyZoom({
          zoom: 5,
          srcPoint: {
            x: getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2,
            y: srcCoords.y,
          },
          srcClickPoint: srcCoords,
        });
      };

      const currentBow = getVideoBow();
      const currentEvent = getVideoEvent();
      const recordedLap =
        currentBow && currentBow !== '?' && currentEvent
          ? getEntryResult(
              `${gateFromWaypoint(getWaypoint())}_${currentEvent}_${currentBow}`,
            )
          : undefined;
      const atRecordedBowTime = !!(
        recordedLap?.Time &&
        recordedLap.State !== 'Deleted' &&
        timeToMilli(recordedLap.Time) === timeToMilli(videoTimestamp)
      );

      if (atRecordedBowTime) {
        applyNormalDoubleClickZoom();
      } else if (getAutoZoomToFinish() && !isZooming()) {
        autoZoomToFinish(srcCoords)
          .then((result) => {
            if (!result) {
              applyNormalDoubleClickZoom();
              return undefined;
            }
            if (getVideoBow() !== '' && getVideoBow() !== '?') {
              return undefined;
            }
            const bow = result.bow.trim();
            const supportingFrames = result.observations.filter(
              ({ detection }) => detection.text === bow,
            ).length;
            const bowNumber = Number(bow);
            if (
              /^\d{1,3}$/.test(bow) &&
              bowNumber >= 1 &&
              bowNumber <= 999 &&
              supportingFrames >= 2
            ) {
              setVideoBow(bow);
            }
            return undefined;
          })
          .catch((error) => {
            console.error('Auto Zoom to Finish failed', error);
            applyNormalDoubleClickZoom();
          });
      } else if (autoZoomRequested) {
        performAutoZoomSeek(srcCoords);
      } else {
        applyNormalDoubleClickZoom();
      }
    } else {
      resetVideoZoom();
    }
  };

  const { onSingleClick, onDoubleClick } = useSingleAndDoubleClick(
    handleSingleClick,
    handleDoubleClick,
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (event.button !== 0) {
        return;
      }
      setShowBlowup(false);

      const rect = canvasRef.current?.getBoundingClientRect();

      const { x, y, withinBounds } = translateMouseEventCoords(event, rect);
      if (!withinBounds) {
        return;
      }

      mouseTracking.current.mouseDown = true;
      mouseTracking.current.mouseDownClientX = x;
      mouseTracking.current.mouseDownClientY = y;
    },
    [],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const { x, y, pt: srcCoords } = translateMouseEventCoords(event, rect);

      setShowBlowup(event.shiftKey && !getNearEdge());
      if (event.shiftKey) {
        setMousePos({ x, y });
        setSrcPos(srcCoords);
      }

      // Update floating VideoBow position: 30px below the pointer
      if (rect) {
        setFloatingBowPos({ x, y: y + 30 });
        setShowFloatingBow(true);
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
    if (isZooming()) {
      // Keep the zoomed canvas visible while the slower full-view RIFE frame
      // is generated. Redrawing the previous crop at zoom 1 briefly exposes
      // its raw base frame before the replacement arrives.
      holdCanvasDuringZoomReset.current = true;
      setHoldOverlayDuringZoomReset(true);
      clearZoom();
      Promise.resolve(moveToFrame(getVideoFrameNum(), undefined, false))
        .finally(() => {
          holdCanvasDuringZoomReset.current = false;
          drawContentDebounced();
          drawContentDebounced.flush();
          requestAnimationFrame(() => {
            setHoldOverlayDuringZoomReset(false);
            completeVideoZoomReset();
          });
        })
        .catch((error) => {
          console.error('Unable to refresh frame after zoom reset', error);
        });
    } else {
      completeVideoZoomReset();
    }
  }, [drawContentDebounced, resetZoomCount]);

  const handleMouseLeave = () => {
    setShowBlowup(false);
    setShowFloatingBow(false);
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
        onDoubleClick={onDoubleClick}
        onClick={onSingleClick}
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
          position: 'relative',
          // cursor: showBlowup ? 'none' : 'auto',
        }}
      >
        <Stack
          direction="column"
          sx={{
            width: `${width}px`,
            alignItems: 'end',
            paddingTop: '5px',
            paddingRight: '5px',
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
              {
                paddingRight: `${Math.trunc((width - image.width * videoScaling.scaleX) / 2)}px`,
              }
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
            <Stack>
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
                  onClick={(
                    event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
                  ) => {
                    let { zoomX } = getVideoScaling();
                    if (zoomX >= 16) {
                      zoomX = 1;
                    } else {
                      zoomX *= 2;
                    }
                    updateVideoScaling({ zoomX });
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  {scaleText}
                </Button>
              </Tooltip>
              <VideoBow />
            </Stack>
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
        {/* Floating VideoBow that follows the mouse pointer (30px below) */}
        {showFloatingBow && (
          <Box
            sx={{
              position: 'absolute',
              left: `${floatingBowPos.x}px`,
              top: `${floatingBowPos.y}px`,
              transform: 'none',
              pointerEvents: 'none', // don't block mouse interactions
              zIndex: 500,
            }}
          >
            <VideoBow />
          </Box>
        )}
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
  const [top, setTop] = useState(180);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const videoSidebarWidth = 150; // enough for '20240308_123248.mp4'
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
    return () => {
      win.removeEventListener('resize', onResize, false);
    };
  }, [onResize]);
  const width = winWidth;
  const height = Math.max(winHeight - top, 1);

  const handleResize = useCallback((contentRect: ContentRect) => {
    if (!contentRect.bounds) {
      return;
    }
    const nextTop = contentRect.bounds.top;
    if (resizeFrameRef.current !== undefined) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    // Avoid changing layout synchronously from inside ResizeObserver delivery.
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = undefined;
      setTop((currentTop) =>
        Math.abs(currentTop - nextTop) < 0.5 ? currentTop : nextTop,
      );
    });
  }, []);

  useEffect(
    () => () => {
      if (resizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

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
