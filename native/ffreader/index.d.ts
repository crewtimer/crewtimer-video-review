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

  export function nativeVideoExecutor(
    message: OpenFileMessage | CloseFileMessage | SendMulticastMessage
  ): MessageResponseBase;

  export function nativeVideoExecutor(
    message: GrabFrameMessage
  ): GrabFrameMessageResponse;
}
