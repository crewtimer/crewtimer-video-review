import {
  applyZoomTransform,
  guideContactRows,
  guideNonWaterSpans,
} from './ZoomTransform';

const W = 20;
const H = 20;
const all = { x: 0, y: 0, width: W, height: H };

/** RGBA frame filled by color(x, y). */
const makeFrame = (color: (x: number, y: number) => number[]) => {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = color(x, y);
      pixels.set([r, g, b, 255], (y * W + x) * 4);
    }
  }
  return pixels;
};
const pixelAt = (pixels: Uint8ClampedArray, x: number, y: number) =>
  Array.from(pixels.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

describe('applyZoomTransform', () => {
  it('returns the input unchanged when off', () => {
    const pixels = makeFrame((x, y) => [x * 10, y * 10, 77]);
    const copy = new Uint8ClampedArray(pixels);
    const out = applyZoomTransform(pixels, W, H, all, 'off');
    expect(out).toBe(pixels);
    expect(out).toEqual(copy);
  });

  it('auto-levels stretches the 1st and 99th percentiles to 0 and 255', () => {
    // Grey ramp 100..195 across the frame, so 1% and 99% land at its ends.
    const pixels = makeFrame((x, y) => {
      const v = 100 + Math.floor(((y * W + x) * 96) / (W * H));
      return [v, v, v];
    });
    const copy = new Uint8ClampedArray(pixels);
    const out = applyZoomTransform(pixels, W, H, all, 'autoLevels');
    expect(pixelAt(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(out, W - 1, H - 1)).toEqual([255, 255, 255, 255]);
    expect(pixels).toEqual(copy);
  });

  it('auto-levels leaves a flat image unchanged', () => {
    const pixels = makeFrame(() => [120, 125, 128]);
    const out = applyZoomTransform(pixels, W, H, all, 'autoLevels');
    expect(out).toEqual(pixels);
  });

  it('water contrast darkens water and brightens a blue block', () => {
    const inBlock = (x: number, y: number) =>
      x >= 8 && x < 12 && y >= 8 && y < 12;
    const pixels = makeFrame((x, y) =>
      inBlock(x, y) ? [0, 0, 255] : [128, 128, 128],
    );
    const out = applyZoomTransform(pixels, W, H, all, 'water');
    expect(pixelAt(out, 2, 2)[0]).toBeLessThan(10);
    expect(pixelAt(out, 10, 10)[0]).toBeGreaterThan(245);
    const [r, g, b, a] = pixelAt(out, 10, 10);
    expect([g, b, a]).toEqual([r, r, 255]);
  });

  it('water contrast takes water from the border when the view is mostly boat', () => {
    const inHull = (x: number, y: number) =>
      x >= 3 && x < W - 3 && y >= 3 && y < H - 3;
    const pixels = makeFrame((x, y) =>
      inHull(x, y) ? [220, 40, 40] : [40, 90, 120],
    );
    const out = applyZoomTransform(pixels, W, H, all, 'water');
    expect(pixelAt(out, 0, 0)[0]).toBeLessThan(10);
    expect(pixelAt(out, 10, 10)[0]).toBeGreaterThan(245);
  });

  it('only transforms the visible rectangle', () => {
    const pixels = makeFrame((x) => (x < 10 ? [128, 128, 128] : [0, 0, 255]));
    const out = applyZoomTransform(
      pixels,
      W,
      H,
      { x: 5, y: 0, width: 10, height: H },
      'water',
    );
    expect(pixelAt(out, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(out, W - 1, 0)).toEqual([0, 0, 255, 255]);
  });
});

describe('guideNonWaterSpans', () => {
  // Large enough for a hull to be a big patch and the view mostly water.
  const GW = 80;
  const GH = 60;
  const water = [40, 90, 120];
  const hull = [230, 230, 230];
  const frame = (color: (x: number, y: number) => number[]) => {
    const pixels = new Uint8ClampedArray(GW * GH * 4);
    for (let y = 0; y < GH; y += 1) {
      for (let x = 0; x < GW; x += 1) {
        pixels.set([...color(x, y), 255], (y * GW + x) * 4);
      }
    }
    return pixels;
  };
  const view = { x: 0, y: 0, width: GW, height: GH };
  // Hull rows 20..29 from x = 40 rightwards, with a one-row bow tip at row 24
  // reaching left to x = 31.
  const boat = (x: number, y: number) =>
    (y >= 20 && y < 30 && x >= 40) || (y === 24 && x >= 31);

  it('marks the rows where the guide crosses a hull', () => {
    const pixels = frame((x, y) => (boat(x, y) ? hull : water));
    expect(guideNonWaterSpans(pixels, GW, GH, view, 50, 50)).toEqual([
      { y0: 20, y1: 30 },
    ]);
  });

  it('marks a bow tip on the line, not one with water before it', () => {
    // The boat travels right to left; its tip's first pixel spans x 31..32.
    const pixels = frame((x, y) => (boat(x, y) ? hull : water));
    const spans = (x: number) =>
      guideNonWaterSpans(pixels, GW, GH, view, x, x, -1);
    expect(spans(31.5)).toEqual([{ y0: 24, y1: 25 }]);
    expect(spans(31)).toEqual([{ y0: 24, y1: 25 }]);
    // One pixel of water between the line and the tip.
    expect(spans(30.5)).toEqual([]);
    expect(spans(30.99)).toEqual([]);
  });

  it('marks a tip on the line for left-to-right travel', () => {
    // The same boat pointing right, so its tip's front pixel is x = 48.
    const pixels = frame((x, y) => (boat(GW - 1 - x, y) ? hull : water));
    const spans = (x: number, step: 1 | -1) =>
      guideNonWaterSpans(pixels, GW, GH, view, x, x, step);
    expect(spans(48.5, 1)).toEqual([{ y0: 24, y1: 25 }]);
    // Line in pixel 49, just ahead of the tip: not yet touching.
    expect(spans(49.5, 1)).toEqual([]);
  });

  it('marks a bow cut off from its hull by a dark seam', () => {
    // A 5 x 12 bow piece, then a water-coloured seam, then the hull.
    const pixels = frame((x, y) =>
      y >= 20 && y < 32 && ((x >= 30 && x < 35) || x >= 36) ? hull : water,
    );
    expect(guideNonWaterSpans(pixels, GW, GH, view, 32, 32, -1)).toEqual([
      { y0: 20, y1: 32 },
    ]);
  });

  it('follows a tilted guide', () => {
    const pixels = frame((x, y) => (boat(x, y) ? hull : water));
    // From x = 20 at the top to x = 80 at the bottom: x 40..50 in rows 20..29.
    expect(guideNonWaterSpans(pixels, GW, GH, view, 20, 80)).toEqual([
      { y0: 20, y1: 30 },
    ]);
  });

  it('ignores wave glints, even wide ones only a few rows tall', () => {
    const pixels = frame((x, y) =>
      (y === 10 && x >= 20 && x < 60) ||
      (y >= 40 && y < 43 && x >= 10 && x < 70)
        ? hull
        : water,
    );
    expect(guideNonWaterSpans(pixels, GW, GH, view, 50, 50)).toEqual([]);
  });
});

describe('guideNonWaterSpans on calm water', () => {
  // Calm grey water with a light grey hull only 4 rows tall at this distance.
  const CW = 200;
  const CH = 60;
  const calmFrame = (hullFrom: number, hullTo: number) => {
    const pixels = new Uint8ClampedArray(CW * CH * 4);
    for (let y = 0; y < CH; y += 1) {
      for (let x = 0; x < CW; x += 1) {
        const v = y >= 30 && y < 34 && x >= hullFrom && x < hullTo ? 150 : 110;
        pixels.set([v, v, v, 255], (y * CW + x) * 4);
      }
    }
    return pixels;
  };
  const view = { x: 0, y: 0, width: CW, height: CH };

  it('marks a long, low-contrast hull only a few rows tall', () => {
    const pixels = calmFrame(40, 200);
    expect(guideNonWaterSpans(pixels, CW, CH, view, 45, 45, -1)).toEqual([
      { y0: 30, y1: 34 },
    ]);
    expect(guideNonWaterSpans(pixels, CW, CH, view, 38.5, 38.5, -1)).toEqual(
      [],
    );
  });

  it('ignores a short patch of the same height', () => {
    const pixels = calmFrame(40, 100);
    expect(guideNonWaterSpans(pixels, CW, CH, view, 45, 45, -1)).toEqual([]);
  });
});

describe('guideNonWaterSpans on choppy water', () => {
  const W2 = 80;
  const H2 = 60;
  const view = { x: 0, y: 0, width: W2, height: H2 };
  // Water of three greys, so the typical water distance and threshold are
  // high. A white hull in rows 20..29 from x = 40, with a faint light streak
  // in row 29 joining it from x = 30, such as a smear beside the bow.
  const pixels = new Uint8ClampedArray(W2 * H2 * 4);
  for (let y = 0; y < H2; y += 1) {
    for (let x = 0; x < W2; x += 1) {
      let v = [100, 120, 140][(x + y) % 3];
      if (y >= 20 && y < 30 && x >= 40) v = 255;
      else if (y === 29 && x >= 30) v = 190;
      pixels.set([v, v, v, 255], (y * W2 + x) * 4);
    }
  }

  it('does not count a faint streak joined to the hull as contact', () => {
    expect(guideNonWaterSpans(pixels, W2, H2, view, 35, 35, -1)).toEqual([]);
  });

  it('counts the hull itself', () => {
    expect(guideNonWaterSpans(pixels, W2, H2, view, 45, 45, -1)).toEqual([
      { y0: 20, y1: 30 },
    ]);
  });
});

describe('guideNonWaterSpans with dark reflections in view', () => {
  // Light water with dark ripple bands, a large dark reflection filling the
  // bottom third of the view, and a small dark bow ball on light water.
  const W4 = 120;
  const H4 = 90;
  const view = { x: 0, y: 0, width: W4, height: H4 };
  const pixels = new Uint8ClampedArray(W4 * H4 * 4);
  for (let y = 0; y < H4; y += 1) {
    for (let x = 0; x < W4; x += 1) {
      let v = y % 6 < 2 ? 70 : 120;
      if (y >= 63) v = 20 + (y % 3) * 5;
      if (y >= 20 && y < 28 && x >= 60 && x < 68) v = 15;
      if (y >= 22 && y < 26 && x >= 68) v = 230;
      pixels.set([v, v, v, 255], (y * W4 + x) * 4);
    }
  }

  it('marks a dark bow ball against the light water beside it', () => {
    const spans = guideNonWaterSpans(pixels, W4, H4, view, 62.5, 62.5, -1);
    expect(spans.some(({ y0, y1 }) => y0 <= 21 && y1 >= 27)).toBe(true);
  });

  it('does not mark the water just ahead of the ball', () => {
    const spans = guideNonWaterSpans(pixels, W4, H4, view, 50.5, 50.5, -1);
    expect(spans.filter(({ y0 }) => y0 < 63)).toEqual([]);
  });
});

describe('guideContactRows with a fixed stats area', () => {
  // Choppy water in rows 0..44, calm water below, and a faint hull from
  // x = 60 in rows 40..49 on the boundary. Against calm water the hull
  // stands out; against choppy water it does not. A view framed over the
  // calm water would otherwise see contact that one framed over the choppy
  // water does not.
  const W7 = 120;
  const H7 = 90;
  const pixels = new Uint8ClampedArray(W7 * H7 * 4);
  for (let y = 0; y < H7; y += 1) {
    for (let x = 0; x < W7; x += 1) {
      let v = y < 45 ? [100, 120, 140][(x + y) % 3] : 120;
      if (y >= 40 && y < 50 && x >= 60) v = 165;
      pixels.set([v, v, v, 255], (y * W7 + x) * 4);
    }
  }
  const choppyView = { y: 0, height: 55 };
  const calmView = { y: 35, height: 55 };
  /** Contact in rows 40..49, by either check. */
  const contact = (
    view: { y: number; height: number },
    stats: { x: number; y: number; width: number; height: number } | undefined,
  ) => {
    const { y, patch, edge } = guideContactRows(
      pixels,
      W7,
      H7,
      { x: 0, width: W7, ...view },
      62.5,
      62.5,
      -1,
      stats,
    );
    return Array.from(patch.slice(40 - y, 50 - y)).map(
      (mark, i) => mark || edge[40 - y + i],
    );
  };

  it('depends on the framing without one', () => {
    expect(contact(calmView, undefined)).not.toEqual(
      contact(choppyView, undefined),
    );
  });

  it('gives the same answer however the view is framed', () => {
    const calmStats = { x: 30, y: 45, width: 60, height: 40 };
    expect(contact(choppyView, calmStats)).toEqual(
      contact(calmView, calmStats),
    );
    expect(contact(calmView, calmStats).some(Boolean)).toBe(true);
    const choppyStats = { x: 30, y: 0, width: 60, height: 40 };
    expect(contact(calmView, choppyStats)).toEqual(
      contact(choppyView, choppyStats),
    );
  });
});

describe('guideNonWaterSpans at a small bow tip', () => {
  // Calm water and a dark bow tip only 4 rows tall and 8 pixels long, too
  // small for the patch check and too short for the local water check.
  const W5 = 120;
  const H5 = 60;
  const view = { x: 0, y: 0, width: W5, height: H5 };
  const pixels = new Uint8ClampedArray(W5 * H5 * 4);
  for (let y = 0; y < H5; y += 1) {
    for (let x = 0; x < W5; x += 1) {
      const v = y >= 20 && y < 24 && x >= 50 && x < 58 ? 40 : 115;
      pixels.set([v, v, v, 255], (y * W5 + x) * 4);
    }
  }
  const spans = (x: number) =>
    guideNonWaterSpans(pixels, W5, H5, view, x, x, -1);

  it('counts the front edge reaching the line', () => {
    expect(spans(50.5)).toEqual([{ y0: 20, y1: 24 }]);
  });

  it('not while the edge is still ahead of the line', () => {
    expect(spans(48.5)).toEqual([]);
  });
});

describe('guideNonWaterSpans with a ripple joined to the hull', () => {
  // Calm water, a white hull from x = 50, and a light ripple two rows tall
  // running from the hull's side to x = 40, as beside a bow ball.
  const W6 = 120;
  const H6 = 60;
  const view = { x: 0, y: 0, width: W6, height: H6 };
  const pixels = new Uint8ClampedArray(W6 * H6 * 4);
  for (let y = 0; y < H6; y += 1) {
    for (let x = 0; x < W6; x += 1) {
      let v = 115;
      if (y >= 20 && y < 30 && x >= 50) v = 230;
      else if ((y === 25 || y === 26) && x >= 40) v = 175;
      pixels.set([v, v, v, 255], (y * W6 + x) * 4);
    }
  }
  const spans = (x: number) =>
    guideNonWaterSpans(pixels, W6, H6, view, x, x, -1);

  it('does not count the ripple as the bow reaching the line', () => {
    expect(spans(45.5)).toEqual([]);
  });

  it('counts the hull itself', () => {
    expect(spans(52.5)).toEqual([{ y0: 20, y1: 30 }]);
  });
});
