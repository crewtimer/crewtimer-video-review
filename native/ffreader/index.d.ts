/**
 * This module provides native C++ functionality as a Node.js addon,
 * specifically designed for Electron applications.
 * @module crewtimer_video_reader
 */
declare module 'crewtimer_video_reader' {
  interface MessageBase {
    op: string;
  }
  interface OpenFileMessage extends MessageBase {
    op: 'openFile';
    file: string;
  }

  interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface Prune {
    side: 'top' | 'bottom';
    percentage: number;
  }

  interface GrabFrameRequest {
    videoFile: string;
    /** 1-based frame number; fractional values interpolate between frames. */
    frameNum: number;
    /** When non-zero, seek to this UTC time (ms) instead of frameNum. */
    tsMilli?: number;
    /** Region used for motion estimation when interpolating. */
    zoom?: Rect;
    blend?: boolean;
    /** Only get 'close' to the requested frame (faster seek). */
    closeTo?: boolean;
    /** Return the native frame nearest the requested time instead of interpolating. */
    nearestFrame?: boolean;
    /** Optional filename in which to save a png image of the frame. */
    saveAs?: string;
    /** Interpolation technique for fractional frameNum requests. Defaults to 'blend'. */
    interpMethod?: 'blend' | 'rife';
    /** RIFE-only: region to interpolate (falls back to zoom). */
    crop?: Rect;
    prune?: Prune;
    /** RIFE-only: path to the rife_v4.6.onnx model file. */
    modelFile?: string;
  }

  interface GrabFrameMessage extends MessageBase {
    op: 'grabFrameAt';
    request: GrabFrameRequest;
  }

  interface CloseFileMessage extends MessageBase {
    op: 'closeFile';
    file: string;
  }

  interface SendMulticastMessage extends MessageBase {
    op: 'sendMulticast';
    dest: string;
    port: number;
    msg: string;
  }

  interface DebugMessage extends MessageBase {
    op: 'debug';
    debugLevel: number;
  }

  /** Redirects native stdout/stderr to the given file (appending). */
  interface SetLogFileMessage extends MessageBase {
    op: 'setLogFile';
    logFile: string;
  }

  interface DetectBowMessage extends MessageBase {
    op: 'detectBowAtFrame';
    request: {
      videoFile: string;
      frameNum: number;
      /** Path to the boat detector (crewtimer-boat-train.onnx). */
      boatModelFile: string;
      /** Path to the bow-card detector (bow_card_detect.onnx). */
      cardModelFile: string;
      /** Path to an 11-class numeric or 37-class alphanumeric CTC bow reader. */
      numberModelFile: string;
      /** Full-frame pixel coordinates near the bow, used to pick which boat to read. */
      point?: { x: number; y: number };
      closeTo?: boolean;
      prune?: Prune;
      detectCardsWithoutBoat?: boolean;
    };
  }

  interface MessageResponseBase {
    status: string;
  }
  interface GrabFrameMessageResponse extends MessageResponseBase {
    data: Buffer;
    width: number;
    height: number;
    totalBytes: number;
    frameNum: number;
    numFrames: number;
    fps: number;
    file: string;
    /** Frame time in UTC milliseconds. */
    timestamp: number;
    /** Frame time in UTC microseconds. */
    tsMicro: number;
    motion: { x: number; y: number; dt: number; valid: boolean };
  }

  interface DetectBowMessageResponse extends MessageResponseBase {
    detections: Array<{
      text: string;
      confidence: number;
      box: Rect;
      boatBox: Rect;
    }>;
    frameNum: number;
    timestamp: number;
  }

  export function nativeVideoExecutor(
    message: SendMulticastMessage | DebugMessage | SetLogFileMessage,
  ): MessageResponseBase;

  /**
   * File, frame and detection ops run on a native worker thread so slow
   * decode or ONNX inference never blocks the calling (Electron main) thread.
   * The promise rejects with an Error on failure.
   */
  export function nativeVideoExecutor(
    message: OpenFileMessage | CloseFileMessage,
  ): Promise<MessageResponseBase>;

  export function nativeVideoExecutor(
    message: GrabFrameMessage,
  ): Promise<GrabFrameMessageResponse>;

  export function nativeVideoExecutor(
    message: DetectBowMessage,
  ): Promise<DetectBowMessageResponse>;
}
