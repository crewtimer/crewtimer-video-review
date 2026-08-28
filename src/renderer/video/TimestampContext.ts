import type { Rect } from '../shared/AppTypes';

/** Context required to reopen and interpolate a corrected scored timestamp. */
export interface TimestampContext {
  version: 1 | 2;
  uuid: string;
  keyid: string;
  gate: string;
  eventNum: string;
  bow: string;
  /** Corrected scored/display time. */
  time: string;
  /** Uncorrected video time used to seek and interpolate this result. */
  frameTime?: string;
  /** Absolute uncorrected frame timestamp, retained without display formatting. */
  frameTimestampMs?: number;
  /** Fractional frame position used by the interpolation engine. */
  frameNum?: number;
  /** Recorded-video Y coordinate used for a vertical rolling-shutter scan. */
  recordedY?: number;
  /** Finish-line X coordinate used for a horizontal rolling-shutter scan. */
  recordedX?: number;
  /** Sidecar scan axis used when the correction was scored. */
  correctionAxis?: 'x' | 'y';
  /** Correction applied when the result was scored. */
  correctionMs?: number;
  videoFile: string;
  srcClickPoint: { x: number; y: number };
  srcCenterPoint: { x: number; y: number };
  trackingRegion: Rect;
  zoomY: number;
  autoZoomed: boolean;
  updatedAt: number;
}
