import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getMainWindow } from '../mainWindow';

const { exec } = require('child_process');

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

ipcMain.handle('rename-file', async (_event, from, to) => {
  return new Promise((resolve, _reject) => {
    fs.rename(from, to, (err: NodeJS.ErrnoException | null) => {
      if (err) {
        resolve({ error: err.message });
      } else {
        resolve({ error: '' });
      }
    });
  });
});

ipcMain.handle('mkdir', async (_event, directory) => {
  return new Promise((resolve, _reject) => {
    fs.mkdir(
      directory,
      { recursive: true },
      (err: NodeJS.ErrnoException | null) => {
        if (err) {
          resolve({ error: err.message });
        } else {
          resolve({ error: '' });
        }
      },
    );
  });
});

ipcMain.handle('open-file-dialog', async (_event) => {
  const result = await dialog.showOpenDialog(getMainWindow() as BrowserWindow, {
    properties: ['openFile'],
  });

  if (result.canceled) {
    return { cancelled: true, filePath: '' };
  }
  if (result.filePaths.length > 0) {
    return { cancelled: false, filePath: result.filePaths[0] };
  }
  return { cancelled: true, filePath: '' };
});

ipcMain.handle('open-dir-dialog', async (_event, title, defaultPath) => {
  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath,
    properties: ['openDirectory'],
  };
  const result = await dialog.showOpenDialog(
    getMainWindow() as BrowserWindow,
    options,
  );

  if (result.canceled) {
    return { cancelled: true, path: defaultPath };
  }
  if (result.filePaths.length > 0) {
    return { cancelled: false, path: result.filePaths[0] };
  }
  return { cancelled: true, path: defaultPath };
});

ipcMain.handle('get-files-in-directory', (_event, dirPath) => {
  return new Promise((resolve, _reject) => {
    fs.readdir(
      dirPath,
      (err: NodeJS.ErrnoException | null, files: string[]) => {
        if (err) {
          resolve({ error: err.message, files: [] });
        } else {
          resolve({ error: '', files });
        }
      },
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

function openFileExplorer(folderPath: string) {
  const { platform } = process;
  let command;

  if (platform === 'win32') {
    command = `explorer "${folderPath}"`;
  } else if (platform === 'darwin') {
    command = `open "${folderPath}"`;
  } else if (platform === 'linux') {
    command = `xdg-open "${folderPath}"`;
  }

  if (command) {
    exec(command, (error: any) => {
      if (error) {
        console.error('Error opening file explorer:', error);
      }
    });
  }
}

ipcMain.handle('open-file-explorer', (_event, dirPath) => {
  openFileExplorer(dirPath);
});

ipcMain.handle(
  'save-png-file',
  async (_event, defaultName: string, base64: string) => {
    const result = await dialog.showSaveDialog(
      getMainWindow() as BrowserWindow,
      {
        defaultPath: defaultName,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      },
    );
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: '' };
    }
    try {
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(result.filePath, buffer);
      return { canceled: false, filePath: result.filePath };
    } catch (err) {
      return {
        canceled: false,
        filePath: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);
