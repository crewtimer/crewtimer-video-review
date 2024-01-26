/**
 * Support for using LapStorage in renderer
 *
 * Add ```import './util/util-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('Util', {
  onUserMessage: (
    callback: (_event: IpcRendererEvent, level: string, msg: string) => void
  ) => ipcRenderer.on('user-message', callback),
});
