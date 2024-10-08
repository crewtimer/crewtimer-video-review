import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { UseDatum } from 'react-usedatum';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { saveVideoSidecar } from './VideoFileUtils';
import {
  Dir,
  getVideoFile,
  getVideoScaling,
  getVideoSettings,
  GuideLine,
  useImage,
  useVideoScaling,
  useVideoSettings,
} from './VideoSettings';
import {
  drawText,
  notifiyGuideChanged,
  Point,
  translateMouseEvent2Src,
  translateSrcCanvas2DestCanvas,
} from './VideoUtils';

export const [useAdjustingOverlay] = UseDatum(false);
export const [useNearEdge, , getNearEdge] = UseDatum(false);

export interface VideoOverlayProps {
  width: number; /// Canas width
  height: number; /// Canvas height
  destHeight: number; /// Image height in canvas
  destWidth: number; /// Image width in canvas
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
  ({ width, height, destHeight, onContextMenu }, ref) => {
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
    const [image] = useImage();
    const [videoSettings, setVideoSettings] = useVideoSettings();
    const [videoScaling] = useVideoScaling();

    useEffect(() => {
      // init volatile copy used while moving the mouse
      setCourseConfig(videoSettings);
    }, [videoSettings]);

    const drawBox = useCallback(
      (
        context: CanvasRenderingContext2D,
        posScaled: Point,
        dir: Dir,
        beginEdge: boolean
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
        } else {
          // vertical
          if (posScaled.y <= 0) {
            context.strokeRect(posScaled.x - 7, 1, 12, 12);
            context.fillStyle = 'white';
            context.fillRect(posScaled.x - 6, 2, 10, 10);
          } else {
            context.strokeRect(posScaled.x - 7, destHeight - 12, 12, 12);
            context.fillStyle = 'white';
            context.fillRect(posScaled.x - 6, destHeight - 11, 10, 10);
          }
        }
      },
      [destHeight]
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
      [adjustingOverlay, nearEdge]
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        canvas.width = videoScaling.destWidth;
        canvas.height = videoScaling.destHeight;

        // Draw the vertical line
        context.clearRect(0, 0, canvas.width, canvas.height);

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
                  videoScaling
                );
                const toScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: image.width / 2 + guide.pt2,
                    y: image.height - 1,
                  },
                  videoScaling
                );
                drawLine(fromScaled, toScaled, 'red', Dir.Vert);
              }
              break;
            case Dir.Horiz:
              {
                // Range check the guides
                guide.pt1 = Math.max(
                  10,
                  Math.min(image.height - 10, guide.pt1)
                );
                guide.pt2 = Math.max(
                  10,
                  Math.min(image.height - 10, guide.pt2)
                );
                let fromScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: 0,
                    y: guide.pt1,
                  },
                  videoScaling
                );
                let toScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: videoScaling.srcWidth - 1,
                    y: guide.pt2,
                  },
                  videoScaling
                );
                drawLine(fromScaled, toScaled, '#ff0000a0', Dir.Horiz);

                // Compute text orgin based on zoom
                fromScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: 0,
                    y: guide.pt1,
                  },
                  videoScaling
                );
                toScaled = translateSrcCanvas2DestCanvas(
                  {
                    x: videoScaling.srcWidth - 1,
                    y: guide.pt2,
                  },
                  videoScaling
                );
                drawText(
                  context,
                  `${guide.label}`,
                  12,
                  0, // FIXME - calculate based on zoom
                  fromScaled.y,
                  videoSettings.laneBelowGuide ? 'below' : 'above',
                  'left'
                );
                drawText(
                  context,
                  `${guide.label}`,
                  12,
                  videoScaling.destWidth, // FIXME - calculate based on zoom
                  toScaled.y,
                  videoSettings.laneBelowGuide ? 'below' : 'above',
                  'right'
                );
              }
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
    ]);

    const handleMouseDown = (event: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const { pt, withinBounds } = translateMouseEvent2Src(event, rect);
      if (!withinBounds) {
        return;
      }
      const videoScaling = getVideoScaling();
      const margin = 20 * videoScaling.pixScale;

      if (
        pt.y < margin ||
        pt.y > videoScaling.srcHeight - margin ||
        pt.x < margin ||
        pt.x > videoScaling.srcWidth - margin
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
          const guidept1 =
            guide.dir === Dir.Vert
              ? { x: image.width / 2 + guide.pt1, y: 0 }
              : { x: 0, y: guide.pt1 };
          const guidept2 =
            guide.dir === Dir.Vert
              ? { x: image.width / 2 + guide.pt2, y: image.height }
              : { x: image.width, y: guide.pt2 };
          if (guide.dir === Dir.Vert && guidept2.y > videoScaling.srcHeight) {
            guidept2.y = videoScaling.srcHeight;
          }
          const dist1 = Math.sqrt(
            (guidept1.x - pt.x) * (guidept1.x - pt.x) +
              (guidept1.y - pt.y) * (guidept1.y - pt.y)
          );
          const dist2 = Math.sqrt(
            (guidept2.x - pt.x) * (guidept2.x - pt.x) +
              (guidept2.y - pt.y) * (guidept2.y - pt.y)
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
          event.preventDefault();
          event.stopPropagation();
          if (pt.y < margin || pt.x < margin) {
            setDragHandle({ pos: 'pt1', guide: nearestGuide });
          } else {
            setDragHandle({ pos: 'pt2', guide: nearestGuide });
          }
        }
      }
    };

    const handleMouseMove = (event: React.MouseEvent) => {
      if (dragging && dragHandle) {
        const shift = event.shiftKey;
        const rect = canvasRef.current?.getBoundingClientRect();
        const { pt } = translateMouseEvent2Src(event, rect);

        if (dragHandle.guide.dir === Dir.Vert) {
          const xpos = Math.round(pt.x - videoScaling.srcWidth / 2);
          if (shift) {
            dragHandle.guide.pt1 = xpos;
            dragHandle.guide.pt2 = xpos;
          } else {
            if (dragHandle.pos === 'pt1') {
              const delta = dragHandle.guide.pt2 - dragHandle.guide.pt1;
              dragHandle.guide.pt1 = xpos;
              dragHandle.guide.pt2 = xpos + delta;
            } else {
              dragHandle.guide.pt2 = xpos;
            }
          }
        } else {
          const ypos = Math.round(pt.y);
          if (shift) {
            dragHandle.guide.pt1 = ypos;
            dragHandle.guide.pt2 = ypos;
          } else {
            if (dragHandle.pos === 'pt1') {
              // dragging pt1, keep angle between pt1 and pt2
              const delta = dragHandle.guide.pt2 - dragHandle.guide.pt1;
              dragHandle.guide.pt1 = ypos;
              dragHandle.guide.pt2 = ypos + delta;
            } else {
              dragHandle.guide.pt2 = ypos;
            }
          }
        }

        setCourseConfig({ ...courseConfig });
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
    };

    // TODO: Support touchscreens
    return (
      <canvas
        ref={canvasRef}
        onContextMenu={onContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={dragging ? handleMouseMove : undefined}
        onMouseUp={dragging ? handleMouseUp : undefined}
        onMouseLeave={dragging ? handleMouseUp : undefined}
        width={`${videoScaling.destWidth}px`}
        height={`${videoScaling.destHeight}px`}
        style={{
          zIndex: dragging ? 300 : 100, // adjustingOverlay ? 100 : undefined,
          position: 'absolute', // keeps the size from influencing the parent size
        }}
      />
    );
  }
);

export default VideoOverlay;
