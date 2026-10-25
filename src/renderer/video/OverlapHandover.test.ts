import { AppImage } from 'renderer/shared/AppTypes';
import { requestVideoFrame } from './RequestVideoFrame';
import { getFileStatusByName, getFileStatusList } from './VideoFileStatus';
import {
  consumeZoomPreservedFile,
  getImage,
  getVideoFrameNum,
  setImage,
  setVideoFile,
  setVideoFrameNum,
  getVideoScaling,
  setVideoScaling,
} from './VideoSettings';
import { FileStatus } from './VideoTypes';
import { moveLeft, moveRight } from './VideoUtils';

jest.mock('renderer/store/UseElectronDatum', () => {
  const { UseDatum } = jest.requireActual('react-usedatum');
  return {
    UseStoredDatum: (_key: string, initialValue: unknown) =>
      UseDatum(initialValue),
    UseMemDatum: (_key: string, initialValue: unknown) =>
      UseDatum(initialValue),
  };
});
jest.mock('./VideoFileStatus', () => ({
  getFileStatusByName: jest.fn(),
  getFileStatusList: jest.fn(),
  updateFileStatus: jest.fn(),
}));
jest.mock('./RequestVideoFrame', () => ({
  requestVideoFrame: jest.fn(),
  findSeekTarget: jest.fn(),
  seekToClickInFile: jest.fn(),
  seekToTimestamp: jest.fn(),
  seekToTimestampAndWait: jest.fn(),
}));

// 50fps files: A has frames at 1.00s..3.00s, B at 2.00s..4.00s, so a step
// from A frame 76 (2.50s) hands over to B frame 27.
const makeFile = (filename: string, startTime: number): FileStatus => ({
  open: true,
  numFrames: 101,
  filename,
  startTime,
  endTime: startTime + 2000000,
  duration: 2000000,
  fps: 50,
  tzOffset: 0,
  sidecar: {},
});
const files = [makeFile('a.mp4', 1000000), makeFile('b.mp4', 2000000)];

/** Mimics the request queue: a newer request supersedes the pending one. */
let pending: ((image: AppImage | undefined) => void) | undefined;
const resolveLatest = (image: AppImage | undefined) => {
  pending?.(image);
  pending = undefined;
};

const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('zoomed handover between overlapping files', () => {
  beforeEach(() => {
    (getFileStatusList as jest.Mock).mockReturnValue(files);
    (getFileStatusByName as jest.Mock).mockImplementation((name: string) =>
      files.find((file) => file.filename === name),
    );
    (requestVideoFrame as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLatest(undefined);
          pending = resolve;
        }),
    );
    setImage({
      ...getImage(),
      file: 'a.mp4',
      frameNum: 76,
      numFrames: 101,
      fps: 50,
      tsMicro: 2500000,
    });
    setVideoFile('a.mp4');
    setVideoFrameNum(76);
    setVideoScaling({ ...getVideoScaling(), zoomY: 5 });
    consumeZoomPreservedFile('');
  });

  it('keeps the zoom mark while a newer step still targets the new file', async () => {
    moveRight();
    expect(getVideoFrameNum()).toBe(27);
    // A second step before B displays supersedes the handover request.
    moveRight();
    expect(getVideoFrameNum()).toBe(28);
    await flush();
    expect(consumeZoomPreservedFile('b.mp4')).toBe(true);
  });

  it('drops the mark when stepping back to the displayed file', async () => {
    moveRight();
    (requestVideoFrame as jest.Mock).mockClear();
    setVideoFrameNum(27);
    // Stepping back from B frame 27 lands at 2.50s, which A owns.
    moveLeft();
    expect(requestVideoFrame).toHaveBeenCalledWith(
      expect.objectContaining({ videoFile: 'a.mp4', frameNum: 76 }),
    );
    await flush();
    expect(consumeZoomPreservedFile('b.mp4')).toBe(false);
  });
});
