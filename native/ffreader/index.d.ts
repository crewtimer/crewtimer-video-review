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

  interface GrabFrameMessage extends MessageBase {
    op: 'grabFrameAt';
    frameNum: number;
    file: string;
    zoom?: { x: number; y: number; width: number; height: number };
    blend?: boolean;
    saveAs?: string; // optional filename in which to save a png image of the frame
    /** Interpolation technique for fractional frameNum requests. Defaults to 'blend'. */
    interpMethod?: 'blend' | 'rife';
    /** RIFE-only: region to interpolate. Required (or falls back to zoom) when interpMethod is 'rife'. */
    crop?: { x: number; y: number; width: number; height: number };
    /** RIFE-only: path to the rife_v4.6.onnx model file. */
    modelFile?: string;
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

  interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
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
      /** Path to the CTC bow-number reader (bow_crnn.onnx). */
      numberModelFile: string;
      /** Full-frame pixel coordinates near the bow, used to pick which boat to read. */
      point: { x: number; y: number };
      closeTo?: boolean;
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
    timestamp: number;
    fileStartTime: number;
    fileEndTime: number;
    motion: { x: number; y: number; dt: number; valid: boolean };
  }

  interface DetectBowMessageResponse extends MessageResponseBase {
    text: string;
    confidence: number;
    /** Bow-card box, full-frame pixel coordinates. */
    box: Rect;
    /** Boat box, full-frame pixel coordinates. */
    boatBox: Rect;
    frameNum: number;
    timestamp: number;
  }

  export function nativeVideoExecutor(
    message: OpenFileMessage | CloseFileMessage | SendMulticastMessage,
  ): MessageResponseBase;

  export function nativeVideoExecutor(
    message: GrabFrameMessage,
  ): GrabFrameMessageResponse;

  export function nativeVideoExecutor(
    message: DetectBowMessage,
  ): DetectBowMessageResponse;
}
