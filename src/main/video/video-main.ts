import { GrabFrameRequest, nativeVideoExecutor } from 'crewtimer_video_reader';
import { app, ipcMain } from 'electron';
import path from 'path';
import {
  BowDetectionRequest,
  VideoFrameRequest,
} from 'renderer/shared/AppTypes';
import { trimToCardLength } from 'renderer/video/BowNumber';

export function stopVideoServices(_name: string) {}

export function startVideoServices(logFilePath: string) {
  try {
    nativeVideoExecutor({ op: 'setLogFile', logFile: logFilePath });
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

ipcMain.handle('video:setDebugLevel', (_event, debugLevel: number) => {
  try {
    return nativeVideoExecutor({ op: 'debug', debugLevel });
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:openFile', async (_event, filePath) => {
  // Invoke native c++ handler
  try {
    const ret = await nativeVideoExecutor({ op: 'openFile', file: filePath });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:closeFile', async (_event, filePath) => {
  // Invoke native c++ handler
  try {
    const ret = await nativeVideoExecutor({ op: 'closeFile', file: filePath });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

const rifeModelFile = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'rife_v4.6.onnx')
    : path.join(__dirname, '../../native/rife/rife_v4.6.onnx');

const bowdetectModelFile = (fileName: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(__dirname, '../../native/bowdetect', fileName);

/** Copy of obj without keys whose value is undefined. */
const withoutUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;

ipcMain.handle('video:getFrame', async (_event, request: VideoFrameRequest) => {
  try {
    // console.log('Grabbing frame', JSON.stringify(request, null, 2));
    // seekPercent and toTimestamp are resolved to frameNum/tsMilli by the
    // renderer; commitGuard never crosses IPC.
    const {
      seekPercent: _seekPercent,
      toTimestamp: _toTimestamp,
      commitGuard: _commitGuard,
      frameNum,
      ...rest
    } = request;
    if (frameNum === undefined) {
      return { status: 'Missing frameNum field' };
    }
    const nativeRequest: GrabFrameRequest = {
      ...rest,
      frameNum,
      modelFile: request.interpMethod === 'rife' ? rifeModelFile() : undefined,
    };
    const ret = await nativeVideoExecutor({
      op: 'grabFrameAt',
      request: withoutUndefined(nativeRequest),
    });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle(
  'video:detectBow',
  async (_event, request: BowDetectionRequest) => {
    try {
      const numericOnly = request.numericOnly !== false;
      const result = await nativeVideoExecutor({
        op: 'detectBowAtFrame',
        request: {
          ...request,
          boatModelFile: bowdetectModelFile('crewtimer-boat-train.onnx'),
          cardModelFile: bowdetectModelFile('bow_card_detect.onnx'),
          numberModelFile: bowdetectModelFile(
            numericOnly ? 'bow_crnn_numeric.onnx' : 'bow_crnn.onnx',
          ),
        },
      });
      if (numericOnly) {
        result.detections = result.detections.map((detection) => ({
          ...detection,
          text: trimToCardLength(
            detection.text,
            request.cardLength,
            request.scheduledBows,
          ),
        }));
      }
      return result;
    } catch (err) {
      return { status: `${err instanceof Error ? err.message : err}` };
    }
  },
);
