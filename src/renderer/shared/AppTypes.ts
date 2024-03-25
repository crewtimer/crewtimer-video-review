export interface AppImage {
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
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
