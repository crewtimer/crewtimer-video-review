import React, { useRef, useEffect, useState, useCallback } from 'react';
import { UseDatum } from 'react-usedatum';
import {
  Dir,
  getVideoSettings,
  GuideLine,
  useImage,
  useVideoSettings,
  useZoomWindow,
} from './VideoSettings';
import { drawText, Point } from './VideoUtils';

export const [useAdjustingOverlay] = UseDatum(false);
export const [useNearEdge] = UseDatum(false);

export interface VideoOverlayProps {
  width: number; /// Canas width
  height: number; /// Canvas height
  destHeight: number; /// Image height in canvas
  destWidth: number; /// Image width in canvas
}

/**
 * Create an overlay for the video frame to show the finish line and lanes.
 * @param {VideoOverlayProps} props
 * @returns A canvas element
 */
const VideoOverlay: React.FC<VideoOverlayProps> = ({
  width,
  height,
  destHeight,
  destWidth,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<{
    pos: 'pt1' | 'pt2';
    guide: GuideLine;
  } | null>(null);
  const [adjustingOverlay, setAdjustingOverlay] = useAdjustingOverlay();
  const [nearEdge] = useNearEdge();
  const [courseConfig, setCourseConfig] = useState(getVideoSettings());
  const [zoomWindow] = useZoomWindow();
  const [image] = useImage();
  const [videoSettings, setVideoSettings] = useVideoSettings();
  const mouseDownVideoCoordsRef = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    // init volatile copy used while moving the mouse
    setCourseConfig(videoSettings);
  }, [videoSettings]);
  const scale = Math.min(
    width / zoomWindow.width,
    destHeight / zoomWindow.height
  );

  // If the canvas is wider than the image, calc padding so it's centered
  const xPadding = (width - destWidth) / 2;

  /**
   * Scale a point in the original image space to the canvas
   * @param x X coordinage in original image space
   * @param y Y coordinate in original image space
   * @returns {x,y} in canvas coordinates
   */
  const scalePoint = useCallback(
    (x: number, y: number) => {
      return {
        x: xPadding + (x - zoomWindow.x) * scale,
        y: (y - zoomWindow.y) * scale,
      };
    },
    [xPadding, zoomWindow.x, zoomWindow.y, scale]
  );

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
    [scalePoint, adjustingOverlay, nearEdge]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      canvas.width = width;
      canvas.height = destHeight;

      // Draw the vertical line
      context.clearRect(0, 0, canvas.width, canvas.height);

      courseConfig.guides.forEach((guide) => {
        if (!guide.enabled) {
          return;
        }
        switch (guide.dir) {
          case Dir.Vert:
            {
              const fromScaled = scalePoint(image.width / 2 + guide.pt1, 0);
              const toScaled = scalePoint(
                image.width / 2 + guide.pt2,
                image.height - 1
              );
              drawLine(fromScaled, toScaled, 'red', Dir.Vert);
            }
            break;
          case Dir.Horiz:
            {
              let fromScaled = scalePoint(0, guide.pt1);
              let toScaled = scalePoint(image.width - 1, guide.pt2);
              drawLine(fromScaled, toScaled, '#ff0000a0', Dir.Horiz);

              // Compute text orgin based on zoom
              fromScaled = scalePoint(
                zoomWindow.x,
                guide.pt1 +
                  ((guide.pt2 - guide.pt1) * zoomWindow.x) / image.width
              );
              toScaled = scalePoint(
                zoomWindow.x + zoomWindow.width - 1,
                guide.pt1 +
                  ((guide.pt2 - guide.pt1) *
                    (zoomWindow.x + zoomWindow.width)) /
                    image.width
              );
              drawText(
                context,
                `${guide.label}`,
                destHeight / 50,
                fromScaled.x,
                fromScaled.y,
                videoSettings.laneBelowGuide ? 'below' : 'above',
                'left'
              );
              drawText(
                context,
                `${guide.label}`,
                destHeight / 50,
                toScaled.x,
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
    zoomWindow,
  ]);

  const handleMouseDown = (event: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const y = event.clientY - (rect?.top ?? 0);
    let x = event.clientX - (rect?.left ?? 0);
    mouseDownVideoCoordsRef.current = { x: x / scale, y: y / scale };

    if (
      y < 20 ||
      y > destHeight - 20 ||
      x < 20 + xPadding ||
      x > destWidth - 20 + xPadding
    ) {
      x = x;
      // find first guide within 20 px
      const nearest: { index: number; dist: number } = {
        index: -1,
        dist: 50000,
      };
      courseConfig.guides.forEach((guide, index) => {
        if (!guide.enabled) {
          return;
        }
        // Convert guide coordinates to screen coords and check for distance
        const point1 =
          guide.dir === Dir.Vert
            ? scalePoint(image.width / 2 + guide.pt1, 0)
            : scalePoint(0, guide.pt1);
        const point2 =
          guide.dir === Dir.Vert
            ? scalePoint(image.width / 2 + guide.pt2, image.height)
            : scalePoint(image.width, guide.pt2);
        if (guide.dir === Dir.Vert && point2.y > destHeight) {
          point2.y = destHeight;
        }
        const dist1 = Math.sqrt(
          (point1.x - x) * (point1.x - x) + (point1.y - y) * (point1.y - y)
        );
        const dist2 = Math.sqrt(
          (point2.x - x) * (point2.x - x) + (point2.y - y) * (point2.y - y)
        );
        // console.log(`dist1: ${dist1}, dist2: ${dist2} x: ${x}, y: ${y}`);

        if (dist1 < 20 || dist2 < 20) {
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
        if (y < 20 || x < 20 + xPadding) {
          setDragHandle({ pos: 'pt1', guide: nearestGuide });
        } else {
          setDragHandle({ pos: 'pt2', guide: nearestGuide });
        }
      }
    }
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    const shift = event.shiftKey;
    const rect = canvasRef.current?.getBoundingClientRect();
    let x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0);
    // const nearEdge =
    //   y < 20 ||
    //   y > destHeight - 20 ||
    //   x < 20 - xPadding ||
    //   x > destWidth - 20 - xPadding;
    // setNearEdge(nearEdge);

    if (dragging && dragHandle) {
      const rect = canvasRef.current?.getBoundingClientRect();
      x = x - rect?.width! / 2; // delta from center
      const xpos = x / scale;
      const ypos = y / scale;

      if (dragHandle.guide.dir === Dir.Vert) {
        if (shift) {
          dragHandle.guide.pt1 = xpos;
          dragHandle.guide.pt2 = xpos;
        } else {
          if (dragHandle.pos === 'pt1') {
            dragHandle.guide.pt2 =
              dragHandle.guide.pt2 + xpos - dragHandle.guide.pt1;
            dragHandle.guide.pt1 = xpos;
          } else {
            dragHandle.guide.pt2 = xpos;
          }
        }
      } else {
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
      setVideoSettings(courseConfig, true);
    }
    setDragging(false);
    setDragHandle(null);
    setAdjustingOverlay(false);
  };

  // TODO: Support touchscreens

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={dragging ? handleMouseMove : undefined}
      onMouseUp={dragging ? handleMouseUp : undefined}
      onMouseLeave={dragging ? handleMouseUp : undefined}
      width={`${width}px`}
      height={`${height}px`}
      style={{
        zIndex: dragging ? 300 : 100, // adjustingOverlay ? 100 : undefined,
        position: 'absolute', // keeps the size from influencing the parent size
      }}
    />
  );
};

export default VideoOverlay;
