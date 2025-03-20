import { KeyMap } from 'crewtimer-common';
import { IpcRendererEvent } from 'electron';
import type { CloseFileReturn, OpenDirReturn } from '../main/util/util-preload';

export interface OpenFileReturn {
  cancelled: boolean;
  filePath: string;
}

export interface RenameFileReturn {
  error: string;
}

export interface MkdirReturn {
  error: string;
}

export interface DirListReturn {
  error: string;
  files: string[];
}
declare global {
  interface Window {
    Util: {
      onUserMessage(
        callback: (event: IpcRendererEvent, level: string, msg: string) => void,
      ): void;
      openFileDialog(): Promise<OpenFileReturn>;
      openDirDialog(title: string, defaultPath: string): Promise<OpenDirReturn>;
      getFilesInDirectory(dirPath: string): Promise<DirListReturn>;
      openFileExplorer(path: string): Promise<void>;
      deleteFile(filename: string): Promise<CloseFileReturn>;
      renameFile(from: string, to: string): Promise<RenameFileReturn>;
      mkdir(directory: string): Promise<MkdirReturn>;
      readJsonFile<T = KeyMap>(
        filePath: string,
      ): Promise<{ status: string; error?: string; json?: T }>;
      storeJsonFile<T = KeyMap>(
        filePath: string,
        json: T,
      ): Promise<{ status: string; error?: string }>;
    };
    platform: {
      platform: string;
      pathSeparator: string;
      appVersion: string;
    };
  }
}

export {};
