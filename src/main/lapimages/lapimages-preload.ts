/**
 * Support for queueing lap image uploads from the renderer.
 *
 * Add ```import './lapimages/lapimages-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';
import { LapImageMeta } from '../../renderer/shared/AppTypes';

contextBridge.exposeInMainWorld('LapImages', {
  queueImage(uuid: string, jpeg: Uint8Array, meta: LapImageMeta) {
    return ipcRenderer.invoke('lapimages:queueImage', uuid, jpeg, meta);
  },
  queueDelete(uuid: string) {
    return ipcRenderer.invoke('lapimages:queueDelete', uuid);
  },
  start() {
    return ipcRenderer.invoke('lapimages:start');
  },
});
