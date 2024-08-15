import { useRef, useEffect } from 'react';

interface BlowupProps {
  canvas: HTMLCanvasElement | null;
  mousePos: { x: number; y: number };
  srcPos: { x: number; y: number };
  size: number;
  zoom: number;
}

const Blowup: React.FC<BlowupProps> = ({
  canvas,
  mousePos,
  srcPos,
  size,
  zoom,
}) => {
  const blowupRef = useRef<HTMLCanvasElement>(null);

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
            srcPos.x - size / (2 * zoom),
            srcPos.y - size / (2 * zoom),
            size / zoom,
            size / zoom,
            0,
            0,
            size,
            size
          );

          // Draw crosshairs
          blowupCtx.strokeStyle = '#ff000080'; // Color of the crosshair lines
          blowupCtx.lineWidth = 1; // Width of the crosshair lines

          // Vertical line
          blowupCtx.beginPath();
          blowupCtx.moveTo(size / 2, 0);
          blowupCtx.lineTo(size / 2, size);
          blowupCtx.stroke();

          // Horizontal line
          blowupCtx.beginPath();
          blowupCtx.moveTo(0, size / 2);
          blowupCtx.lineTo(size, size / 2);
          blowupCtx.stroke();

          blowupCtx.restore();
        }
      }
    }
  }, [canvas, mousePos, size, zoom]);

  return (
    <canvas
      ref={blowupRef}
      style={{
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
