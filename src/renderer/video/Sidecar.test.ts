import { sidecarFileChanged } from './Sidecar';

jest.mock('./VideoFileStatus', () => ({
  getFileStatusByName: () => undefined,
}));
jest.mock('./VideoSettings', () => ({
  getTravelRightToLeft: () => false,
  getVideoFile: () => '',
  getVideoSettings: () => ({}),
}));

const measured = {
  startTs: '1774796070.839386',
  stopTs: '1774796074.822719',
  numFrames: 240,
  fps: 60,
  tzOffset: -420,
};

describe('sidecarFileChanged', () => {
  test('ignores a different way of writing the same times', () => {
    expect(
      sidecarFileChanged(
        {
          ...measured,
          startTs: '1774796070.8393860',
          stopTs: '1774796074.8227190',
        },
        measured,
      ),
    ).toBe(false);
  });

  test('finds a missing file section or fps', () => {
    expect(sidecarFileChanged(undefined, measured)).toBe(true);
    const { fps, ...withoutFps } = measured;
    expect(fps).toBe(60);
    expect(sidecarFileChanged(withoutFps, measured)).toBe(true);
  });

  test('finds a changed time, frame count or time zone', () => {
    expect(
      sidecarFileChanged({ ...measured, stopTs: '1774796074.80606' }, measured),
    ).toBe(true);
    expect(sidecarFileChanged({ ...measured, numFrames: 239 }, measured)).toBe(
      true,
    );
    expect(sidecarFileChanged({ ...measured, tzOffset: -480 }, measured)).toBe(
      true,
    );
  });
});
