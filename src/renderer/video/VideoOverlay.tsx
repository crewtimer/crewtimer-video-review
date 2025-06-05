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
  Dir,
  getHyperZoomFactor,
  getImage,
  getVideoFile,
  getVideoFrameNum,
  getVideoScaling,
  getVideoSettings,
  GuideLine,
  useMouseWheelInverted,
  useVideoScaling,
  useVideoSettings,
} from './VideoSettings';
import {
  drawText,
  getTrackingRegion,
  moveToFrame,
  notifiyGuideChanged,
  Point,
  translateMouseEventCoords,
  translateSrcCanvas2DestCanvas,
} from './VideoUtils';
import { videoRequestQueueRunning } from './RequestVideoFrame';

export const [useOverlayActive, setOverlayActive] = UseDatum(false);
export const [useAdjustingOverlay, , getAdjustingOverlay] = UseDatum(false);
export const [useNearEdge, setNearEdge, getNearEdge] = UseDatum(false);

export interface VideoOverlayProps {
  width: number; /// Canas width
  height: number; /// Canvas height
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
  ({ width, height, onContextMenu }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Use useImperativeHandle to expose custom functions or values to the parent
    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current, // Provide a function to get the current canvas ref
    }));

    const [dragging, setDragging] = useState(false);
    const [dragHandle, setDragHandle] = useState<{
      pos: 'pt1' | 'pt2';
      guide: GuideLine;
    } | null>(null);
    const [adjustingOverlay, setAdjustingOverlay] = useAdjustingOverlay();
    const [nearEdge] = useNearEdge();
    const [courseConfig, setCourseConfig] = useState(getVideoSettings());
    const [videoSettings, setVideoSettings] = useVideoSettings();
    const [videoScaling] = useVideoScaling();
    const [wheelInverted] = useMouseWheelInverted();
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
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      const image = getImage();
      if (canvas && context) {
        canvas.width = videoScaling.destWidth;
        canvas.height = videoScaling.destHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);

        if (videoScaling.zoomY > 1 && getHyperZoomFactor() > 0) {
          // Draw region used for hyperZoom
          const trackingRegion = getTrackingRegion(true);
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
                drawLine(fromScaled, toScaled, '#f008', Dir.Vert);
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
                drawLine(fromScaled, toScaled, '#ff0000a0', Dir.Horiz);
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
      adjustingOverlay,
      nearEdge,
      width,
      height,
      videoScaling,
      drawLine,
    ]);

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
      const { dx, dy, pt, withinBounds } = translateMouseEventCoords(
        event,
        rect,
      );

      if (dragging && dragHandle) {
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

        let overButtons = false;
        if (rect) {
          if (dy < 50 && dx > rect.width - 100) {
            overButtons = true;
          }
        }

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

        setOverlayActive(overButtons || isNearEdge || adjustingOverlay);
      }
    };

    const handleMouseUp = () => {
      if (dragging) {
        courseConfig.sidecarSource = getVideoFile();
        setVideoSettings(courseConfig, true);
        notifiyGuideChanged();
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
        width={`${videoScaling.destWidth}px`}
        height={`${videoScaling.destHeight}px`}
        style={{
          zIndex: dragging ? 300 : 100, // adjustingOverlay ? 100 : undefined,
          position: 'absolute', // keeps the size from influencing the parent size
        }}
      />
    );
  },
);

export default VideoOverlay;
