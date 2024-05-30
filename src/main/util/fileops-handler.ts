import { getMainWindow } from '../mainWindow';
import { BrowserWindow, dialog, ipcMain } from 'electron';

const fs = require('fs');

ipcMain.handle('delete-file', async (_event, filename) => {
  return new Promise((resolve, _reject) => {
    fs.unlink(filename, (err: NodeJS.ErrnoException | null) => {
      if (err) {
        resolve({ error: err.message });
      } else {
        resolve({ error: '' });
      }
    });
  });
});

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

ipcMain.handle('read-json-file', (_event, filePath) => {
  try {
    //
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return { status: 'OK', json: JSON.parse(fileContents) };
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('store-json-file', (_event, filePath, json) => {
  try {
    //
    const fileContents = JSON.stringify(json, null, 2);
    fs.writeFileSync(filePath, fileContents, 'utf8');
    return { status: 'OK' };
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});
