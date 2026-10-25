import {
  findTimeSegment,
  overlapHandover,
  ownedFrames,
  ownedRange,
} from './TimeSegmentUtils';
import { TimeSegment } from './VideoTypes';

const makeSegment = (
  startTsMicro: number,
  endTsMicro: number,
  fps = 50,
): TimeSegment => ({
  startTsMicro,
  endTsMicro,
  fps,
  startTime: '',
  endTime: '',
  label: '',
  pctOffset: 0,
  pct: 1,
});

describe('hint segment boundaries', () => {
  const first = makeSegment(1000000, 2000000);
  const next = makeSegment(2020000, 3000000);

  it('assigns a gap hint to the file with the nearer frame', () => {
    expect(findTimeSegment([first, next], 2010000).segment).toBe(first);
    expect(findTimeSegment([first, next], 2010001).segment).toBe(next);
    expect(findTimeSegment([first, next], 2020000).segment).toBe(next);
  });

  it('compares distances when files are closer than one frame apart', () => {
    const close = makeSegment(2018000, 3000000);
    expect(findTimeSegment([first, close], 2008000).segment).toBe(first);
    expect(findTimeSegment([first, close], 2009000).segment).toBe(first);
    expect(findTimeSegment([first, close], 2009001).segment).toBe(close);
    expect(findTimeSegment([first, close], 2010000).segment).toBe(close);
  });

  it('assigns the midpoint of a gap wider than one frame', () => {
    const wide = makeSegment(2022000, 3000000);
    expect(findTimeSegment([first, wide], 2011000).segment).toBe(first);
    expect(findTimeSegment([first, wide], 2011001).segment).toBe(wide);
  });

  it('includes hints within one frame interval of the first and last frames', () => {
    expect(findTimeSegment([first], 2000000).segment).toBe(first);
    expect(findTimeSegment([first], 2020000).segment).toBe(first);
    expect(findTimeSegment([first], 2020001).segment).toBeUndefined();
    expect(findTimeSegment([first], 1000000).segment).toBe(first);
    expect(findTimeSegment([first], 980000).segment).toBe(first);
    expect(findTimeSegment([first], 979999).segment).toBeUndefined();
  });

  it('uses each video frame rate and leaves larger gaps unassigned', () => {
    const fast = makeSegment(1000000, 2000000, 100);
    const far = makeSegment(2100000, 3000000);
    expect(findTimeSegment([fast, far], 2010000).segment).toBe(fast);
    expect(findTimeSegment([fast, far], 2010001).segment).toBeUndefined();
    expect(findTimeSegment([fast, far], 2079999).segment).toBeUndefined();
    expect(findTimeSegment([fast, far], 2080000).segment).toBe(far);
  });

  it('handles empty segments and unknown fps', () => {
    expect(findTimeSegment([], 1000000).segment).toBeUndefined();
    const noFps = makeSegment(1000000, 2000000, 0);
    expect(findTimeSegment([noFps], 1000000).segment).toBe(noFps);
    expect(findTimeSegment([noFps], 2000000).segment).toBe(noFps);
    expect(findTimeSegment([noFps], 999999).segment).toBeUndefined();
    expect(findTimeSegment([noFps], 2000001).segment).toBeUndefined();
  });
});

describe('overlapping files', () => {
  // A ends at 3s and B starts at 2s, so they overlap by 1s split at 2.5s.
  const a = makeSegment(1000000, 3000000);
  const b = makeSegment(2000000, 4000000);
  const c = makeSegment(4020000, 5000000);

  it('splits the overlap at its midpoint', () => {
    expect(findTimeSegment([a, b], 2000000).segment).toBe(a);
    expect(findTimeSegment([a, b], 2500000).segment).toBe(a);
    expect(findTimeSegment([a, b], 2500001).segment).toBe(b);
    expect(findTimeSegment([a, b], 3000000).segment).toBe(b);
    expect(findTimeSegment([a, b], 1500000).segment).toBe(a);
    expect(findTimeSegment([a, b], 3500000).segment).toBe(b);
  });

  it('mixes overlaps with gaps', () => {
    expect(findTimeSegment([a, b, c], 2600000).segmentIndex).toBe(1);
    expect(findTimeSegment([a, b, c], 4010000).segmentIndex).toBe(1);
    expect(findTimeSegment([a, b, c], 4010001).segmentIndex).toBe(2);
  });

  it('gives each file the range it owns', () => {
    expect(ownedRange([a, b, c], 0)).toEqual({
      startTsMicro: 1000000,
      endTsMicro: 2500000,
    });
    expect(ownedRange([a, b, c], 1)).toEqual({
      startTsMicro: 2500000,
      endTsMicro: 4000000,
    });
    expect(ownedRange([a, b, c], 2)).toEqual({
      startTsMicro: 4020000,
      endTsMicro: 5000000,
    });
  });

  // 50fps files: A has frames at 1.00s..3.00s, B at 2.00s..4.00s.
  const fileA = {
    startTime: 1000000,
    endTime: 3000000,
    numFrames: 101,
    fps: 50,
  };
  const fileB = {
    startTime: 2000000,
    endTime: 4000000,
    numFrames: 101,
    fps: 50,
  };
  const fileC = {
    startTime: 4020000,
    endTime: 5000000,
    numFrames: 50,
    fps: 50,
  };

  it('finds the frames each file owns', () => {
    // The frame at 2.5s (A frame 76, B frame 26) belongs to A.
    expect(ownedFrames([fileA, fileB, fileC], 0)).toEqual({
      first: 1,
      last: 76,
    });
    expect(ownedFrames([fileA, fileB, fileC], 1)).toEqual({
      first: 27,
      last: 101,
    });
    expect(ownedFrames([fileA, fileB, fileC], 2)).toEqual({
      first: 1,
      last: 50,
    });
    expect(ownedFrames([{ ...fileA, numFrames: 0 }, fileB], 0)).toBeUndefined();
  });

  it('hands over at the split at the same time', () => {
    const files = [fileA, fileB, fileC];
    expect(overlapHandover(files, 0, 76)).toBeUndefined();
    expect(overlapHandover(files, 0, 77)).toEqual({
      fileIndex: 1,
      frameNum: 27,
    });
    expect(overlapHandover(files, 0, 76.5)).toEqual({
      fileIndex: 1,
      frameNum: 26.5,
    });
    expect(overlapHandover(files, 1, 27)).toBeUndefined();
    expect(overlapHandover(files, 1, 26)).toEqual({
      fileIndex: 0,
      frameNum: 76,
    });
  });

  it('leaves files that do not overlap to the normal next and previous file', () => {
    const files = [fileA, fileB, fileC];
    expect(overlapHandover(files, 1, 102)).toBeUndefined();
    expect(overlapHandover(files, 2, 0)).toBeUndefined();
  });
});
