import { Box, Typography, Stack, Tooltip, Button, Paper } from '@mui/material';
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
  setVideoTimestamp,
  useResetZoomCounter,
  useImage,
  useTravelRightToLeft,
  useVideoError,
  useVideoFile,
  resetVideoZoom,
  consumeZoomPreservedFile,
  getVideoScaling,
  Point,
  VideoScaling,
  useVideoScaling,
  getImage,
  getVideoBow,
  getVideoBowUuid,
  setAnnotatedBow,
  setVideoBow,
  useVideoBow,
  completeVideoZoomReset,
  useBowSeekPending,
  getVideoEvent,
  getCourseArea,
  useVideoSettings,
  getZoomTransform,
  useZoomTransform,
  getGuideHighlight,
  useGuideHighlight,
  ZOOM_TRANSFORM_MIN_ZOOM,
} from './VideoSettings';
import {
  applyZoomTransform,
  clampRect,
  guideNonWaterSpans,
  RowSpan,
} from './ZoomTransform';
import ZoomTransformButton from './ZoomTransformButton';
import VideoOverlay, {
  getNearEdge,
  useOverlayActive,
  VideoOverlayHandles,
} from './VideoOverlay';
import TimingSidebar from './TimingSidebar';
import {
  combineCanvasLayers,
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
import { videoRequestQueueRunning } from './RequestVideoFrame';
import { useSingleAndDoubleClick } from '../util/UseSingleAndDoubleClick';
import type { AppImage, BowDetection, Rect } from '../shared/AppTypes';
import {
  getZoomToTimingGuide,
  getBowDetectionOptions,
  getLabelNumbers,
  normalizeBowForCurrentEvent,
  selectEventForBow,
  getWaypoint,
  useLabelBoats,
  useLabelCardsWithoutBoat,
  useLabelNumbers,
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
  omitOverlappingBoatDetections,
  restoreMissingCardDetections,
  detectBoatNearPoint,
  isRecordedBoatSelection,
} from './AutoZoomToFinish';
import { getFileStatusByName } from './VideoFileStatus';
import {
  retainedRollingShutterOffsetMs,
  rollingShutterOffsetMs,
  type RetainedRollingShutterCorrection,
} from './RollingShutter';
import type { VideoSidecar } from './VideoSettings';
import { setDisplayedTimestampImage } from './LapImage';
import {
  filterToCourseArea,
  selectBowCardNearestPoint,
} from './BowDetectionSelection';

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
  const scaling = getVideoScaling();
  const zoomedIn = scaling.zoomY !== 1;
  const screenScaleX = Math.max(0.001, Math.abs(scaling.scaleX));
  const screenScaleY = Math.max(0.001, Math.abs(scaling.scaleY));
  const visibleBounds = {
    left: -scaling.destX / screenScaleX,
    right: (ctx.canvas.clientWidth - scaling.destX) / screenScaleX,
    top: -scaling.destY / screenScaleY,
    bottom: (ctx.canvas.clientHeight - scaling.destY) / screenScaleY,
  };
  detections.forEach((detection) => {
    const { boatBox, box } = detection;
    if (!zoomedIn && boatBox.width > 0 && boatBox.height > 0) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 255, 76, 0.25)';
      ctx.beginPath();
      ctx.moveTo(boatBox.x, boatBox.y);
      ctx.lineTo(boatBox.x + boatBox.width, boatBox.y);
      ctx.moveTo(boatBox.x, boatBox.y + boatBox.height);
      ctx.lineTo(boatBox.x + boatBox.width, boatBox.y + boatBox.height);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(0, 255, 76, 0.35)';
      ctx.beginPath();
      ctx.moveTo(boatBox.x, boatBox.y);
      ctx.lineTo(boatBox.x, boatBox.y + boatBox.height);
      ctx.moveTo(boatBox.x + boatBox.width, boatBox.y);
      ctx.lineTo(boatBox.x + boatBox.width, boatBox.y + boatBox.height);
      ctx.stroke();
    }
    if (box.width > 0 && box.height > 0) {
      // Always on the card itself, even when it scrolls out of view; only the
      // number panel below keeps itself on screen.
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
    }
  });

  // Draw labels after every bounding box so overlapping boat/card outlines
  // cannot cover the annotation panel.
  detections.forEach((detection) => {
    const detectedCardBox = detection.box;
    const hasCardBox = detectedCardBox.width > 0 && detectedCardBox.height > 0;
    const fallbackWidth = Math.max(1, Math.ceil(detection.boatBox.width / 3));
    const fallbackDisplayWidth = zoomedIn
      ? Math.min(fallbackWidth, 96 / screenScaleX)
      : fallbackWidth;
    const fallbackDisplayHeight = zoomedIn
      ? Math.min(detection.boatBox.height, 48 / screenScaleY)
      : detection.boatBox.height;
    // A no-card OCR result has an empty card box. Anchor its label to the
    // leading end third of the boat instead, matching the regions OCR searched.
    // Keep that synthetic anchor compact while zoomed so a tall/wide boat box
    // cannot turn the annotation into an oversized panel.
    const box = hasCardBox
      ? detectedCardBox
      : {
          x: travelRightToLeft
            ? detection.boatBox.x
            : detection.boatBox.x +
              detection.boatBox.width -
              fallbackDisplayWidth,
          y:
            detection.boatBox.y +
            (detection.boatBox.height - fallbackDisplayHeight) / 2,
          width: fallbackDisplayWidth,
          height: fallbackDisplayHeight,
        };
    const fontSize =
      zoomedIn && !hasCardBox
        ? 14 / screenScaleY
        : Math.max(14, 14 / screenScaleY);
    ctx.font = `bold ${fontSize}px sans-serif`;
    if (detection.text && box.width > 0 && box.height > 0) {
      const number = detection.text;
      const panelWidth = Math.max(
        box.width,
        ctx.measureText(number).width + 10 / screenScaleX,
      );
      const panelHeight =
        zoomedIn && !hasCardBox
          ? Math.max(box.height, 20 / screenScaleY)
          : Math.max(box.height, 20, 20 / screenScaleY);
      let panelX = travelRightToLeft
        ? box.x + box.width + 6
        : box.x - panelWidth - 6;
      let panelY = box.y + box.height / 2 - panelHeight / 2;
      if (zoomedIn) {
        const annotationClipped =
          panelX < visibleBounds.left ||
          panelX + panelWidth > visibleBounds.right ||
          panelY < visibleBounds.top ||
          panelY + panelHeight > visibleBounds.bottom;
        if (annotationClipped) {
          const edgeInset = 2 / screenScaleX;
          const verticalGap = 4 / screenScaleY;
          panelX = travelRightToLeft
            ? visibleBounds.right - panelWidth - edgeInset
            : visibleBounds.left + edgeInset;
          panelY = box.y - panelHeight - verticalGap;
          panelX = Math.max(
            visibleBounds.left,
            Math.min(visibleBounds.right - panelWidth, panelX),
          );
          panelY = Math.max(
            visibleBounds.top,
            Math.min(visibleBounds.bottom - panelHeight, panelY),
          );
        }
      }
      const labelX = panelX + panelWidth / 2;
      const barInset = 2 / screenScaleX;
      const barX = panelX + barInset;
      const barWidth = Math.max(0, panelWidth - barInset * 2);
      const barHeight = Math.max(3, 3 / screenScaleY);
      const contentGap = Math.max(2, 2 / screenScaleY);
      const contentHeight = fontSize + contentGap + barHeight;
      const contentY = panelY + Math.max(0, (panelHeight - contentHeight) / 2);
      const numberY = contentY + fontSize / 2;
      const barY = contentY + fontSize + contentGap;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
      ctx.fillStyle = currentBow === number ? '#ffffff' : '#ff3b30';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
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
      ctx.fillRect(barX, barY, barWidth, barHeight);
      const confidence = Math.max(0, Math.min(1, detection.confidence));
      ctx.fillStyle = `hsl(${confidence * 120}, 90%, 45%)`;
      ctx.fillRect(barX, barY, barWidth * confidence, barHeight);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
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

/** Guide highlight band: screen pixels wide, drawn behind the guide line. */
const GUIDE_HIGHLIGHT_WIDTH = 7;
const GUIDE_HIGHLIGHT_COLOR = '#ff00ffb0';

/** Source rectangle visible in a view of width x height screen pixels. */
const visibleSourceRect = (
  vScaling: VideoScaling,
  viewWidth: number,
  viewHeight: number,
) => ({
  x: Math.floor(-vScaling.destX / vScaling.scaleX),
  y: Math.floor(-vScaling.destY / vScaling.scaleY),
  width: Math.ceil(viewWidth / vScaling.scaleX) + 1,
  height: Math.ceil(viewHeight / vScaling.scaleY) + 1,
});

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
  const containerRef = useRef<HTMLDivElement>(null);
  const clickStartedDrag = useRef(false);
  const mouseDownEvent = useRef<MouseEvent | undefined>(undefined);
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
  const [labelNumbers] = useLabelNumbers();
  const [videoBow] = useVideoBow();
  const [bowSeekPending] = useBowSeekPending();
  const [bowDetections, setBowDetections] = useState<BowDetection[]>([]);
  const [videoSettings] = useVideoSettings();
  // Detection reruns when the course area guides move or are toggled.
  const courseArea = getCourseArea(videoSettings.courseArea);
  const courseAreaKey = courseArea.enabled
    ? `${courseArea.top}-${courseArea.bottom}`
    : '';
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
  // Display-only copy of the frame with the zoom transform applied to the
  // visible area. offscreenCanvas stays raw for detection and snapshots.
  const displayCanvas = useRef(document.createElement('canvas'));
  const displayImage = useRef<AppImage | undefined>(undefined);
  const displayKey = useRef('');
  const [zoomTransform] = useZoomTransform();
  const [guideHighlight] = useGuideHighlight();
  // Timing guide rows unlike the water, cached by frame, view and guide.
  const guideSpans = useRef<{ key: string; spans: RowSpan[] }>({
    key: '',
    spans: [],
  });
  const bowDetectionRequestId = useRef(0);
  const bowDetectionVideoFile = useRef('');
  const bowDetectionsFrame = useRef(Number.NaN);
  const bowLabelHitRegions = useRef<BowLabelHitRegion[]>([]);
  const holdCanvasDuringZoomReset = useRef(false);
  const retainedRollingShutterCorrection = useRef<
    RetainedRollingShutterCorrection | undefined
  >(undefined);
  const [holdOverlayDuringZoomReset, setHoldOverlayDuringZoomReset] =
    useState(false);

  const timestampFinish = getFinishLine();
  const finishX =
    videoScaling.srcWidth / 2 + (timestampFinish.pt1 + timestampFinish.pt2) / 2;
  const liveRollingShutterOffset =
    videoScaling.zoomY > 1
      ? rollingShutterOffsetMs(
          getFileStatusByName(image.file)?.sidecar as VideoSidecar | undefined,
          { x: finishX, y: videoScaling.srcClickPoint.y },
        )
      : undefined;
  const displayedRollingShutterOffset =
    liveRollingShutterOffset ??
    retainedRollingShutterOffsetMs(
      retainedRollingShutterCorrection.current,
      image.file,
      image.frameNum,
    );
  const displayTimestampMs = image.timestamp + displayedRollingShutterOffset;
  const videoTimestamp = convertTimestampToString(
    Math.round(displayTimestampMs),
    image.tzOffset,
  );

  useEffect(() => {
    if (liveRollingShutterOffset !== undefined) {
      retainedRollingShutterCorrection.current = {
        videoFile: image.file,
        frameNum: image.frameNum,
        offsetMs: liveRollingShutterOffset,
      };
    } else if (
      retainedRollingShutterCorrection.current &&
      (retainedRollingShutterCorrection.current.videoFile !== image.file ||
        Math.abs(
          retainedRollingShutterCorrection.current.frameNum - image.frameNum,
        ) > 0.001)
    ) {
      retainedRollingShutterCorrection.current = undefined;
    }
  }, [image.file, image.frameNum, liveRollingShutterOffset]);

  const copyImageToOffscreenCanvas = useCallback((nextImage: AppImage) => {
    displayImage.current = nextImage;
    displayKey.current = '';
    guideSpans.current.key = '';
    offscreenCanvas.current.width = nextImage.width;
    offscreenCanvas.current.height = nextImage.height;
    const ctx = offscreenCanvas.current.getContext('2d');
    if (ctx && nextImage.width) {
      ctx.putImageData(
        new ImageData(
          new Uint8ClampedArray(nextImage.data),
          nextImage.width,
          nextImage.height,
        ),
        0,
        0,
      );
      mouseTracking.current.imageLoaded = true;
    } else {
      mouseTracking.current.imageLoaded = false;
    }
  }, []);

  useEffect(() => {
    console.log(
      `frame ${image.frameNum}/${image.numFrames}, ${videoTimestamp} ts=${image.timestamp}`,
    );
    // Refresh the offscreenCanvas if the image changes
    copyImageToOffscreenCanvas(image);
  }, [copyImageToOffscreenCanvas, image, videoTimestamp]);

  /**
   * Bands behind the timing guide, in source pixels on the scaled context,
   * where the guide crosses something unlike the water. Zoomed in only.
   */
  const drawGuideHighlight = (ctx: CanvasRenderingContext2D) => {
    const vScaling = getVideoScaling();
    const frame = displayImage.current;
    if (
      !getGuideHighlight() ||
      vScaling.zoomY < ZOOM_TRANSFORM_MIN_ZOOM ||
      !frame?.width
    ) {
      return;
    }
    const finish = getFinishLine();
    const xTop = frame.width / 2 + finish.pt1;
    const xBottom = frame.width / 2 + finish.pt2;
    const rect = visibleSourceRect(vScaling, width, height);
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}:${xTop},${xBottom}:${getTravelRightToLeft()}`;
    if (guideSpans.current.key !== key) {
      const { data } = frame;
      guideSpans.current = {
        key,
        spans: guideNonWaterSpans(
          new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
          frame.width,
          frame.height,
          rect,
          xTop,
          xBottom,
          getTravelRightToLeft() ? -1 : 1,
        ),
      };
    }
    const xAt = (y: number) => xTop + ((xBottom - xTop) * y) / frame.height;
    ctx.save();
    ctx.strokeStyle = GUIDE_HIGHLIGHT_COLOR;
    ctx.lineWidth = GUIDE_HIGHLIGHT_WIDTH / Math.abs(vScaling.scaleX);
    ctx.lineCap = 'butt';
    guideSpans.current.spans.forEach(({ y0, y1 }) => {
      ctx.beginPath();
      ctx.moveTo(xAt(y0), y0);
      ctx.lineTo(xAt(y1), y1);
      ctx.stroke();
    });
    ctx.restore();
  };

  /** Canvas to show: transformed when zoomed in with a transform chosen. */
  const getDisplayCanvas = () => {
    const mode = getZoomTransform();
    const vScaling = getVideoScaling();
    const frame = displayImage.current;
    if (
      mode === 'off' ||
      vScaling.zoomY < ZOOM_TRANSFORM_MIN_ZOOM ||
      !frame?.width
    ) {
      return offscreenCanvas.current;
    }
    const rect = visibleSourceRect(vScaling, width, height);
    const key = `${mode}:${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key !== displayKey.current) {
      const canvas = displayCanvas.current;
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext('2d');
      const visible = clampRect(rect, frame.width, frame.height);
      if (ctx) {
        // Raw frame everywhere, then the transformed visible area on top.
        ctx.drawImage(offscreenCanvas.current, 0, 0);
        if (visible.width && visible.height) {
          const rowBytes = visible.width * 4;
          const crop = new Uint8ClampedArray(rowBytes * visible.height);
          for (let row = 0; row < visible.height; row += 1) {
            const from = ((visible.y + row) * frame.width + visible.x) * 4;
            crop.set(
              frame.data.subarray(from, from + rowBytes),
              row * rowBytes,
            );
          }
          const pixels = applyZoomTransform(
            crop,
            visible.width,
            visible.height,
            { x: 0, y: 0, width: visible.width, height: visible.height },
            mode,
          );
          ctx.putImageData(
            new ImageData(pixels, visible.width, visible.height),
            visible.x,
            visible.y,
          );
        }
      }
      displayKey.current = key;
    }
    return displayCanvas.current;
  };

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
        // The backing store is in device pixels; draw in CSS pixels on top.
        const dpr = canvas.width / width;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (image.width) {
          const vScaling = getVideoScaling();
          ctx.save();
          ctx.translate(vScaling.destX, vScaling.destY);
          ctx.scale(vScaling.scaleX, vScaling.scaleY);
          // Show magnified source pixels as-is so judges see the real edge,
          // but keep smoothing when downscaling to avoid aliasing.
          ctx.imageSmoothingEnabled = vScaling.scaleY < 1;
          const sourceCanvas = getDisplayCanvas();
          ctx.drawImage(sourceCanvas, 0, 0);
          drawGuideHighlight(ctx);
          const useTrackedInterpolation =
            hasAutoZoomInterpolation(image.file) &&
            (isZooming() ||
              hasAutoZoomInterpolationAtFrame(image.file, image.frameNum));
          const currentBowDetections = bowSeekPending
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
          const zoomedIn = vScaling.zoomY !== 1;
          const nearestBowCard = zoomedIn
            ? selectBowCardNearestPoint(
                currentBowDetections,
                vScaling.srcClickPoint,
              )
            : undefined;
          const selectedBowDetections = zoomedIn
            ? nearestBowCard
              ? [nearestBowCard]
              : []
            : currentBowDetections;
          // Without number annotation, keep the boat and card outlines but
          // drop the detected numbers (and their clickable labels).
          const visibleBowDetections = labelNumbers
            ? selectedBowDetections
            : selectedBowDetections.map((detection) => ({
                ...detection,
                text: '',
              }));
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
      // Bounds when the request starts; a change reruns detection.
      const requestCourseArea = getCourseArea();
      const frameHeight = getVideoScaling().srcHeight;
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
            ...getBowDetectionOptions(),
          });
          const cachedResult = await getCachedAutoZoomDetections(
            videoFileName,
            frameNum,
          )?.catch(() => undefined);
          const courseDetections = filterToCourseArea(
            result.detections,
            requestCourseArea,
            frameHeight,
          );
          detections = omitOverlappingBoatDetections(
            cachedResult
              ? restoreMissingCardDetections(
                  courseDetections,
                  cachedResult.detections,
                )
              : courseDetections,
          );
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
            getLabelNumbers()
              ? normalizeBowForCurrentEvent(
                  selectFinishAnnotation(detections, getImage().width) || '',
                )
              : '',
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
    courseAreaKey,
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
    zoomTransform,
    guideHighlight,
    timestampFinish.pt1,
    timestampFinish.pt2,
    image,
    videoScaling.destX,
    videoScaling.destY,
    videoScaling.scaleX,
    videoScaling.scaleY,
    bowDetections,
    bowSeekPending,
    videoBow,
    travelRightToLeft,
    labelNumbers,
  ]);

  useEffect(() => {
    if (!labelNumbers) {
      setAnnotatedBow('');
    }
  }, [labelNumbers]);

  useEffect(() => {
    // A bit of a hack but set a global callback function instead of passing it down the tree
    // May not be needed now that videoScaling is a global
    setGenerateImageSnapshotCallback((rawFrame) => {
      if (rawFrame) {
        return {
          canvas: offscreenCanvas.current,
          filename: `Image_${videoTimestamp}_raw.png`,
        };
      }
      const vScaling = getVideoScaling();
      const dpr = window.devicePixelRatio;
      return {
        canvas: combineCanvasLayers(
          [canvasRef.current, videoOverlayRef.current?.getCanvas()],
          ((width - vScaling.destWidth) / 2) * dpr,
          0,
          Math.round(vScaling.destWidth * dpr),
          Math.round(vScaling.destHeight * dpr),
        ),
        filename: `Image_${videoTimestamp}.png`,
      };
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

  /**
   * Zooms in at the timing guide on the clicked row, or exits zoom when
   * already zoomed. With `toTimingGuide`, the boat near the click is detected
   * and the video seeks to its estimated crossing of the timing guide.
   */
  const toggleZoomAtClick = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
    toTimingGuide: boolean,
  ) => {
    // Use the container rather than event.currentTarget, which React clears
    // before the delayed single click handler runs.
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return;
    }
    const mousePositionY = event.clientY - containerRect.top;
    if (mousePositionY < 30) {
      event.preventDefault();
      return;
    }
    const mousePositionX = event.clientX - containerRect.left;
    if (mousePositionX < 30) {
      event.preventDefault();
      return;
    }

    if (!isZooming()) {
      const finish = getFinishLine();
      const rect = canvasRef.current?.getBoundingClientRect();

      const { pt: srcCoords, withinBounds } = translateMouseEventCoords(
        event,
        rect,
      );
      if (!withinBounds) {
        return;
      }

      const applyFinishZoom = () => {
        applyZoom({
          zoom: 5,
          srcPoint: {
            x: getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2,
            y: srcCoords.y,
          },
          srcClickPoint: srcCoords,
        });
      };

      if (!toTimingGuide) {
        applyFinishZoom();
        return;
      }

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

      const runAutoZoom = () => {
        autoZoomToFinish(srcCoords)
          .then((result) => {
            if (result === null) {
              return undefined;
            }
            if (!result) {
              applyFinishZoom();
              return undefined;
            }
            if (
              !getLabelNumbers() ||
              (getVideoBow() !== '' && getVideoBow() !== '?')
            ) {
              return undefined;
            }
            const detectedBow = result.bow.trim();
            const supportingFrames = result.observations.filter(
              ({ detection }) => detection.text === detectedBow,
            ).length;
            const bowNumber = Number(detectedBow);
            if (
              /^\d{1,3}$/.test(detectedBow) &&
              bowNumber >= 1 &&
              bowNumber <= 999 &&
              supportingFrames >= 2
            ) {
              setVideoBow(selectEventForBow(detectedBow), getVideoBowUuid());
            }
            return undefined;
          })
          .catch((error) => {
            console.error('Auto Zoom to Finish failed', error);
            applyFinishZoom();
          });
      };

      if (atRecordedBowTime) {
        // Zoom in place on the recorded crew, but a click on another boat
        // finds that boat's crossing instead.
        detectBoatNearPoint(srcCoords)
          .then((selected) => {
            const guideX =
              getVideoScaling().srcWidth / 2 + (finish.pt1 + finish.pt2) / 2;
            if (
              !selected ||
              isRecordedBoatSelection(
                selected,
                guideX,
                currentBow,
                normalizeBowForCurrentEvent,
              )
            ) {
              applyFinishZoom();
              return undefined;
            }
            // Do not leave the recorded crew selected for another boat.
            const clickedBow = selected.detection.text.trim();
            setVideoBow(
              clickedBow && clickedBow !== '?'
                ? normalizeBowForCurrentEvent(clickedBow)
                : '?',
            );
            runAutoZoom();
            return undefined;
          })
          .catch((error) => {
            console.error('Boat detection failed', error);
            applyFinishZoom();
          });
      } else {
        runAutoZoom();
      }
    } else {
      resetVideoZoom();
    }
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
        const bow = normalizeBowForCurrentEvent(clickedLabel.value);
        setAnnotatedBow(bow);
        setVideoBow(bow, getVideoBowUuid());
        event.preventDefault();
        return;
      }
    }
    if (getZoomToTimingGuide() && !clickStartedDrag.current) {
      toggleZoomAtClick(event, true);
    }
  };

  const handleDoubleClick = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
  ) => toggleZoomAtClick(event, false);

  /**
   * Records whether a press is a drag rather than a click. Runs in the capture
   * phase because the guide overlay stops mousedown from reaching this box,
   * yet the browser still delivers a click here when the guide drag ends.
   */
  const handleMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    clickStartedDrag.current = overlayActive;
    mouseDownEvent.current = event.nativeEvent;
  };

  const { onSingleClick, onDoubleClick } = useSingleAndDoubleClick(
    handleSingleClick,
    handleDoubleClick,
  );

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const down = mouseDownEvent.current;
    const moved =
      !down ||
      Math.abs(event.clientX - down.clientX) > 4 ||
      Math.abs(event.clientY - down.clientY) > 4;
    // The guide overlay prevents default on a mousedown that grabs a guide.
    clickStartedDrag.current ||= moved || down.defaultPrevented;
    onSingleClick(event);
  };

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

      // A press taken over by a guide drag never sees its mouseup here.
      if (event.buttons % 2 === 0) {
        mouseTracking.current.mouseDown = false;
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

  // Clear zoom if file changes, unless a zoomed seek switched files
  useEffect(() => {
    if (!consumeZoomPreservedFile(image.file)) {
      clearZoom();
    }
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
        .then((refreshedImage) => {
          if (refreshedImage) {
            copyImageToOffscreenCanvas(refreshedImage);
          }
          return refreshedImage;
        })
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
  }, [copyImageToOffscreenCanvas, drawContentDebounced, resetZoomCount]);

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
    setDisplayedTimestampImage(image, videoTimestamp);
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
        onMouseDownCapture={handleMouseDownCapture}
        onDoubleClick={onDoubleClick}
        onClick={handleClick}
        ref={containerRef}
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
              <ZoomTransformButton className={classes.zoom} />
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
          // Match the backing store to physical pixels so Windows display
          // scaling doesn't stretch (and blur) the frame.
          width={Math.round(width * window.devicePixelRatio)}
          height={Math.round(height * window.devicePixelRatio)}
          style={{
            width: `${width}px`,
            height: `${height}px`,
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
            canvas={
              zoomTransform !== 'off' &&
              videoScaling.zoomY >= ZOOM_TRANSFORM_MIN_ZOOM
                ? displayCanvas.current
                : offscreenCanvas.current
            }
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

/** Space around each sidebar card, in px. */
const CARD_GAP = 4;
/** Border width of an outlined Paper, in px. */
const CARD_BORDER = 1;
/** What a card adds to its content in each dimension. */
const CARD_INSET = 2 * (CARD_GAP + CARD_BORDER);
/** Padding above the timing sidebar's first row inside its card. */
const TIMING_CARD_TOP = 8;

/** Card around a sidebar column, matching the recorder's Panel (theme radius). */
const SidebarCard = ({ children }: { children: React.ReactNode }) => (
  <Paper
    variant="outlined"
    sx={{
      m: `${CARD_GAP}px`,
      overflow: 'hidden',
      display: 'flex',
      flexShrink: 0,
    }}
  >
    {children}
  </Paper>
);

const Video = () => {
  const [top, setTop] = useState(180);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const videoSidebarWidth = 150; // enough for '20240308_123248.mp4'
  const timingSidebarwidth = 300;
  // The cards add their gap and border outside the content widths so the
  // file names still fit.
  const sidebarWidth = Math.max(
    60,
    videoSidebarWidth + timingSidebarwidth + 2 * CARD_INSET,
  );
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
  const cardHeight = Math.max(height - CARD_INSET, 1);

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
                  <SidebarCard>
                    <TimingSidebar
                      height={cardHeight - TIMING_CARD_TOP}
                      width={timingSidebarwidth}
                      sx={{
                        width: timingSidebarwidth,
                        height: cardHeight,
                        pt: `${TIMING_CARD_TOP}px`,
                      }}
                    />
                  </SidebarCard>
                  <SidebarCard>
                    <VideoSideBar
                      height={cardHeight}
                      sx={{
                        width: videoSidebarWidth,
                      }}
                    />
                  </SidebarCard>
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
