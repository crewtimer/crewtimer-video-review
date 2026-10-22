import { calculateSeekFrame, findSeekTarget } from './RequestVideoFrame';
import { getFileStatusList } from './VideoFileStatus';
import { FileStatus } from './VideoTypes';

jest.mock('renderer/store/UseElectronDatum', () => {
  const { UseDatum } = jest.requireActual('react-usedatum');
  return {
    UseStoredDatum: (_key: string, initialValue: unknown) =>
      UseDatum(initialValue),
    UseMemDatum: (_key: string, initialValue: unknown) =>
      UseDatum(initialValue),
  };
});
jest.mock('./Sidecar', () => ({ saveVideoSidecar: jest.fn() }));
jest.mock('./VideoFileStatus', () => ({
  getFileStatusByName: jest.fn(),
  getFileStatusList: jest.fn(),
  updateFileStatus: jest.fn(),
}));

// 22:13:20.000 UTC
const START_MICRO = 1700000000000000;

const makeFile = (
  filename: string,
  startOffsetMicro: number,
  durationMicro: number,
  tzOffset = 0,
): FileStatus => ({
  open: false,
  numFrames: Math.round((durationMicro * 50) / 1000000) + 1,
  filename,
  startTime: START_MICRO + startOffsetMicro,
  endTime: START_MICRO + startOffsetMicro + durationMicro,
  duration: durationMicro,
  fps: 50,
  tzOffset,
  sidecar: {},
});

describe('calculateSeekFrame', () => {
  const file = makeFile('a.mp4', 0, 10000000);

  it('keeps a time inside the file', () => {
    expect(
      calculateSeekFrame(file, undefined, undefined, '22:13:25.000').utcMilli,
    ).toBe(START_MICRO / 1000 + 5000);
  });

  it('clamps a time past either end to that end frame', () => {
    expect(
      calculateSeekFrame(file, undefined, undefined, '22:13:30.010').utcMilli,
    ).toBe(START_MICRO / 1000 + 10000);
    expect(
      calculateSeekFrame(file, undefined, undefined, '22:13:19.990').utcMilli,
    ).toBe(START_MICRO / 1000);
  });

  it('resolves a local time after midnight east of UTC', () => {
    // 22:13:20Z is 00:13:20 local at UTC+02:00.
    const east = makeFile('a.mp4', 0, 10000000, 120);
    expect(
      calculateSeekFrame(east, undefined, undefined, '00:13:25.000'),
    ).toEqual({ seekPos: 251, utcMilli: START_MICRO / 1000 + 5000 });
  });

  it('resolves a local time west of UTC', () => {
    // 22:13:20Z is 15:13:20 local at UTC-07:00.
    const west = makeFile('a.mp4', 0, 10000000, -420);
    expect(
      calculateSeekFrame(west, undefined, undefined, '15:13:25.000'),
    ).toEqual({ seekPos: 251, utcMilli: START_MICRO / 1000 + 5000 });
  });

  it('resolves a time after midnight in a file spanning UTC midnight', () => {
    // Starts 23:59:55Z.
    const spanning = makeFile('a.mp4', 6395000000, 10000000);
    expect(
      calculateSeekFrame(spanning, undefined, undefined, '00:00:02.000'),
    ).toEqual({
      seekPos: 351,
      utcMilli: START_MICRO / 1000 + 6395000 + 7000,
    });
  });

  it('resolves a time after midnight in a file spanning local midnight', () => {
    // Starts 21:59:55Z, which is 23:59:55 local at UTC+02:00.
    const spanning = makeFile('a.mp4', -805000000, 10000000, 120);
    expect(
      calculateSeekFrame(spanning, undefined, undefined, '00:00:02.000'),
    ).toEqual({
      seekPos: 351,
      utcMilli: START_MICRO / 1000 - 805000 + 7000,
    });
  });
});

describe('findSeekTarget', () => {
  beforeEach(() => {
    (getFileStatusList as jest.Mock).mockReturnValue([
      makeFile('a.mp4', 0, 10000000),
      makeFile('b.mp4', 10030000, 10000000),
    ]);
  });

  it('seeks to a time inside a file unchanged', () => {
    expect(findSeekTarget('22:13:25.000')).toEqual({
      time: '22:13:25.000',
      videoFile: 'a.mp4',
      fileIndex: 0,
    });
  });

  it('moves a time between files onto the nearer edge frame', () => {
    expect(findSeekTarget('22:13:30.010')).toEqual({
      time: '22:13:30.000',
      videoFile: 'a.mp4',
      fileIndex: 0,
    });
    expect(findSeekTarget('22:13:30.025')).toEqual({
      time: '22:13:30.030',
      videoFile: 'b.mp4',
      fileIndex: 1,
    });
  });

  it('finds nothing more than one frame from every file', () => {
    expect(findSeekTarget('22:14:00.000')).toBeUndefined();
  });
});
