import { AppImage, Rect } from 'renderer/shared/AppTypes';

declare global {
  interface Window {
    VideoUtils: {
      // See ../../src/main/video/video-preload.ts for implementation
      openFile(filePath: string): Promise<{ status: string }>;
      closeFile(filePath: string): Promise<{ status: string }>;
      getFrame(
        filePath: string,
        frameNum: number,
        tsMilli: number,
        zoom?: Rect
      ): Promise<AppImage>;
      sendMulticast(
        msg: string,
        dest: string,
        port: number
      ): Promise<{ status: string }>;
    };
  }
}

export {};
