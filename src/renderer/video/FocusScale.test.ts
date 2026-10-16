import { createFocusScale, focusWindow } from './FocusScale';

describe('focusWindow', () => {
  it('centers the window when there is room', () => {
    expect(focusWindow(600, 300, 240)).toEqual({ start: 180, end: 420 });
  });

  it('shifts the window to keep the full width near the end', () => {
    // 1 min from the end shows 3 min before and 1 min after.
    expect(focusWindow(600, 540, 240)).toEqual({ start: 360, end: 600 });
  });

  it('shifts the window to keep the full width near the start', () => {
    expect(focusWindow(600, 30, 240)).toEqual({ start: 0, end: 240 });
  });

  it('covers everything when the total is shorter than the window', () => {
    expect(focusWindow(100, 50, 240)).toEqual({ start: 0, end: 100 });
  });
});

describe('createFocusScale', () => {
  it('gives the focus window 60% of the width', () => {
    const scale = createFocusScale(3600, 1000, 1240);
    expect(scale.toPct(1240) - scale.toPct(1000)).toBeCloseTo(0.6);
    expect(scale.toPct(0)).toBe(0);
    expect(scale.toPct(3600)).toBeCloseTo(1);
  });

  it('splits the remaining width in proportion to time outside', () => {
    const scale = createFocusScale(3600, 1000, 1240);
    expect(scale.toPct(1000)).toBeCloseTo((0.4 * 1000) / 3360);
  });

  it('uses the full remaining width for one side at the end', () => {
    const scale = createFocusScale(3600, 3360, 3600);
    expect(scale.toPct(3360)).toBeCloseTo(0.4);
  });

  it('does not stretch short tails beyond the focus scale', () => {
    const scale = createFocusScale(300, 0, 240);
    // 60s outside at the focus scale is 0.15 of 0.75 total width.
    expect(scale.toPct(240)).toBeCloseTo(0.6 / 0.75);
  });

  it('is linear when there is nothing outside the window', () => {
    const scale = createFocusScale(200, 0, 200);
    expect(scale.toPct(50)).toBeCloseTo(0.25);
    expect(scale.fromPct(0.25)).toBeCloseTo(50);
  });

  it('inverts toPct with fromPct', () => {
    const scale = createFocusScale(3600, 1000, 1240);
    [0, 500, 1000, 1100, 1240, 2000, 3600].forEach((t) => {
      expect(scale.fromPct(scale.toPct(t))).toBeCloseTo(t);
    });
  });
});
