/**
 * Add ```import './firebase/firebase-ipc-handler';``` to [main.ts](../main.ts).
 */
import { ipcMain } from 'electron';
import { startFirebase, stopFirebase } from './FirebaseServices';

ipcMain.handle('firebase:start', () => {
  startFirebase();
});
ipcMain.handle('firebase:stop', () => {
  stopFirebase();
});
