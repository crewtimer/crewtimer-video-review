import React, { useRef, useEffect, useState, useCallback } from 'react';
import { UseDatum } from 'react-usedatum';
import { useImage, useZoomWindow } from './VideoSettings';

interface Point {
  x: number;
  y: number;
}

enum Dir {
  Horiz,
  Vert,
}

export interface CourseConfig {
  finish: {
    top: number;
    bottom: number;
  };
  lanes: {
    label: string;
    left: number;
    right: number;
  }[];
}
export const [useAdjustingOverlay] = UseDatum(false);
export const [useCourseConfig, , getCourseConfig] = UseDatum<CourseConfig>({
  finish: { top: 0, bottom: 0 },
  lanes: [], // [{ label: '1', left: 1080 / 2, right: 1080 / 2 }],
});

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
  const [dragHandle, setDragHandle] = useState<'top' | 'bottom' | null>(null);
  const [adjustingOverlay] = useAdjustingOverlay();
  const [courseConfig, setCourseConfig] = useCourseConfig();
  const [zoomWindow] = useZoomWindow();
  const [image] = useImage();
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
    (context: CanvasRenderingContext2D, posScaled: Point, dir: Dir) => {
      context.strokeStyle = 'black';
      // const posScaled = scalePoint(pos.x, pos.y);
      if (dir === Dir.Horiz) {
        // horizontal
        if (posScaled.x <= 0) {
          context.strokeRect(1, posScaled.y - 7, 12, 12);
          context.fillStyle = 'white';
          context.fillRect(2, posScaled.y - 6, 10, 10);
        } else {
          context.strokeRect(destWidth - 12, posScaled.y - 7, 12, 12);
          context.fillStyle = 'white';
          context.fillRect(destWidth - 11, posScaled.y - 6, 10, 10);
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
    (from: Point, to: Point, dir: Dir) => {
      const context = canvasRef.current?.getContext('2d');
      if (!context) {
        return;
      }
      let fromScaled = scalePoint(from.x, from.y);
      let toScaled = scalePoint(to.x, to.y);

      context.strokeStyle = 'red';
      context.moveTo(fromScaled.x, fromScaled.y);
      context.lineTo(toScaled.x, toScaled.y);
      context.stroke();

      if (adjustingOverlay) {
        context.beginPath();
        drawBox(context, { x: fromScaled.x, y: fromScaled.y }, dir);
        drawBox(context, { x: toScaled.x, y: toScaled.y }, dir);
        context.stroke();
      }
    },
    [scalePoint, adjustingOverlay]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      canvas.width = width;
      canvas.height = destHeight;

      // Draw the vertical line
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = 'red';
      context.beginPath();
      drawLine(
        { x: image.width / 2 + courseConfig.finish.top, y: 0 },
        {
          x: image.width / 2 + courseConfig.finish.bottom,
          y: image.height - 1,
        },
        Dir.Vert
      );

      courseConfig.lanes.forEach((laneConfig) => {
        drawLine(
          { x: 0, y: laneConfig.left },
          { x: image.width - 1, y: laneConfig.right },
          Dir.Horiz
        );
      });
    }
  }, [courseConfig.finish, adjustingOverlay, width, height, zoomWindow]);

  const handleMouseDown = (event: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const y = event.clientY - (rect?.top ?? 0);
    const isTopHandle = y < 20;
    const isBottomHandle = y > destHeight - 20;

    if (isTopHandle || isBottomHandle) {
      setDragging(true);
      setDragHandle(isTopHandle ? 'top' : 'bottom');
    }
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (dragging && dragHandle) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const x = event.clientX - (rect?.left ?? 0) - rect?.width! / 2;
      const xpos = x / scale;

      if (dragHandle === 'top') {
        setCourseConfig((prev) => ({
          ...prev,
          finish: {
            ...prev.finish,
            top: xpos,
            bottom: prev.finish.bottom + xpos - prev.finish.top,
          },
        }));
      } else {
        setCourseConfig((prev) => ({
          ...prev,
          finish: { ...prev.finish, [dragHandle]: xpos },
        }));
      }
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
    setDragHandle(null);
  };

  // TODO: Support touchscreens

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={adjustingOverlay ? handleMouseDown : undefined}
      onMouseMove={adjustingOverlay ? handleMouseMove : undefined}
      onMouseUp={adjustingOverlay ? handleMouseUp : undefined}
      onMouseLeave={adjustingOverlay ? handleMouseUp : undefined}
      width={`${width}px`}
      height={`${height}px`}
      style={{
        zIndex: adjustingOverlay ? 100 : undefined,
        position: 'absolute', // keeps the size from influencing the parent size
      }}
    />
  );
};

export default VideoOverlay;
