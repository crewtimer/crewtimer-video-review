/**
 * Piecewise-linear scale that maps a time axis [0, total] onto [0, 1] so that
 * a focus window gets a fixed fraction of the width and the time before and
 * after it is compressed into the remaining space.
 */
export interface FocusScale {
  /** Map a time (same units as total) to a fraction 0..1 of the width. */
  toPct: (time: number) => number;
  /** Map a fraction 0..1 of the width back to a time. */
  fromPct: (pct: number) => number;
}

/**
 * Picks a focus window of the given width centered on `center`, shifted as
 * needed to stay within [0, total] so the full width is always shown.
 */
export const focusWindow = (total: number, center: number, width: number) => {
  if (width >= total) {
    return { start: 0, end: total };
  }
  const start = Math.min(Math.max(0, center - width / 2), total - width);
  return { start, end: start + width };
};

/**
 * Creates a scale where [focusStart, focusEnd] occupies `focusFraction` of
 * the width. Time outside the window is never drawn at a larger scale than
 * the window itself, so short tails are not stretched.
 */
export const createFocusScale = (
  total: number,
  focusStart: number,
  focusEnd: number,
  focusFraction = 0.6,
): FocusScale => {
  const focus = focusEnd - focusStart;
  const outside = total - focus;
  if (total <= 0 || focus <= 0 || outside <= 0) {
    const span = total > 0 ? total : 1;
    return {
      toPct: (time) => Math.min(1, Math.max(0, time / span)),
      fromPct: (pct) => Math.min(1, Math.max(0, pct)) * span,
    };
  }
  const focusScale = focusFraction / focus;
  const outsideScale = Math.min(focusScale, (1 - focusFraction) / outside);
  const beforeWidth = focusStart * outsideScale;
  const focusWidth = focus * focusScale;
  const afterWidth = (total - focusEnd) * outsideScale;
  const norm = beforeWidth + focusWidth + afterWidth;
  const b1 = beforeWidth / norm;
  const b2 = (beforeWidth + focusWidth) / norm;

  const toPct = (time: number) => {
    const t = Math.min(total, Math.max(0, time));
    if (t < focusStart) {
      return (t * outsideScale) / norm;
    }
    if (t <= focusEnd) {
      return b1 + ((t - focusStart) * focusScale) / norm;
    }
    return b2 + ((t - focusEnd) * outsideScale) / norm;
  };

  const fromPct = (pct: number) => {
    const p = Math.min(1, Math.max(0, pct));
    if (p < b1) {
      return (p * norm) / outsideScale;
    }
    if (p <= b2) {
      return focusStart + ((p - b1) * norm) / focusScale;
    }
    return focusEnd + ((p - b2) * norm) / outsideScale;
  };

  return { toPct, fromPct };
};
