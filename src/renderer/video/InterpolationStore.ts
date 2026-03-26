import { Lap } from 'crewtimer-common';
import { Rect } from 'renderer/shared/AppTypes';
import {
  Dir,
  getDirList,
  getTravelRightToLeft,
  getVideoFile,
  getVideoScaling,
  getVideoSettings,
} from './VideoSettings';

const STORE_FILENAME = 'interpolation.json';

export interface InterpolationRecord {
  version: 1;
  uuid: string;
  keyid: string;
  gate: string;
  eventNum: string;
  bow: string;
  time: string;
  videoFile: string;
  srcClickPoint: { x: number; y: number };
  srcCenterPoint: { x: number; y: number };
  trackingRegion: Rect;
  zoomY: number;
  autoZoomed: boolean;
  updatedAt: number;
}

interface InterpolationStoreFile {
  version: 1;
  records: { [uuid: string]: InterpolationRecord };
}

let cachedStorePath = '';
let cachedStore: InterpolationStoreFile | undefined;

const emptyStore = (): InterpolationStoreFile => ({
  version: 1,
  records: {},
});

const getPathParts = (filePath: string) => {
  const lastSeparator = Math.max(
    filePath.lastIndexOf('/'),
    filePath.lastIndexOf('\\'),
  );
  if (lastSeparator < 0) {
    return { dir: '', base: filePath };
  }
  return {
    dir: filePath.substring(0, lastSeparator),
    base: filePath.substring(lastSeparator + 1),
  };
};

const getActiveVideoFile = () => {
  const videoFile = getVideoFile();
  if (videoFile) {
    return videoFile;
  }
  return getDirList()[0] || '';
};

const getFinishGuide = () => {
  const finishGuide = getVideoSettings().guides.find(
    (guide) => guide.dir === Dir.Vert,
  );
  if (finishGuide?.enabled) {
    return finishGuide;
  }
  return { pt1: 0, pt2: 0 };
};

const getTrackingRegionSnapshot = (): Rect => {
  const videoScaling = getVideoScaling();
  const finishGuide = getFinishGuide();
  const height = Math.round((40 * videoScaling.srcHeight) / 1080 / 4) * 4;
  const width = Math.round((1.5 * height) / 4) * 4;
  const pxBeforeFinish = Math.round((5 * width) / 8 / 4) * 4;
  const clickPointX =
    videoScaling.srcWidth / 2 + (finishGuide.pt1 + finishGuide.pt2) / 2;
  return {
    x: Math.max(
      0,
      clickPointX -
        (getTravelRightToLeft() ? width - pxBeforeFinish : pxBeforeFinish),
    ),
    y: Math.max(0, videoScaling.srcClickPoint.y - height / 2),
    width,
    height,
  };
};

/**
 * Returns the folder-level interpolation store path for the provided video file.
 *
 * If no file is provided, the currently active video file is used. The store
 * lives beside the video files as `interpolation.json`.
 *
 * @param videoFile - Optional absolute path to a video file in the target folder.
 * @returns The absolute path to the interpolation store, or an empty string if no video file is available.
 */
export const getInterpolationStorePath = (videoFile?: string) => {
  const activeFile = videoFile || getActiveVideoFile();
  if (!activeFile) {
    return '';
  }
  const { dir } = getPathParts(activeFile);
  if (!dir) {
    return STORE_FILENAME;
  }
  return `${dir}/${STORE_FILENAME}`;
};

const readStore = async (videoFile?: string) => {
  const storePath = getInterpolationStorePath(videoFile);
  if (!storePath) {
    return { storePath: '', store: emptyStore() };
  }
  if (cachedStorePath === storePath && cachedStore) {
    return { storePath, store: cachedStore };
  }
  const result =
    await window.Util.readJsonFile<InterpolationStoreFile>(storePath);
  const store =
    result.status === 'OK' &&
    result.json &&
    typeof result.json === 'object' &&
    result.json.version === 1
      ? {
          version: 1 as const,
          records: result.json.records || {},
        }
      : emptyStore();
  if (
    result.status !== 'OK' ||
    !result.json ||
    typeof result.json !== 'object' ||
    result.json.version !== 1
  ) {
    cachedStorePath = storePath;
    cachedStore = store;
    return { storePath, store };
  }
  cachedStorePath = storePath;
  cachedStore = store;
  return { storePath, store };
};

const writeStore = async (storePath: string, store: InterpolationStoreFile) => {
  const tmpPath = `${storePath}.tmp`;
  const writeResult = await window.Util.storeJsonFile(tmpPath, store);
  if (writeResult.status !== 'OK') {
    throw new Error(writeResult.error || writeResult.status);
  }
  await window.Util.deleteFile(storePath).catch(() => ({ error: '' }));
  const renameResult = await window.Util.renameFile(tmpPath, storePath);
  if (renameResult.error) {
    await window.Util.deleteFile(tmpPath).catch(() => ({ error: '' }));
    throw new Error(renameResult.error);
  }
  cachedStorePath = storePath;
  cachedStore = store;
};

const createCurrentInterpolationRecord = (lap: Lap) => {
  const videoScaling = getVideoScaling();
  const hasClickPoint =
    Number.isFinite(videoScaling.srcClickPoint.x) &&
    Number.isFinite(videoScaling.srcClickPoint.y) &&
    (videoScaling.srcClickPoint.x !== 0 || videoScaling.srcClickPoint.y !== 0);
  if (
    !hasClickPoint ||
    videoScaling.srcWidth <= 1 ||
    videoScaling.srcHeight <= 1 ||
    !lap.Time ||
    !lap.uuid
  ) {
    return undefined;
  }
  const videoFile = getActiveVideoFile();
  if (!videoFile) {
    return undefined;
  }
  const { base } = getPathParts(videoFile);
  const zoomY = videoScaling.zoomY > 1 ? videoScaling.zoomY : 5;
  return {
    version: 1 as const,
    uuid: lap.uuid,
    keyid: lap.keyid,
    gate: lap.Gate,
    eventNum: lap.EventNum,
    bow: lap.Bow,
    time: lap.Time,
    videoFile: base,
    srcClickPoint: { ...videoScaling.srcClickPoint },
    srcCenterPoint: { ...videoScaling.srcCenterPoint },
    trackingRegion: getTrackingRegionSnapshot(),
    zoomY,
    autoZoomed: videoScaling.autoZoomed,
    updatedAt: Date.now(),
  };
};

/**
 * Persists the current interpolation snapshot for a scored lap.
 *
 * The record is written to the active folder's `interpolation.json` file and
 * the in-memory cache for that same folder is updated after a successful write.
 * If there is no usable interpolation context, any existing record for the lap
 * is removed instead.
 *
 * @param lap - The scored lap whose interpolation metadata should be stored.
 */
export const saveInterpolationRecordForLap = async (lap: Lap) => {
  const videoFile = getActiveVideoFile();
  if (!videoFile || !lap.uuid) {
    return;
  }
  const { storePath, store } = await readStore(videoFile);
  if (!storePath) {
    return;
  }
  const record = createCurrentInterpolationRecord(lap);
  const nextStore: InterpolationStoreFile = {
    version: store.version,
    records: { ...store.records },
  };
  if (record) {
    nextStore.records[lap.uuid] = record;
  } else if (nextStore.records[lap.uuid]) {
    delete nextStore.records[lap.uuid];
  } else {
    return;
  }
  await writeStore(storePath, nextStore);
};

/**
 * Loads previously saved interpolation metadata for a lap.
 *
 * The active folder cache is used when available; otherwise the current
 * folder's `interpolation.json` file is read from disk first.
 *
 * @param lap - The lap whose interpolation metadata should be retrieved.
 * @returns The saved interpolation record for the lap, if one exists.
 */
export const loadInterpolationRecordForLap = async (lap: Lap) => {
  if (!lap.uuid) {
    return undefined;
  }
  const { store } = await readStore();
  return store.records[lap.uuid];
};
