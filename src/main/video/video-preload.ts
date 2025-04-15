/**
 * Support for using FFREader in renderer
 *
 * Add ```import './video/video-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';
import { AppImage, Rect } from 'renderer/shared/AppTypes';

contextBridge.exposeInMainWorld('VideoUtils', {
  openFile: async (filePath: string) => {
    try {
      const result = await ipcRenderer.invoke('video:openFile', filePath);
      // console.log('result', result);
      if (result.status !== 'OK') {
        throw new Error(result.status);
      }
      return result;
    } catch (err) {
      throw err;
    }
  },
  closeFile: async (filePath: string) => {
    try {
      const result = await ipcRenderer.invoke('video:closeFile', filePath);
      if (result.status !== 'OK') {
        throw new Error(result.status);
      }
      return result;
    } catch (err) {
      throw err;
    }
  },
  getFrame: async (
    filePath: string,
    frameNum: number,
    utcMilli: number,
    zoom?: Rect,
    blend?: boolean,
    saveAs?: string,
    closeTo?: boolean,
  ) => {
    try {
      const result = (await ipcRenderer.invoke(
        'video:getFrame',
        filePath,
        frameNum,
        utcMilli,
        zoom,
        blend,
        saveAs,
        closeTo,
      )) as AppImage;
      if (result.status !== 'OK') {
        throw new Error(result.status);
      }
      return result;
    } catch (err) {
      throw err;
    }
  },
  sendMulticast: async (msg: string, dest: string, port: number) => {
    try {
      const result = await ipcRenderer.invoke(
        'video:sendMulticast',
        msg,
        dest,
        port,
      );
      if (result.status !== 'OK') {
        throw new Error(result.status);
      }
      return result;
    } catch (err) {
      throw err;
    }
  },
});
