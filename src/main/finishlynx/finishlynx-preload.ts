/**
 * Support for using FinishLynx in renderer
 *
 * Add ```import './finishlynx/finishlynx-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('FinishLynx', {
  startLynxServer() {
    return ipcRenderer.invoke('finishlynx:start');
  },
  stopLynxServer() {
    return ipcRenderer.invoke('finishlynx:stop');
  },
  validateLynxFolder(folder: string) {
    return ipcRenderer.invoke('finishlynx:validateLynxFolder', folder);
  },
  chooseLynxFolder() {
    return ipcRenderer.invoke('finishlynx:chooseLynxFolder');
  },
  generateEvtFiles() {
    return ipcRenderer.invoke('finishlynx:generateEvtFiles');
  },
});
