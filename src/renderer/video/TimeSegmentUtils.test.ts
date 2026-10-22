import { findTimeSegment } from './TimeSegmentUtils';
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
