import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { UseDatum } from 'react-usedatum';
import { showErrorDialog } from '../util/ErrorDialog';
import { saveVideoSidecar } from './Sidecar';
import {
  COURSE_AREA_COLOR,
  CourseArea,
  DEFAULT_GUIDE_COLOR,
  Dir,
  getCourseArea,
  getHyperZoomFactor,
  getImage,
  getVideoFile,
  getVideoFrameNum,
  getVideoScaling,
  getVideoSettings,
  GuideLine,
  useMouseWheelInverted,
  useInterpolationTechnique,
  useVideoScaling,
  useVideoSettings,
} from './VideoSettings';
import {
  drawText,
  getTrackingRegion,
  moveToFrame,
  Point,
  translateMouseEventCoords,
  translateSrcCanvas2DestCanvas,
} from './VideoUtils';
import { videoRequestQueueRunning } from './RequestVideoFrame';

export const [useOverlayActive, setOverlayActive] = UseDatum(false);
export const [useAdjustingOverlay, , getAdjustingOverlay] = UseDatum(false);
export const [useNearEdge, setNearEdge, getNearEdge] = UseDatum(false);

/** Canvas pixels from a course area or lane line that still grab it. */
const LINE_GRAB = 6;
/** Canvas pixels from a lane line's right end that tilt it, like its handle. */
const LINE_END_GRAB = 20;

type LineHit =
  | { course: 'top' | 'bottom' }
  | { pos: 'pt1' | 'pt2' | 'line'; guide: GuideLine };

export interface VideoOverlayProps {
  width: number; /// Canas width
  height: number; /// Canvas height
  suspendDraw?: boolean;
  onContextMenu?: (event: React.MouseEvent<HTMLCanvasElement>) => void;
}

export interface VideoOverlayHandles {
  getCanvas: () => HTMLCanvasElement | null;
}
/**
 * Create an overlay for the video frame to show the finish line and lanes.
 * @param {VideoOverlayProps} props
 * @returns A canvas element
 */
const VideoOverlay = forwardRef<VideoOverlayHandles, VideoOverlayProps>(
  ({ width, height, suspendDraw = false, onContextMenu }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Use useImperativeHandle to expose custom functions or values to the parent
    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current, // Provide a function to get the current canvas ref
    }));

    const [dragging, setDragging] = useState(false);
    const [overLine, setOverLine] = useState(false);
    const [dragHandle, setDragHandle] = useState<
      | {
          pos: 'pt1' | 'pt2' | 'line';
          guide: GuideLine;
          /** For 'line': grab point's height above pt1, as a fraction. */
          grabOffset?: number;
        }
      | { course: 'top' | 'bottom' }
      | null
    >(null);
    const [adjustingOverlay, setAdjustingOverlay] = useAdjustingOverlay();
    const [nearEdge] = useNearEdge();
    const [courseConfig, setCourseConfig] = useState(getVideoSettings());
    const [videoSettings, setVideoSettings] = useVideoSettings();
    const [videoScaling] = useVideoScaling();
    const [wheelInverted] = useMouseWheelInverted();
    const [interpolationTechnique] = useInterpolationTechnique();
    const wheelTracking = useRef({
      millis: 0,
      dtAvg: 0,
      count: 0,
      velocity: 0,
    });
    const isZooming = useCallback(
      () => videoScaling.zoomY !== 1,
      [videoScaling.zoomY],
    );

    useEffect(() => {
      // init volatile copy used while moving the mouse
      setCourseConfig(videoSettings);
    }, [videoSettings]);

    useEffect(() => {
      let lastT = wheelTracking.current.count;
      const timer = setInterval(() => {
        if (lastT !== wheelTracking.current.count) {
          lastT = wheelTracking.current.count;
          // console.log(
          //   `wheel v=${wheelTracking.current.velocity}, deltaT=${
          //     wheelTracking.current.dtAvg
          //   }, tc=${wheelTracking.current.count} ${Date.now() % 1000}`
          // );
        }
      }, 100);
      return () => clearInterval(timer);
    }, []);

    const onWheelMove = useCallback(
      (event: React.WheelEvent<HTMLCanvasElement>) => {
        if (videoRequestQueueRunning()) {
          return; // ignore
        }
        let scrollAmount;
        switch (event.deltaMode) {
          case 0: // Pixel-based scroll (likely from a trackpad)
            scrollAmount = event.deltaY;
            break;
          case 1: // Line-based scroll (likely from a traditional mouse)
            scrollAmount = event.deltaY * 16; // Approximate conversion to pixels
            break;
          case 2: // Page-based scroll
            scrollAmount = event.deltaY * window.innerHeight;
            break;
          default:
            scrollAmount = event.deltaY;
        }

        const now = Date.now();
        const deltaT = Math.min(500, now - wheelTracking.current.millis);
        if (deltaT <= 0) {
          return;
        }
        const velocity = Math.abs(scrollAmount) / deltaT;
        wheelTracking.current.millis = now;
        // if (deltaT > 200 && deltaT < 500) {
        //   return; // Ignore as the user pauses to restart scroll
        // }
        if (deltaT === 500 || wheelTracking.current.dtAvg === 500) {
          wheelTracking.current.dtAvg = deltaT;
          wheelTracking.current.velocity = velocity;
        } else {
          const alpha = 0.5;
          wheelTracking.current.dtAvg =
            wheelTracking.current.dtAvg * alpha + deltaT * (1 - alpha);
          wheelTracking.current.velocity =
            wheelTracking.current.velocity * alpha + velocity * (1 - alpha);
        }
        wheelTracking.current.count += 1;

        // console.log(
        //   `deltaT=${deltaT} avg=${wheelTracking.current.dtAvg} dir=${Math.sign(
        //     event.deltaY
        //   )}`
        // );

        // If mouse moving 'slow', the use 1 for frame delta.  Otherwise use a larger
        // factor depending on the zoom level.
        const delta =
          (wheelInverted ? -1 : 1) *
          Math.sign(event.deltaY) *
          (wheelTracking.current.velocity < 1 ? 1 : isZooming() ? 2 : 3);
        setTimeout(() => moveToFrame(getVideoFrameNum(), delta), 1);
      },
      [isZooming, wheelInverted],
    );

    const drawBox = useCallback(
      (
        context: CanvasRenderingContext2D,
        posScaled: Point,
        dir: Dir,
        beginEdge: boolean,
      ) => {
        context.beginPath();
        context.strokeStyle = 'black';
        // const posScaled = scalePoint(pos.x, pos.y);
        if (dir === Dir.Horiz) {
          // horizontal
          if (beginEdge) {
            context.strokeRect(posScaled.x + 1, posScaled.y - 7, 12, 12);
            context.fillStyle = 'white';
            context.fillRect(posScaled.x + 2, posScaled.y - 6, 10, 10);
          } else {
            context.strokeRect(posScaled.x - 12, posScaled.y - 7, 12, 12);
            context.fillStyle = 'white';
            context.fillRect(posScaled.x - 11, posScaled.y - 6, 10, 10);
          }
        } // vertical
        else if (posScaled.y <= 0) {
          context.strokeRect(posScaled.x - 7, 1, 12, 12);
          context.fillStyle = 'white';
          context.fillRect(posScaled.x - 6, 2, 10, 10);
        } else {
          context.strokeRect(posScaled.x - 7, posScaled.y - 12, 12, 12);
          context.fillStyle = 'white';
          context.fillRect(posScaled.x - 6, posScaled.y - 11, 10, 10);
        }
      },
      [],
    );

    const drawLine = useCallback(
      (from: Point, to: Point, color: string, dir: Dir) => {
        const context = canvasRef.current?.getContext('2d');
        if (!context) {
          return;
        }
        context.beginPath();
        context.strokeStyle = color;
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();

        if (adjustingOverlay || nearEdge) {
          drawBox(context, { x: from.x, y: from.y }, dir, true);
          drawBox(context, { x: to.x, y: to.y }, dir, false);
        }
      },
      [adjustingOverlay, drawBox, nearEdge],
    );

    useEffect(() => {
      if (suspendDraw) {
        return;
      }
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      const image = getImage();
      if (canvas && context) {
        const dpr = window.devicePixelRatio;
        canvas.width = Math.round(videoScaling.destWidth * dpr);
        canvas.height = Math.round(videoScaling.destHeight * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(
          0,
          0,
          videoScaling.destWidth,
          videoScaling.destHeight,
        );
        const guideColor = courseConfig.guideColor || DEFAULT_GUIDE_COLOR;

        if (
          interpolationTechnique === 'blend' &&
          videoScaling.zoomY > 1 &&
          getHyperZoomFactor() > 0
        ) {
          // Draw region used for hyperZoom
          const trackingRegion = getTrackingRegion();
          const xy = translateSrcCanvas2DestCanvas(
            {
              x: trackingRegion.x,
              y: trackingRegion.y,
            },
            videoScaling,
          );
          trackingRegion.width *= videoScaling.scaleX;
          trackingRegion.height *= videoScaling.scaleY;

          context.strokeStyle = '#000000';
          context.strokeRect(
            xy.x,
            xy.y,
            trackingRegion.width,
            trackingRegion.height,
          );
          context.strokeStyle = '#ffffff';
          context.strokeRect(
            xy.x - 1,
            xy.y - 1,
            trackingRegion.width + 2,
            trackingRegion.height + 2,
          );
        }

        const courseArea = getCourseArea(courseConfig.courseArea);
        if (courseArea.enabled && !isZooming()) {
          const left = translateSrcCanvas2DestCanvas(
            { x: 0, y: 0 },
            videoScaling,
          ).x;
          const right = translateSrcCanvas2DestCanvas(
            { x: videoScaling.srcWidth - 1, y: 0 },
            videoScaling,
          ).x;
          const imageTop = translateSrcCanvas2DestCanvas(
            { x: 0, y: 0 },
            videoScaling,
          ).y;
          const imageBottom = translateSrcCanvas2DestCanvas(
            { x: 0, y: videoScaling.srcHeight },
            videoScaling,
          ).y;
          const lineY = (fraction: number) =>
            translateSrcCanvas2DestCanvas(
              { x: 0, y: fraction * videoScaling.srcHeight },
              videoScaling,
            ).y;
          const topY = lineY(courseArea.top);
          const bottomY = lineY(courseArea.bottom);

          // Dim where boats are ignored.
          context.fillStyle = '#00000040';
          context.fillRect(left, imageTop, right - left, topY - imageTop);
          context.fillRect(left, bottomY, right - left, imageBottom - bottomY);

          context.save();
          context.lineWidth = 2;
          context.setLineDash([10, 6]);
          context.beginPath();
          context.strokeStyle = COURSE_AREA_COLOR;
          context.moveTo(left, topY);
          context.lineTo(right, topY);
          context.moveTo(left, bottomY);
          context.lineTo(right, bottomY);
          context.stroke();
          context.restore();

          if (adjustingOverlay || nearEdge) {
            drawBox(context, { x: left, y: topY }, Dir.Horiz, true);
            drawBox(context, { x: right, y: topY }, Dir.Horiz, false);
            drawBox(context, { x: left, y: bottomY }, Dir.Horiz, true);
            drawBox(context, { x: right, y: bottomY }, Dir.Horiz, false);
          }
          const centerX =
            (Math.max(0, left) + Math.min(videoScaling.destWidth, right)) / 2;
          // Labels sit outside the band, in the ignored area, when the
          // visible image has room for them; otherwise inside the band.
          const labelSpace = 32;
          const visibleTop = Math.max(0, imageTop);
          const visibleBottom = Math.min(videoScaling.destHeight, imageBottom);
          drawText(
            context,
            'Course Top',
            12,
            centerX,
            topY,
            topY - visibleTop >= labelSpace ? 'above' : 'below',
            'center',
            `${COURSE_AREA_COLOR}80`,
          );
          drawText(
            context,
            'Course Bottom',
            12,
            centerX,
            bottomY,
            visibleBottom - bottomY >= labelSpace ? 'below' : 'above',
            'center',
            `${COURSE_AREA_COLOR}80`,
          );
        }

        courseConfig.guides.forEach((guide) => {
          if (
            !guide.enabled ||
            (!courseConfig.enableLaneGuides && guide.dir === Dir.Horiz)
          ) {
            return;
          }
          switch (guide.dir) {
            case Dir.Vert:
              {
                const fromScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: image.width / 2 + guide.pt1,
                    y: 0,
                  },
                  videoScaling,
                );
                const toScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: image.width / 2 + guide.pt2,
                    y: image.height - 1,
                  },
                  videoScaling,
                );
                drawLine(fromScaled, toScaled, guideColor, Dir.Vert);
              }
              break;
            case Dir.Horiz:
              {
                // Range check the guides
                guide.pt1 = Math.max(0, Math.min(1, guide.pt1));
                guide.pt2 = Math.max(0, Math.min(1, guide.pt2));
                let fromScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: 0,
                    y: guide.pt1 * videoScaling.srcHeight,
                  },
                  videoScaling,
                );
                let toScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: videoScaling.srcWidth - 1,
                    y: guide.pt2 * videoScaling.srcHeight,
                  },
                  videoScaling,
                );
                drawLine(fromScaled, toScaled, guideColor, Dir.Horiz);
                const leftText = Math.max(0, fromScaled.x);
                const rightText = Math.min(videoScaling.destWidth, toScaled.x);

                // Compute text orgin based on zoom
                fromScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: 0,
                    y: guide.pt1 * videoScaling.srcHeight,
                  },
                  videoScaling,
                );
                toScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: videoScaling.srcWidth - 1,
                    y: guide.pt2 * videoScaling.srcHeight,
                  },
                  videoScaling,
                );
                drawText(
                  context,
                  `${guide.label}`,
                  12,
                  leftText,
                  fromScaled.y,
                  videoSettings.laneBelowGuide ? 'below' : 'above',
                  'left',
                );
                drawText(
                  context,
                  `${guide.label}`,
                  12,
                  rightText,
                  toScaled.y,
                  videoSettings.laneBelowGuide ? 'below' : 'above',
                  'right',
                );
              }
              break;
            default:
              break;
          }
        });
      }
    }, [
      videoSettings,
      courseConfig,
      isZooming,
      adjustingOverlay,
      nearEdge,
      width,
      height,
      videoScaling,
      videoScaling.zoomX,
      interpolationTechnique,
      drawLine,
      drawBox,
      suspendDraw,
    ]);

    /**
     * The course area or lane line within grab distance of a canvas point,
     * if any. Lines are only grabbed unzoomed, where the course area is
     * shown. A lane line grabbed near its right end tilts, like its handle.
     */
    const lineAt = (x: number, y: number): LineHit | undefined => {
      if (isZooming()) {
        return undefined;
      }
      const scaling = getVideoScaling();
      let best: { hit: LineHit; dist: number } | undefined;
      const consider = (hit: LineHit, dist: number) => {
        if (dist <= LINE_GRAB && (!best || dist < best.dist)) {
          best = { hit, dist };
        }
      };

      const courseArea = getCourseArea(courseConfig.courseArea);
      if (courseArea.enabled) {
        (['top', 'bottom'] as const).forEach((edge) => {
          const lineY = translateSrcCanvas2DestCanvas({
            x: 0,
            y: courseArea[edge] * scaling.srcHeight,
          }).y;
          consider({ course: edge }, Math.abs(lineY - y));
        });
      }

      if (courseConfig.enableLaneGuides) {
        courseConfig.guides.forEach((guide) => {
          if (!guide.enabled || guide.dir !== Dir.Horiz) {
            return;
          }
          const from = translateSrcCanvas2DestCanvas({
            x: 0,
            y: guide.pt1 * scaling.srcHeight,
          });
          const to = translateSrcCanvas2DestCanvas({
            x: scaling.srcWidth,
            y: guide.pt2 * scaling.srcHeight,
          });
          const span = to.x - from.x;
          if (span <= 0) {
            return;
          }
          const t = Math.max(0, Math.min(1, (x - from.x) / span));
          const lineY = from.y + (to.y - from.y) * t;
          const pos = to.x - x <= LINE_END_GRAB ? 'pt2' : 'line';
          consider({ pos, guide }, Math.abs(lineY - y));
        });
      }
      return best?.hit;
    };

    const handleMouseDown = (event: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const { dx, dy, x, y, withinBounds } = translateMouseEventCoords(
        event,
        rect,
      );
      if (!withinBounds) {
        return;
      }
      const image = getImage();
      const scaling = getVideoScaling();
      const margin = 20; // (20 * (scaling.scaleX + scaling.scaleY)) / 2;

      const line = lineAt(x, y);
      if (line) {
        setDragging(true);
        setAdjustingOverlay(true);
        setOverlayActive(true);
        event.preventDefault();
        event.stopPropagation();
        if ('course' in line) {
          courseConfig.courseArea = getCourseArea(courseConfig.courseArea);
          setDragHandle(line);
        } else {
          setDragHandle({
            ...line,
            grabOffset: dy / scaling.destImageHeight - line.guide.pt1,
          });
        }
        return;
      }

      // if (rect) {
      //   const x = event.clientX - (rect?.left ?? 0);
      //   const y = event.clientY - (rect?.top ?? 0);
      //   console.log(`(${x}x${y} w=${rect.width})`);
      //   if (y < 100 && x > rect.width - 100) {
      //     return;
      //   }
      // }

      if (
        dy < margin ||
        dy > scaling.srcHeight * scaling.scaleY - margin ||
        dx < margin ||
        dx > scaling.destHeight * scaling.scaleX - margin
      ) {
        // find first guide within margin px
        const nearest: { index: number; dist: number } = {
          index: -1,
          dist: 50000,
        };
        courseConfig.guides.forEach((guide, index) => {
          if (!guide.enabled) {
            return;
          }
          // Convert guide coordinates to screen coords and check for distance
          let guidept1 =
            guide.dir === Dir.Vert
              ? { x: image.width / 2 + guide.pt1, y: 0 }
              : { x: 0, y: guide.pt1 * image.height };
          let guidept2 =
            guide.dir === Dir.Vert
              ? { x: image.width / 2 + guide.pt2, y: image.height }
              : { x: image.width, y: guide.pt2 * image.height };
          if (guide.dir === Dir.Vert && guidept2.y > scaling.srcHeight) {
            guidept2.y = scaling.srcHeight;
          }

          guidept1 = translateSrcCanvas2DestCanvas(guidept1);
          guidept2 = translateSrcCanvas2DestCanvas(guidept2);
          const dist1 = Math.sqrt(
            (guidept1.x - x) * (guidept1.x - x) +
              (guidept1.y - y) * (guidept1.y - y),
          );
          const dist2 = Math.sqrt(
            (guidept2.x - x) * (guidept2.x - x) +
              (guidept2.y - y) * (guidept2.y - y),
          );

          if (dist1 < margin || dist2 < margin) {
            if (Math.min(dist1, dist2) < nearest.dist) {
              nearest.dist = Math.min(dist1, dist2);
              nearest.index = index;
            }
          }
        });

        if (nearest.index >= 0) {
          const nearestGuide = courseConfig.guides[nearest.index];
          setDragging(true);
          setAdjustingOverlay(true);
          setOverlayActive(true);
          event.preventDefault();
          event.stopPropagation();
          if (dy < margin || dx < margin) {
            setDragHandle({ pos: 'pt1', guide: nearestGuide });
          } else {
            setDragHandle({ pos: 'pt2', guide: nearestGuide });
          }
        }
      }
    };

    const handleMouseMove = (event: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const { dx, dy, x, y, pt, withinBounds, overButtons } =
        translateMouseEventCoords(event, rect);

      if (dragging && dragHandle && 'course' in dragHandle) {
        const ypos = Math.max(
          0,
          Math.min(1, dy / videoScaling.destImageHeight),
        );
        // Raw values while dragging; edges are ordered on release.
        const area: CourseArea = {
          ...(courseConfig.courseArea ?? getCourseArea()),
          [dragHandle.course]: ypos,
        };
        setCourseConfig({ ...courseConfig, courseArea: area });
      } else if (dragging && dragHandle && 'guide' in dragHandle) {
        const shift = event.shiftKey;

        if (dragHandle.guide.dir === Dir.Vert) {
          const xpos = Math.round(pt.x - videoScaling.srcWidth / 2);
          if (shift) {
            dragHandle.guide.pt1 = xpos;
            dragHandle.guide.pt2 = xpos;
          } else if (dragHandle.pos === 'pt1') {
            const delta = dragHandle.guide.pt2 - dragHandle.guide.pt1;
            dragHandle.guide.pt1 = xpos;
            dragHandle.guide.pt2 = xpos + delta;
          } else {
            dragHandle.guide.pt2 = xpos;
          }
        } else {
          const ypos = dy / videoScaling.destImageHeight;
          if (shift) {
            dragHandle.guide.pt1 = ypos;
            dragHandle.guide.pt2 = dragHandle.guide.pt1;
          } else if (dragHandle.pos === 'line') {
            // Move the whole line from where it was grabbed, keeping its angle.
            const delta = dragHandle.guide.pt2 - dragHandle.guide.pt1;
            const pt1 = ypos - (dragHandle.grabOffset ?? 0);
            dragHandle.guide.pt1 = Math.max(0, Math.min(1, pt1));
            dragHandle.guide.pt2 = Math.max(0, Math.min(1, pt1 + delta));
          } else if (dragHandle.pos === 'pt1') {
            // dragging pt1, keep angle between pt1 and pt2
            const delta = dragHandle.guide.pt2 - dragHandle.guide.pt1;
            dragHandle.guide.pt1 = ypos;
            dragHandle.guide.pt2 = Math.max(0, Math.min(1, ypos + delta));
          } else {
            dragHandle.guide.pt2 = ypos;
          }
        }

        setCourseConfig({ ...courseConfig });
      } else {
        const vScaling = getVideoScaling();

        const nearVerticalEdge =
          dy < 20 || dy > vScaling.srcHeight * vScaling.scaleY - 20;
        const nearHorizontalEdge =
          dx < 20 || dx > vScaling.srcWidth * vScaling.scaleX - 20;

        const isNearEdge =
          !overButtons &&
          !isZooming() &&
          withinBounds &&
          (nearVerticalEdge || nearHorizontalEdge);
        setNearEdge(isNearEdge);
        setOverLine(withinBounds && !!lineAt(x, y));

        setOverlayActive(overButtons || isNearEdge || adjustingOverlay);
      }
    };

    const handleMouseUp = () => {
      if (dragging) {
        courseConfig.sidecarSource = getVideoFile();
        if (courseConfig.courseArea) {
          courseConfig.courseArea = getCourseArea(courseConfig.courseArea);
        }
        setVideoSettings(courseConfig, true);
        saveVideoSidecar().catch(showErrorDialog);
      }
      setDragging(false);
      setDragHandle(null);
      setAdjustingOverlay(false);
      setOverlayActive(false);
    };
    const handleMouseLeave = () => {
      if (dragging) {
        handleMouseUp();
      }
      setNearEdge(false);
      setOverLine(false);
    };

    // TODO: Support touchscreens
    return (
      <canvas
        ref={canvasRef}
        onContextMenu={onContextMenu}
        onWheel={adjustingOverlay ? undefined : onWheelMove}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={dragging ? handleMouseUp : undefined}
        onMouseLeave={handleMouseLeave}
        width={Math.round(videoScaling.destWidth * window.devicePixelRatio)}
        height={Math.round(videoScaling.destHeight * window.devicePixelRatio)}
        style={{
          width: `${videoScaling.destWidth}px`,
          height: `${videoScaling.destHeight}px`,
          cursor:
            overLine ||
            (dragging &&
              dragHandle &&
              ('course' in dragHandle || dragHandle.guide.dir === Dir.Horiz))
              ? 'ns-resize'
              : undefined,
          zIndex: dragging ? 300 : 100, // adjustingOverlay ? 100 : undefined,
          position: 'absolute', // keeps the size from influencing the parent size
        }}
      />
    );
  },
);

export default VideoOverlay;
