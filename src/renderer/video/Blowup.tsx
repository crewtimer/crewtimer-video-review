import React, { useRef, useEffect } from 'react';
import { useVideoScaling } from './VideoSettings';

interface BlowupProps {
  canvas: HTMLCanvasElement | null;
  mousePos: { x: number; y: number };
  srcPos: { x: number; y: number };
  size: number;
}

/**
 * Blowup component that renders a magnified portion of a video canvas.
 *
 * @param {HTMLCanvasElement | null} canvas - The source canvas element.
 * @param {Object} mousePos - The current mouse position.
 * @param {number} mousePos.x - The x-coordinate of the mouse position.
 * @param {number} mousePos.y - The y-coordinate of the mouse position.
 * @param {Object} srcPos - The source position on the canvas to magnify.
 * @param {number} size - The size of the blowup canvas.
 */
const Blowup: React.FC<BlowupProps> = ({ canvas, mousePos, srcPos, size }) => {
  const blowupRef = useRef<HTMLCanvasElement>(null);
  const [videoScaling] = useVideoScaling();
  const { zoomX, zoomY } = videoScaling;
  const srcSizeX = size / zoomX / zoomY / 2;
  const srcSizeY = size / zoomY / 2;
  useEffect(() => {
    if (canvas && blowupRef.current) {
      const ctx = blowupRef.current.getContext('2d');
      if (ctx) {
        const blowupCanvas = blowupRef.current;
        blowupCanvas.width = size;
        blowupCanvas.height = size;

        const blowupCtx = blowupCanvas.getContext('2d');
        if (blowupCtx) {
          blowupCtx.clearRect(0, 0, size, size);
          blowupCtx.save();
          blowupCtx.beginPath();
          blowupCtx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
          blowupCtx.clip();

          blowupCtx.drawImage(
            canvas,
            srcPos.x - srcSizeX / 2,
            srcPos.y - srcSizeY / 2,
            srcSizeX,
            srcSizeY,
            0,
            0,
            size,
            size,
          );

          // Draw crosshairs
          blowupCtx.strokeStyle = '#ff0000a0'; // Color of the crosshair lines
          blowupCtx.lineWidth = 1; // Width of the crosshair lines

          // // Vertical line
          // blowupCtx.beginPath();
          // blowupCtx.moveTo(size / 2, 0);
          // blowupCtx.lineTo(size / 2, size);
          // blowupCtx.stroke();

          // // Horizontal line
          // blowupCtx.beginPath();
          // blowupCtx.moveTo(0, size / 2);
          // blowupCtx.lineTo(size, size / 2);
          // blowupCtx.stroke();

          blowupCtx.restore();
        }
      }
    }
  }, [
    canvas,
    mousePos,
    size,
    srcPos.x,
    srcPos.y,
    srcSizeX,
    srcSizeY,
    zoomX,
    zoomY,
  ]);

  return (
    <canvas
      ref={blowupRef}
      style={{
        display: 'none', // DISABLE THE USE OF BLOWUP FOR NOW
        position: 'absolute',
        left: mousePos.x - size / 2,
        top: 192 + mousePos.y - size / 2,
        pointerEvents: 'none',
        borderRadius: '50%',
        boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
        zIndex: 400,
      }}
    />
  );
};
export default Blowup;
