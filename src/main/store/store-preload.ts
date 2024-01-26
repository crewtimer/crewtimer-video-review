/**
 * Support for using electron-store in conjunction with react-usedatum.
 *
 * Add ```import './store/store-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('store', {
  get<T>(key: string, defaultValue: T) {
    // expect a response, use invoke
    return ipcRenderer.invoke('store:get', key, defaultValue);
  },
  set<T>(key: string, newValue: T) {
    // no response, use send
    return ipcRenderer.send('store:set', key, newValue);
  },
  delete(key: string) {
    // no response, use send
    return ipcRenderer.send('store:delete', key);
  },
  onStoredDatumUpdate: (
    callback: (_event: IpcRendererEvent, key: string, value: unknown) => void
  ) => ipcRenderer.on('stored-datum-update', callback),
});

contextBridge.exposeInMainWorld('mem', {
  get<T>(key: string, defaultValue: T) {
    // expect a response, use invoke
    return ipcRenderer.invoke('mem:get', key, defaultValue);
  },
  set<T>(key: string, newValue: T) {
    // no response, use send
    return ipcRenderer.send('mem:set', key, newValue);
  },
  delete(key: string) {
    // no response, use send
    return ipcRenderer.send('mem:delete', key);
  },
  onDatumUpdate: (
    callback: (_event: IpcRendererEvent, key: string, value: unknown) => void
  ) => ipcRenderer.on('datum-update', callback),
});
