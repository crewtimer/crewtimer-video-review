import { applyZoomTransform, guideNonWaterSpans } from './ZoomTransform';

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

  it('counts the next pixel in the direction of travel', () => {
    const pixels = frame((x, y) => (boat(x, y) ? hull : water));
    // Line in pixel 30; the tip in pixel 31 is ahead only for left to right.
    expect(guideNonWaterSpans(pixels, GW, GH, view, 30.5, 30.5, 1)).toEqual([
      { y0: 24, y1: 25 },
    ]);
    expect(guideNonWaterSpans(pixels, GW, GH, view, 30.5, 30.5, -1)).toEqual(
      [],
    );
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
