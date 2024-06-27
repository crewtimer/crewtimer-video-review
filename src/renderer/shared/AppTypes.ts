export interface AppImage {
  status: string;
  width: number;
  height: number;
  frameNum: number;
  timestamp: number;
  data: Uint8Array;
  fps: number;
  numFrames: number;
  file: string;
  fileStartTime: number;
  fileEndTime: number;
  motion: { x: number; y: number; dt: number; valid: boolean };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
