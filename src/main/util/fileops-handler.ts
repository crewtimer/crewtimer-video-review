import { getMainWindow } from '../mainWindow';
import { BrowserWindow, dialog, ipcMain } from 'electron';

const fs = require('fs');

ipcMain.handle('open-file-dialog', async (_event) => {
  let result = await dialog.showOpenDialog(getMainWindow() as BrowserWindow, {
    properties: ['openFile'],
  });

  if (result.canceled) {
    return { cancelled: true, filePath: '' };
  } else if (result.filePaths.length > 0) {
    return { cancelled: false, filePath: result.filePaths[0] };
  } else {
    return { cancelled: true, filePath: '' };
  }
});

ipcMain.handle('open-dir-dialog', async (_event, title, defaultPath) => {
  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath,
    properties: ['openDirectory'],
  };
  let result = await dialog.showOpenDialog(
    getMainWindow() as BrowserWindow,
    options
  );

  if (result.canceled) {
    return { cancelled: true, path: defaultPath };
  } else if (result.filePaths.length > 0) {
    return { cancelled: false, path: result.filePaths[0] };
  } else {
    return { cancelled: true, path: defaultPath };
  }
});

ipcMain.handle('get-files-in-directory', (_event, dirPath) => {
  return new Promise((resolve, _reject) => {
    fs.readdir(
      dirPath,
      (err: NodeJS.ErrnoException | null, files: string[]) => {
        if (err) {
          resolve({ error: err.message, files: [] });
        } else {
          resolve({ error: '', files: files });
        }
      }
    );
  });
});
