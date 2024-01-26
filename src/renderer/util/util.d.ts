import { IpcRendererEvent } from 'electron';
export interface OpenFileReturn {
  cancelled: boolean;
  filePath: string;
}

export interface DirListReturn {
  error: string;
  files: string[];
}
declare global {
  interface Window {
    Util: {
      onUserMessage(
        callback: (event: IpcRendererEvent, level: string, msg: string) => void
      ): void;
      openFileDialog(): Promise<OpenFileReturn>;
      getFilesInDirectory(dirPath: string): Promise<DirListReturn>;
    };
  }
}

export {};
