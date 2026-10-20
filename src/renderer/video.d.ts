import {
  AppImage,
  BowDetectionRequest,
  BowDetectionResult,
  VideoFrameRequest,
} from 'renderer/shared/AppTypes';
import type { RecorderMessage } from 'renderer/video/RecorderStatus';

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
      /** Subscribe to recorder multicast status reports; returns an unsubscribe. */
      onRecorderStatus(callback: (msg: RecorderMessage) => void): () => void;
    };
  }
}

export {};
