/**
 * Support for using LapStorage in renderer
 *
 * Add ```import './lapstorage/lapstorage-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';
import { Lap } from 'crewtimer-common';

contextBridge.exposeInMainWorld('LapStorage', {
  updateLapFields(fields: { uuid: string; [key: string]: string }) {
    // expect a response, use invoke
    return ipcRenderer.invoke('lapstorage:updateLapFields', fields);
  },
  updateLap(datum: Lap) {
    return ipcRenderer.invoke('lapstorage:updateLap', datum);
  },
  startLapStorage() {
    return ipcRenderer.invoke('lapstorage:start');
  },
  stopLapStorage() {
    return ipcRenderer.invoke('lapstorage:stop');
  },
  truncateLapTable() {
    return ipcRenderer.invoke('lapstorage:truncateLapTable');
  },
});
