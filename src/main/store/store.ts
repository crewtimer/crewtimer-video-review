/**
 * Add ```import './store/store';``` to [main.ts](../main.ts).
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import Store from 'electron-store';
import { notifyChange } from '../../renderer/util/Util';
import { getMainWindow } from '../mainWindow';

/** Stored data instance for on-disk storage */
const store = new Store({
  name: 'ct-video-review', // this will create 'ct-video-review.json'
});

/** In-memory cache for settings */
const memCache = new Map<string, unknown>();

function isObject(value: any): value is { [key: string]: any } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Get a value persisted on disk.  An in-memory cache is used for quick lookup of values already
 * read from disk.
 * @param key The name of the value to query.
 * @param defaultValue The value to use if the key has not been previously persisted.
 * @returns defaultValue if the key has not been set previously.  Otherwise the previously set value.
 */
export function getStoredValue<T>(key: string, defaultValue: T): T {
  if (memCache.has(key)) {
    // console.log(`Read ${key} from cache`);
    return memCache.get(key) as T;
  }
  const value = store.get(key, defaultValue) as T;
  if (isObject(defaultValue)) {
    memCache.set(key, { ...defaultValue, ...value });
  } else {
    memCache.set(key, value);
  }

  // console.log(`Read ${key} from storage`);
  return value;
}

/**
 * Store a value in persistent storage.
 * @param key The name of the value to set.
 * @param value The value to store.
 */
export function setStoredValue<T>(
  key: string,
  value: T | undefined,
  main = true
) {
  // console.log(`setting stored ${key} from ${main ? 'main' : 'renderer'}`);
  const changed = memCache.get(key) !== value; // shallow compare
  if (value === undefined) {
    memCache.delete(key);
    store.delete(key);
  } else {
    memCache.set(key, value);
    store.set(key, value);
  }

  if (changed) {
    notifyChange(key);
  }

  if (main) {
    getMainWindow()?.webContents.send('stored-datum-update', key, value);
  }
}

/**
 * Get a value from the in-memory cache.
 * @param key The name of the value to query.
 * @param defaultValue The value to use if the key has not been previously set.
 * @returns defaultValue if the key has not been set previously.  Otherwise the previously set value.
 */
export function getMemValue<T>(key: string, defaultValue: T): T {
  if (memCache.has(key)) {
    const value = memCache.get(key) as T;
    if (isObject(defaultValue)) {
      return { ...defaultValue, ...value };
    } else {
      return value;
    }
  }
  return defaultValue;
}

/**
 * Store a value in memory.
 * @param key The name of the value to set.
 * @param value The value to store.
 */
export function setMemValue<T>(key: string, value: T | undefined, main = true) {
  // console.log(`setting mem ${key} from ${main ? 'main' : 'renderer'}`);
  if (value === undefined) {
    memCache.delete(key);
  } else {
    memCache.set(key, value);
  }
  notifyChange(key);

  if (main) {
    getMainWindow()?.webContents.send('datum-update', key, value);
  }
}

// Stored datum handlers (persisted)
ipcMain.handle(
  'store:get',
  (_event: IpcMainInvokeEvent, key: string, defaultValue: unknown) =>
    getStoredValue(key, defaultValue)
);
ipcMain.on(
  'store:set',
  (_event: IpcMainInvokeEvent, key: string, value: unknown) => {
    setStoredValue(key, value, false);
  }
);
ipcMain.on('store:delete', (_event: IpcMainInvokeEvent, key: string) => {
  setStoredValue(key, undefined, false);
});

// In memory datum handlers (not persisted)
ipcMain.handle(
  'mem:get',
  (_event: IpcMainInvokeEvent, key: string, defaultValue: unknown) =>
    getMemValue(key, defaultValue)
);
ipcMain.on(
  'mem:set',
  (_event: IpcMainInvokeEvent, key: string, value: unknown) => {
    setMemValue(key, value, false);
  }
);
ipcMain.on('mem:delete', (_event: IpcMainInvokeEvent, key: string) =>
  setMemValue(key, undefined, false)
);
