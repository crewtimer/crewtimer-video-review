import { GrabFrameMessage, nativeVideoExecutor } from 'crewtimer_video_reader';
import { ipcMain } from 'electron';
import { VideoFrameRequest } from 'renderer/shared/AppTypes';

export function stopVideoServices(_name: string) {}

export function startVideoServices() {}

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

ipcMain.handle('video:getFrame', (_event, request: VideoFrameRequest) => {
  try {
    // console.log('Grabbing frame', JSON.stringify(request, null, 2));
    const ret = nativeVideoExecutor({
      op: 'grabFrameAt',
      // clean request of undefined keys
      request: Object.fromEntries(
        Object.entries(request).filter(([_, v]) => v !== undefined),
      ),
    } as unknown as GrabFrameMessage);
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});
