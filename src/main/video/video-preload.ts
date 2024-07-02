/**
 * Support for using FFREader in renderer
 *
 * Add ```import './video/video-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';
import { AppImage, Rect } from 'renderer/shared/AppTypes';

// Cache of video frames
const videoCache = new Map<string, AppImage>();
let cacheFilename = '';
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
    zoom?: Rect
  ) => {
    try {
      if (cacheFilename !== filePath) {
        videoCache.clear();
        cacheFilename = filePath;
      }
      const zooming = zoom && (zoom.x != 0 || zoom.y != 0);
      const uuid = `${filePath}-${zooming ? frameNum : Math.trunc(frameNum)}`;

      const result = (await ipcRenderer.invoke(
        'video:getFrame',
        filePath,
        frameNum,
        utcMilli,
        zoom
      )) as AppImage;
      if (result.status !== 'OK') {
        throw new Error(result.status);
      }

      if (result.data) {
        videoCache.set(uuid, result);
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
        port
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
