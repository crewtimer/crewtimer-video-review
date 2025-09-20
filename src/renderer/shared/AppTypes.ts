import { KeyMap } from 'crewtimer-common';

export interface AppImage {
  status: string;
  width: number;
  height: number;
  frameNum: number;
  timestamp: number;
  tsMicro: number;
  data: Uint8Array;
  fps: number;
  tzOffset: number;
  numFrames: number;
  file: string;
  fileStartTime: number;
  fileEndTime: number;
  motion: { x: number; y: number; dt: number; valid: boolean };
  sidecar?: KeyMap;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Represents a request for a specific video frame.
 * Only one of frameNum, seekPercent, or toTimestamp should be specified.
 */
export type VideoFrameRequest = {
  videoFile: string; // The path or identifier of the video file.
  frameNum?: number; // The frame number to extract (optional).
  seekPercent?: number; // Where in file to seek as percentage (optional).
  tsMilli?: number; // The timestamp to seek to (in milliseconds) (optional).
  toTimestamp?: string; // The timestamp to seek to (HHMMSS.sss) (optional).
  zoom?: Rect; // The zoom window (optional).
  blend?: boolean; // Whether to blend the frame with the previous frame (optional).
  saveAs?: string; // Optional filename in which to save a PNG image of the frame.
  closeTo?: boolean; // Optional: true to only get 'close' to the requested frame.
};
