import {
  DetectBowMessage,
  GrabFrameMessage,
  nativeVideoExecutor,
} from 'crewtimer_video_reader';
import { app, ipcMain } from 'electron';
import path from 'path';
import {
  BowDetectionRequest,
  VideoFrameRequest,
} from 'renderer/shared/AppTypes';

export function stopVideoServices(_name: string) {}

export function startVideoServices(logFilePath: string) {
  try {
    nativeVideoExecutor({
      op: 'setLogFile',
      logFile: logFilePath,
    } as unknown as GrabFrameMessage);
  } catch (err) {
    console.error('Failed to redirect C++ logging:', err);
  }
}

ipcMain.handle('video:sendMulticast', (_event, msg, dest, port) => {
  try {
    const ret = nativeVideoExecutor({ op: 'sendMulticast', msg, dest, port });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:openFile', (_event, filePath) => {
  // Invoke native c++ handler
  try {
    const ret = nativeVideoExecutor({ op: 'openFile', file: filePath });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:closeFile', (_event, filePath) => {
  // Invoke native c++ handler
  try {
    const ret = nativeVideoExecutor({ op: 'closeFile', file: filePath });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

const rifeModelFile = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'rife_v4.6.onnx')
    : path.join(__dirname, '../../native/rife/rife_v4.6.onnx');

ipcMain.handle('video:getFrame', (_event, request: VideoFrameRequest) => {
  try {
    // console.log('Grabbing frame', JSON.stringify(request, null, 2));
    const nativeRequest =
      request.interpMethod === 'rife'
        ? { ...request, modelFile: rifeModelFile() }
        : request;
    const ret = nativeVideoExecutor({
      op: 'grabFrameAt',
      // clean request of undefined keys
      request: Object.fromEntries(
        Object.entries(nativeRequest).filter(([_, v]) => v !== undefined),
      ),
    } as unknown as GrabFrameMessage);
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:detectBow', (_event, request: BowDetectionRequest) => {
  try {
    const modelFile = app.isPackaged
      ? path.join(process.resourcesPath, 'bow_crnn.onnx')
      : path.join(__dirname, '../../native/bowdetect/bow_crnn.onnx');
    return nativeVideoExecutor({
      op: 'detectBowAtFrame',
      request: { ...request, modelFile },
    } as DetectBowMessage);
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});
