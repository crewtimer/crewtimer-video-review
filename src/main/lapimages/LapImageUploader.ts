/**
 * Uploads lap images to Cloud Storage at ctvideo/{regattaID}/{uuid}.jpg, with
 * a thumbnail at {uuid}-tn.jpg.  A thumbnail is spooled as its own op named
 * {uuid}-tn so it is retried, superseded and deleted like any other image.
 *
 * Images and deletes are first written to a spool directory so they survive
 * restarts and offline periods, then transferred one at a time.  Writes are
 * authorized by a custom token from the CrewTimer /util get-storage-token op,
 * which is only issued for the regatta MobileKey (see storage.rules in
 * crewtimer-results).
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { Auth, getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  deleteObject,
  getStorage,
  ref,
  StorageError,
  uploadBytes,
} from 'firebase/storage';
import { firebaseApp } from '../../renderer/shared/FirebaseConfig';
import {
  LapImageStatusKey,
  N_UPLOAD_LAP_IMAGES,
} from '../../renderer/shared/Constants';
import { LapImageMeta, LapImageStatus } from '../../renderer/shared/AppTypes';
import {
  getConnectionProps,
  isDevMobileID,
  onPropertyChange,
} from '../../renderer/util/Util';
import Log from '../../renderer/util/Log';
import {
  getMobileID,
  getMobilePin,
  getUploadLapImages,
} from '../main-settings';
import { setMemValue } from '../store/store';
import { sendToCrewTimer } from '../lapstorage/LapSender';

const RETRY_MS = 20000;
const IMAGE_EXT = '.jpg';
const DELETE_EXT = '.del';
/** Custom metadata sidecar uploaded with the image (see LapImageMeta). */
const META_EXT = '.json';
/** Suffix for an op claimed by an in-flight transfer. */
const SENDING_EXT = '.sending';
/** Thumbnail name suffix, as written by scripts/make_thumbnails.py. */
const THUMB_SUFFIX = '-tn';
/** Cache-Control make_thumbnails.py sets on thumbnails. */
const THUMB_CACHE_CONTROL = 'public, max-age=86400';
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

let running = false;
let rerun = false;
let tmpCounter = 0;
/** Serializes spool writes with claims so a claim never splits an op from its metadata. */
let fsLock: Promise<unknown> = Promise.resolve();
const withFsLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = fsLock.then(fn);
  fsLock = run.catch(() => {});
  return run;
};
let retryTimer: NodeJS.Timeout | undefined;
/** `${mobileID}:${pin}` that the current Firebase sign-in was minted for. */
let signedInKey = '';
/** `${mobileID}:${pin}` the server refused a token for; skip until it changes. */
let rejectedKey = '';

const spoolRoot = () => path.join(app.getPath('userData'), 'ctvideo-images');

/** Spool directory for the current regatta, or undefined if none is set. */
const currentSpool = () => {
  const mobileID = getMobileID();
  if (!mobileID) return undefined;
  const { regattaID } = getConnectionProps(mobileID);
  if (!SAFE_NAME.test(regattaID)) return undefined;
  const env = isDevMobileID(mobileID) ? 'dev' : 'prod';
  return { mobileID, regattaID, dir: path.join(spoolRoot(), env, regattaID) };
};

const setStatus = (status: LapImageStatus) =>
  setMemValue<LapImageStatus>(LapImageStatusKey, status);

const listPending = async (dir: string) => {
  const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const pending = await Promise.all(
    names
      .filter((n) => n.endsWith(IMAGE_EXT) || n.endsWith(DELETE_EXT))
      .map(async (name) => {
        const stat = await fs.promises.stat(path.join(dir, name));
        return { name, mtime: stat.mtimeMs };
      }),
  );
  return pending.sort((a, b) => a.mtime - b.mtime).map((p) => p.name);
};

const ensureSignedIn = async (mobileID: string): Promise<Auth> => {
  const auth = getAuth(firebaseApp(mobileID));
  const authKey = `${mobileID}:${getMobilePin()}`;
  if (signedInKey === authKey && auth.currentUser) {
    return auth;
  }
  if (rejectedKey === authKey) {
    throw new Error('Admin pin required to upload images');
  }
  const result = await sendToCrewTimer([
    { uuid: 'storage-token', op: 'get-storage-token' },
  ]);
  if (!Array.isArray(result)) {
    throw new Error(`Token request failed: ${String(result)}`);
  }
  const { token, error } = (result[0] || {}) as {
    token?: string;
    error?: string;
  };
  if (!token) {
    if (error === 'Admin pin required') {
      rejectedKey = authKey;
    }
    throw new Error(error || 'No storage token returned');
  }
  await signInWithCustomToken(auth, token);
  signedInKey = authKey;
  return auth;
};

const readMeta = async (metaFile: string) => {
  try {
    return JSON.parse(
      await fs.promises.readFile(metaFile, 'utf8'),
    ) as LapImageMeta;
  } catch {
    return undefined;
  }
};

/** Files of an op moved aside for transfer. */
interface Claim {
  uuid: string;
  ext: string;
  file: string;
  meta?: string;
}

const exists = (file: string) =>
  fs.promises.access(file).then(
    () => true,
    () => false,
  );

/**
 * Move a committed op (and an image's metadata) to `.sending` names so a newer
 * spool for the same uuid lands on fresh files instead of being clobbered by
 * this transfer's cleanup.  Returns undefined if the op is already gone.
 */
const claim = (dir: string, uuid: string, ext: string) =>
  withFsLock(async (): Promise<Claim | undefined> => {
    const file = path.join(dir, `${uuid}${ext}`);
    try {
      await fs.promises.rename(file, `${file}${SENDING_EXT}`);
    } catch {
      return undefined;
    }
    let meta: string | undefined;
    if (ext === IMAGE_EXT) {
      const metaFile = path.join(dir, `${uuid}${META_EXT}`);
      meta = `${metaFile}${SENDING_EXT}`;
      await fs.promises.rename(metaFile, meta).catch(() => {});
    }
    return { uuid, ext, file: `${file}${SENDING_EXT}`, meta };
  });

/** Drop a claim's files after a successful transfer. */
const finishClaim = async ({ file, meta }: Claim) => {
  await fs.promises.unlink(file).catch(() => {});
  if (meta) await fs.promises.unlink(meta).catch(() => {});
};

/**
 * Return a claim to the queue after a failed or interrupted transfer, unless a
 * newer op for the same uuid was spooled meanwhile, which supersedes it.
 */
const releaseClaim = (dir: string, c: Claim) =>
  withFsLock(async () => {
    const superseded =
      (await exists(path.join(dir, `${c.uuid}${IMAGE_EXT}`))) ||
      (await exists(path.join(dir, `${c.uuid}${DELETE_EXT}`)));
    if (superseded) {
      await finishClaim(c);
      return;
    }
    await fs.promises
      .rename(c.file, path.join(dir, `${c.uuid}${c.ext}`))
      .catch(() => {});
    if (c.meta) {
      await fs.promises
        .rename(c.meta, path.join(dir, `${c.uuid}${META_EXT}`))
        .catch(() => {});
    }
  });

/** Requeue claims left by a transfer interrupted by quitting the app. */
const recoverClaims = async (dir: string) => {
  const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
  for (const ext of [IMAGE_EXT, DELETE_EXT]) {
    const suffix = `${ext}${SENDING_EXT}`;
    for (const name of names.filter((n) => n.endsWith(suffix))) {
      const uuid = name.slice(0, -suffix.length);
      const metaFile = path.join(dir, `${uuid}${META_EXT}${SENDING_EXT}`);
      // eslint-disable-next-line no-await-in-loop
      await releaseClaim(dir, {
        uuid,
        ext,
        file: path.join(dir, name),
        meta: ext === IMAGE_EXT ? metaFile : undefined,
      });
    }
  }
};

const transfer = async (mobileID: string, regattaID: string, c: Claim) => {
  const storage = getStorage(firebaseApp(mobileID));
  const objectRef = ref(storage, `ctvideo/${regattaID}/${c.uuid}${IMAGE_EXT}`);
  if (c.ext === DELETE_EXT) {
    try {
      await deleteObject(objectRef);
    } catch (e) {
      if ((e as StorageError).code !== 'storage/object-not-found') throw e;
    }
  } else {
    const data = await fs.promises.readFile(c.file);
    const customMetadata = c.meta ? await readMeta(c.meta) : undefined;
    await uploadBytes(objectRef, new Uint8Array(data), {
      contentType: 'image/jpeg',
      cacheControl: c.uuid.endsWith(THUMB_SUFFIX)
        ? THUMB_CACHE_CONTROL
        : undefined,
      customMetadata: customMetadata ? { ...customMetadata } : undefined,
    });
  }
};

const scheduleRetry = () => {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    // eslint-disable-next-line no-use-before-define
    processQueue();
  }, RETRY_MS);
};

/**
 * Transfer everything spooled for the current regatta.  Nothing is sent while
 * 'Upload scored result photos' is off; spooled ops wait until it is turned
 * back on.
 */
const processPending = async () => {
  if (!getUploadLapImages()) return;
  const spool = currentSpool();
  if (!spool) return;
  await recoverClaims(spool.dir);
  const pending = await listPending(spool.dir);
  setStatus({ pending: pending.length });
  if (pending.length === 0) return;

  const auth = await ensureSignedIn(spool.mobileID);
  for (const [index, name] of pending.entries()) {
    if (!getUploadLapImages()) break;
    const ext = path.extname(name);
    // eslint-disable-next-line no-await-in-loop
    const c = await claim(spool.dir, path.basename(name, ext), ext);
    if (c) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await transfer(spool.mobileID, spool.regattaID, c);
      } catch (e) {
        // eslint-disable-next-line no-await-in-loop
        await releaseClaim(spool.dir, c);
        if ((e as StorageError).code === 'storage/unauthorized') {
          // Token claims no longer match (e.g. regatta changed); mint a new one.
          signedInKey = '';
          // eslint-disable-next-line no-await-in-loop
          await auth.signOut().catch(() => {});
        }
        throw e;
      }
      // eslint-disable-next-line no-await-in-loop
      await finishClaim(c);
    }
    setStatus({ pending: pending.length - index - 1 });
  }
};

async function processQueue() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      // eslint-disable-next-line no-await-in-loop
      await processPending();
    } while (rerun);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Log.warn('LapImage', `Upload failed: ${msg}`);
    const spool = currentSpool();
    const pending = spool ? (await listPending(spool.dir)).length : 0;
    setStatus({ pending, error: msg });
    scheduleRetry();
  } finally {
    running = false;
  }
}

/**
 * Write an op atomically, replacing any pending op for the same uuid.  The
 * metadata sidecar is written first so the rename of the main file commits
 * both.  Runs under the fs lock so a claim never sees a half-written op.
 */
const writeSpool = async (
  dir: string,
  uuid: string,
  ext: string,
  data: Uint8Array,
  meta?: LapImageMeta,
) => {
  await fs.promises.mkdir(dir, { recursive: true });
  const other = ext === IMAGE_EXT ? DELETE_EXT : IMAGE_EXT;
  await fs.promises.unlink(path.join(dir, `${uuid}${other}`)).catch(() => {});
  const metaFile = path.join(dir, `${uuid}${META_EXT}`);
  if (meta) {
    await fs.promises.writeFile(metaFile, JSON.stringify(meta));
  } else {
    await fs.promises.unlink(metaFile).catch(() => {});
  }
  const file = path.join(dir, `${uuid}${ext}`);
  // Unique temp name so overlapping writes for one uuid cannot collide;
  // the last rename wins.
  tmpCounter += 1;
  const tmp = `${file}.${process.pid}-${tmpCounter}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
};

/** Spool an op for the current regatta and start transferring it. */
const spool = async (
  uuid: string,
  ext: string,
  data: Uint8Array,
  meta?: LapImageMeta,
) => {
  if (!getUploadLapImages()) return;
  const target = currentSpool();
  if (!target || !SAFE_NAME.test(uuid)) return;
  await withFsLock(() => writeSpool(target.dir, uuid, ext, data, meta));
  processQueue();
};

/** Queue a JPEG, and its thumbnail if given, for upload for lap `uuid`. */
export const queueLapImage = async (
  uuid: string,
  jpeg: Uint8Array,
  meta: LapImageMeta,
  thumbnail?: Uint8Array,
) => {
  await spool(uuid, IMAGE_EXT, jpeg, meta);
  if (thumbnail) {
    await spool(`${uuid}${THUMB_SUFFIX}`, IMAGE_EXT, thumbnail);
  }
};

/** Queue removal of the uploaded image and thumbnail for lap `uuid`. */
export const queueLapImageDelete = async (uuid: string) => {
  await spool(uuid, DELETE_EXT, new Uint8Array());
  await spool(`${uuid}${THUMB_SUFFIX}`, DELETE_EXT, new Uint8Array());
};

/**
 * Resume any transfers left over from a previous session, and again whenever
 * 'Upload scored result photos' is turned on.
 */
export const startLapImageUploader = () => {
  onPropertyChange(N_UPLOAD_LAP_IMAGES, () => processQueue());
  processQueue();
};
