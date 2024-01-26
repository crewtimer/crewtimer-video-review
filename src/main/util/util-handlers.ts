import { getMainWindow } from '../mainWindow';

// eslint-disable-next-line import/prefer-default-export
export const userMessage = {
  info: (msg: string) => {
    getMainWindow()?.webContents.send('user-message', 'info', msg);
  },
};
