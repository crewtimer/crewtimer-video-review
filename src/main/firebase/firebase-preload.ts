/**
 * Support for using Firebase in renderer
 *
 * Add ```import './firebase/firebase-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('Firebase', {
  startFirebase() {
    return ipcRenderer.invoke('firebase:start');
  },
  stopFirebase() {
    return ipcRenderer.invoke('firebase:stop');
  },
});
