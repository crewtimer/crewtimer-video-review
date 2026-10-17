import { LapImageMeta } from '../shared/AppTypes';

declare global {
  interface Window {
    LapImages: {
      queueImage(
        uuid: string,
        jpeg: Uint8Array,
        meta: LapImageMeta,
      ): Promise<void>;
      queueDelete(uuid: string): Promise<void>;
      start(): Promise<void>;
    };
  }
}

export {};
