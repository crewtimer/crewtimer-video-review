/**
 * Support for using FFREader in renderer
 *
 * Add ```import './video/video-preload';``` to preload.ts to integrate with main
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  AppImage,
  BowDetectionRequest,
  BowDetectionResult,
  VideoFrameRequest,
} from 'renderer/shared/AppTypes';

contextBridge.exposeInMainWorld('VideoUtils', {
  setDebugLevel: (debugLevel: number) =>
    ipcRenderer.invoke('video:setDebugLevel', debugLevel),
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
  getFrame: async (request: VideoFrameRequest) => {
    try {
      const result = (await ipcRenderer.invoke(
        'video:getFrame',
        request,
      )) as AppImage;
      if (result.status !== 'OK') {
        throw new Error(result.status);
      }
      return result;
    } catch (err) {
      throw err;
    }
  },
  detectBow: async (request: BowDetectionRequest) => {
    const result = (await ipcRenderer.invoke(
      'video:detectBow',
      request,
    )) as BowDetectionResult;
    if (result.status !== 'OK') {
      throw new Error(result.status);
    }
    return result;
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
