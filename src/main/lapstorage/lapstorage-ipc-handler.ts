/**
 * Add ```import './lapstorage/lapstorage-ipc-handler';``` to [main.ts](../main.ts).
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { Lap } from 'crewtimer-common';
import LapStorage, { startLapStorage, stopLapStorage } from './LapStorage';
import { queueLapForTx } from './LapSender';

ipcMain.handle(
  'lapstorage:updateLapFields',
  (
    _event: IpcMainInvokeEvent,
    fields: { uuid: string; [key: string]: string }
  ) => LapStorage.updateLapFields(fields)
);

ipcMain.handle('lapstorage:updateLap', (_event: IpcMainInvokeEvent, lap: Lap) =>
  LapStorage.updateLapAndSend(lap)
);

ipcMain.handle('lapstorage:start', () => startLapStorage(queueLapForTx));
ipcMain.handle('lapstorage:stop', () => stopLapStorage());
ipcMain.handle('lapstorage:truncateLapTable', () =>
  LapStorage.truncateLapTable()
);
