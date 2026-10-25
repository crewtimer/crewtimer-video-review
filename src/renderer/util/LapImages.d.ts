import { LapImageMeta } from '../shared/AppTypes';

declare global {
  interface Window {
    LapImages: {
      queueImage(
        uuid: string,
        jpeg: Uint8Array,
        meta: LapImageMeta,
        thumbnail?: Uint8Array,
      ): Promise<void>;
      queueDelete(uuid: string): Promise<void>;
      start(): Promise<void>;
    };
  }
}

export {};
