import type { VideoSidecar } from './VideoSettings';

export type RollingShutterPoint = { x: number; y: number };
export type RetainedRollingShutterCorrection = {
  videoFile: string;
  frameNum: number;
  offsetMs: number;
};

export const retainedRollingShutterOffsetMs = (
  correction: RetainedRollingShutterCorrection | undefined,
  videoFile: string,
  frameNum: number,
) =>
  correction?.videoFile === videoFile &&
  Math.abs(correction.frameNum - frameNum) <= 0.001
    ? correction.offsetMs
    : 0;

/** Return the selected finish-line point's offset from the frame timestamp. */
export const rollingShutterOffsetMs = (
  sidecar: VideoSidecar | undefined,
  recordedPoint: RollingShutterPoint | undefined,
) => {
  const source = sidecar?.source;
  const rollingShutter = sidecar?.sensor?.rollingShutter;
  const axis = rollingShutter?.frameTimeReference.axis;
  const direction = rollingShutter?.direction;
  const validDirection =
    (axis === 'x' &&
      (direction === 'left-to-right' || direction === 'right-to-left')) ||
    (axis === 'y' &&
      (direction === 'top-to-bottom' || direction === 'bottom-to-top'));
  const recordedCoordinate = axis ? recordedPoint?.[axis] : Number.NaN;
  const cropCoordinate = axis ? source?.crop?.[axis] : Number.NaN;
  const scanDimension =
    axis === 'x' ? source?.originalWidth : source?.originalHeight;
  if (
    !source ||
    !rollingShutter ||
    rollingShutter.frameTimeReference.coordinateSpace !== 'original-image' ||
    !validDirection ||
    typeof recordedCoordinate !== 'number' ||
    !Number.isFinite(recordedCoordinate) ||
    typeof cropCoordinate !== 'number' ||
    !Number.isFinite(cropCoordinate) ||
    typeof scanDimension !== 'number' ||
    !Number.isFinite(scanDimension) ||
    scanDimension <= 0 ||
    !Number.isFinite(rollingShutter.scanTimeMs) ||
    !Number.isFinite(rollingShutter.frameTimeReference.position)
  ) {
    return 0;
  }

  const originalCoordinate = cropCoordinate + recordedCoordinate;
  const directionSign =
    direction === 'left-to-right' || direction === 'top-to-bottom' ? 1 : -1;
  return (
    ((originalCoordinate - rollingShutter.frameTimeReference.position) *
      directionSign *
      rollingShutter.scanTimeMs) /
    scanDimension
  );
};

/** Correct a displayed/scored timestamp without changing its video frame. */
export const rollingShutterTimestampMs = (
  frameTimestampMs: number,
  sidecar: VideoSidecar | undefined,
  recordedPoint: RollingShutterPoint | undefined,
) => frameTimestampMs + rollingShutterOffsetMs(sidecar, recordedPoint);
