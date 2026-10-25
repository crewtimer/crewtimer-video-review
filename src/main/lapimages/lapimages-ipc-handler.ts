/**
 * Add ```import './lapimages/lapimages-ipc-handler';``` to [main.ts](../main.ts).
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { LapImageMeta } from '../../renderer/shared/AppTypes';
import {
  queueLapImage,
  queueLapImageDelete,
  startLapImageUploader,
} from './LapImageUploader';

ipcMain.handle(
  'lapimages:queueImage',
  (
    _event: IpcMainInvokeEvent,
    uuid: string,
    jpeg: Uint8Array,
    meta: LapImageMeta,
    thumbnail?: Uint8Array,
  ) => queueLapImage(uuid, jpeg, meta, thumbnail),
);
ipcMain.handle(
  'lapimages:queueDelete',
  (_event: IpcMainInvokeEvent, uuid: string) => queueLapImageDelete(uuid),
);
ipcMain.handle('lapimages:start', () => startLapImageUploader());
