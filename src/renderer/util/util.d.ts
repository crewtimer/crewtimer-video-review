import { IpcRendererEvent } from 'electron';

declare global {
  interface Window {
    Util: {
      onUserMessage(
        callback: (event: IpcRendererEvent, level: string, msg: string) => void
      ): void;
    };
  }
}

export {};
