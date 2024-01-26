import { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;
export const getMainWindow = () => mainWindow;
export const setMainWindow = (win: BrowserWindow | null) => {
  mainWindow = win;
};
