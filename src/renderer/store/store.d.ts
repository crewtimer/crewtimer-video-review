import { IpcRendererEvent } from 'electron';

declare global {
  interface Window {
    store: {
      get<T>(key: string, defaultValue: T): Promise<T>;
      set<T>(key: string, newValue: T): void;
      delete(key: string): void;
      onStoredDatumUpdate(
        callback: (
          event: IpcRendererEvent,
          key: string,
          value: unknown,
        ) => void,
      ): void;
    };
    mem: {
      get<T>(key: string, defaultValue: T): Promise<T>;
      set<T>(key: string, newValue: T): void;
      delete(key: string): void;
      onDatumUpdate(
        callback: (
          event: IpcRendererEvent,
          key: string,
          value: unknown,
        ) => void,
      ): void;
    };
  }
}

export {};
