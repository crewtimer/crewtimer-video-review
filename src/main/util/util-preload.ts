/**
 * Support for using LapStorage in renderer
 *
 * Add ```import './util/util-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
export interface OpenFileReturn {
  cancelled: boolean;
  filePath: string;
}

export interface DirListReturn {
  error: string;
  files: string[];
}
// Function to open the file dialog and return the selected file path as a promise
export function openFileDialog(): Promise<OpenFileReturn> {
  return new Promise((resolve, _reject) => {
    ipcRenderer
      .invoke('open-file-dialog')
      .then((result) => resolve(result))
      .catch((_err) => resolve({ cancelled: true, filePath: '' }));
  });
}

// Function to get the files in a directory and return them as a promise
export function getFilesInDirectory(dirPath: string): Promise<DirListReturn> {
  // console.log('Executing getFiles in dir preload');
  return new Promise((resolve, _reject) => {
    ipcRenderer
      .invoke('get-files-in-directory', dirPath)
      .then((result: DirListReturn) => {
        // console.log('get files in dir result=' + JSON.stringify(result));
        resolve(result);
      })
      .catch((err) => ({ error: String(err), files: [] }));
  });
}

contextBridge.exposeInMainWorld('Util', {
  onUserMessage: (
    callback: (_event: IpcRendererEvent, level: string, msg: string) => void
  ) => ipcRenderer.on('user-message', callback),
  getFilesInDirectory,
  openFileDialog,
});
