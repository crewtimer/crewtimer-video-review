import {
  AppImage,
  BowDetectionRequest,
  BowDetectionResult,
  VideoFrameRequest,
} from 'renderer/shared/AppTypes';

declare global {
  interface Window {
    VideoUtils: {
      // See ../../src/main/video/video-preload.ts for implementation
      setDebugLevel(debugLevel: number): Promise<{ status: string }>;
      openFile(filePath: string): Promise<{ status: string }>;
      closeFile(filePath: string): Promise<{ status: string }>;
      getFrame(request: VideoFrameRequest): Promise<AppImage>;
      detectBow(request: BowDetectionRequest): Promise<BowDetectionResult>;
      sendMulticast(
        msg: string,
        dest: string,
        port: number,
      ): Promise<{ status: string }>;
    };
  }
}

export {};
