/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lapimages-test-'));
const uploads: { name: string; data: string; meta?: Record<string, string> }[] =
  [];
let releaseFirstUpload: () => void = () => {};
let firstUploadStarted = false;
let uploadEnabled = true;

jest.mock('electron', () => ({ app: { getPath: () => userData } }));
jest.mock('../store/store', () => ({ setMemValue: jest.fn() }));
jest.mock('../main-settings', () => ({
  getMobileID: () => 't.r16305',
  getMobilePin: () => 'pin',
  getUploadLapImages: () => uploadEnabled,
}));
jest.mock('../lapstorage/LapSender', () => ({
  sendToCrewTimer: async () => [{ code: 'OK', token: 'token' }],
}));
jest.mock('../../renderer/shared/FirebaseConfig', () => ({
  firebaseApp: () => ({}),
}));
jest.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: {}, signOut: async () => {} }),
  signInWithCustomToken: async () => {},
}));
jest.mock('firebase/storage', () => ({
  getStorage: () => ({}),
  ref: (_storage: unknown, name: string) => ({ name }),
  deleteObject: async () => {},
  uploadBytes: async (
    objectRef: { name: string },
    data: Uint8Array,
    metadata: { customMetadata?: Record<string, string> },
  ) => {
    if (uploads.length === 0) {
      // Hold the first upload open so a correction is spooled mid-transfer.
      await new Promise<void>((resolve) => {
        releaseFirstUpload = resolve;
        firstUploadStarted = true;
      });
    }
    uploads.push({
      name: objectRef.name,
      data: new TextDecoder().decode(data),
      meta: metadata.customMetadata,
    });
  },
}));

// eslint-disable-next-line import/first
import { queueLapImage, queueLapImageDelete } from './LapImageUploader';

const meta = (time: string) => ({
  gate: 'F',
  eventNum: '1',
  bow: '3',
  time,
});

const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
};

afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

describe('LapImageUploader', () => {
  it('uploads a correction spooled while the original is in flight', async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    await queueLapImage('abc', encode('original'), meta('10:00:00.000'));
    await waitFor(() => firstUploadStarted);
    expect(firstUploadStarted).toBe(true);
    await queueLapImage('abc', encode('corrected'), meta('10:00:00.100'));
    releaseFirstUpload();
    await waitFor(() => uploads.length >= 2);

    expect(uploads.map((u) => u.data)).toEqual(['original', 'corrected']);
    expect(uploads[0].meta?.time).toBe('10:00:00.000');
    expect(uploads[1].meta?.time).toBe('10:00:00.100');
    expect(uploads[1].name).toBe('ctvideo/r16305/abc.jpg');
    const dir = path.join(userData, 'ctvideo-images', 'dev', 'r16305');
    await waitFor(() => fs.readdirSync(dir).length === 0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('LapImageUploader when uploads are off', () => {
  it('does not spool or send anything', async () => {
    uploadEnabled = false;
    const before = uploads.length;
    await queueLapImage(
      'off',
      new TextEncoder().encode('ignored'),
      meta('10:00:01.000'),
    );
    await queueLapImageDelete('off2');
    const dir = path.join(userData, 'ctvideo-images', 'dev', 'r16305');
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(names.filter((n) => n.startsWith('off'))).toEqual([]);
    expect(uploads.length).toBe(before);
    uploadEnabled = true;
  });
});
