/**
 * Add ```import './finishlynx/FinishLynxIPCHandler';``` to [main.ts](../main.ts).
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { setMemValue } from '../store/store';
import { LynxFolderOK } from '../../renderer/shared/FinishLynx';
import { startLynxServer, stopLynxServer } from './FinishLynxServer';
import {
  chooseLynxFolder,
  generateEvtFiles,
  refreshLynxLssFile,
} from './FinishLynx';

const fs = require('fs');

ipcMain.handle('finishlynx:start', () => {
  startLynxServer();
});
ipcMain.handle('finishlynx:stop', () => {
  stopLynxServer();
});
ipcMain.handle('finishlynx:chooseLynxFolder', () => {
  chooseLynxFolder();
});
ipcMain.handle('finishlynx:generateEvtFiles', () => {
  generateEvtFiles();
});

// FIXME - Not needed anymore as an IPC?
ipcMain.handle(
  'finishlynx:validateLynxFolder',
  (_event: IpcMainInvokeEvent, folder: string) => {
    fs.access(folder, (err: unknown) => {
      const ok = !err;
      setMemValue(LynxFolderOK, ok);
      refreshLynxLssFile(folder);
    });
  }
);
