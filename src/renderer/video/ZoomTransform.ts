/**
 * Display-only transforms that make a zoomed view easier to read. They work
 * on RGBA pixels and never change the frame used for detection or exports.
 */

export type ZoomTransformMode = 'off' | 'autoLevels' | 'water' | 'waterTinted';

export const ZOOM_TRANSFORM_LABELS: Record<ZoomTransformMode, string> = {
  off: 'Off',
  autoLevels: 'Auto-levels',
  water: 'Water contrast',
  waterTinted: 'Water contrast (tinted)',
};

export type PixelRect = { x: number; y: number; width: number; height: number };

/** Statistics sample every 2nd pixel above this many pixels. */
const SAMPLE_ALL_LIMIT = 300_000;
/** Lab distance treated as clearly not water. */
const FAR_FROM_WATER = 20;
/** Share of far pixels above which the median is likely the hull, not water. */
const FAR_SHARE_LIMIT = 0.6;
/** Bins per unit of Lab distance in the distance histogram. */
const D_BINS_PER_UNIT = 4;
const D_BINS = 256 * D_BINS_PER_UNIT;

/** Clamps a rectangle to the image, rounding outward to whole pixels. */
export const clampRect = (
  rect: PixelRect,
  imageWidth: number,
  imageHeight: number,
): PixelRect => {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(imageWidth, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(imageHeight, Math.ceil(rect.y + rect.height));
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
};

/** Value at which the histogram's cumulative count reaches fraction. */
const histogramPercentile = (
  histogram: Uint32Array,
  total: number,
  fraction: number,
) => {
  const target = fraction * total;
  let count = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    count += histogram[bin];
    if (count >= target && count > 0) return bin;
  }
  return histogram.length - 1;
};

/** Calls visit with the pixel offset of each statistics sample in rect. */
const forEachSample = (
  imageWidth: number,
  rect: PixelRect,
  visit: (offset: number) => void,
) => {
  const step = rect.width * rect.height > SAMPLE_ALL_LIMIT ? 2 : 1;
  for (let { y } = rect; y < rect.y + rect.height; y += 1) {
    const row = y * imageWidth;
    for (let { x } = rect; x < rect.x + rect.width; x += step) {
      visit((row + x) * 4);
    }
  }
};

const autoLevels = (
  out: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
) => {
  const histogram = new Uint32Array(256);
  let total = 0;
  forEachSample(imageWidth, rect, (i) => {
    histogram[out[i]] += 1;
    histogram[out[i + 1]] += 1;
    histogram[out[i + 2]] += 1;
    total += 3;
  });
  const lo = histogramPercentile(histogram, total, 0.01);
  const hi = histogramPercentile(histogram, total, 0.99);
  if (hi - lo < 10) return;
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    table[v] = Math.round(((v - lo) * 255) / (hi - lo));
  }
  for (let { y } = rect; y < rect.y + rect.height; y += 1) {
    let i = (y * imageWidth + rect.x) * 4;
    for (let x = 0; x < rect.width; x += 1, i += 4) {
      out[i] = table[out[i]];
      out[i + 1] = table[out[i + 1]];
      out[i + 2] = table[out[i + 2]];
    }
  }
};

/** sRGB byte to linear light, 0..1. */
const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let v = 0; v < 256; v += 1) {
    const c = v / 255;
    table[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return table;
})();

// D65 reference white.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const labF = (t: number) =>
  t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;

/** CIE Lab (D65) of the RGBA pixel at offset i, written to lab[0..2]. */
const toLab = (pixels: Uint8ClampedArray, i: number, lab: Float32Array) => {
  const r = SRGB_TO_LINEAR[pixels[i]];
  const g = SRGB_TO_LINEAR[pixels[i + 1]];
  const b = SRGB_TO_LINEAR[pixels[i + 2]];
  const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN);
  const fy = labF((0.2126729 * r + 0.7151522 * g + 0.072175 * b) / YN);
  const fz = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN);
  lab[0] = 116 * fy - 16;
  lab[1] = 500 * (fx - fy);
  lab[2] = 200 * (fy - fz);
};

/** L scaled to 0..255; a and b shifted by 128 into 0..255. */
const labBin = (value: number, channel: number) =>
  Math.max(
    0,
    Math.min(255, Math.round(channel === 0 ? value * 2.55 : value + 128)),
  );
const binToLab = (bin: number, channel: number) =>
  channel === 0 ? bin / 2.55 : bin - 128;

/** Per-channel median Lab of the pixels at the given offsets. */
const medianLab = (
  pixels: Uint8ClampedArray,
  forEach: (visit: (offset: number) => void) => void,
) => {
  const histograms = [
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
  ];
  const lab = new Float32Array(3);
  let total = 0;
  forEach((i) => {
    toLab(pixels, i, lab);
    for (let c = 0; c < 3; c += 1) histograms[c][labBin(lab[c], c)] += 1;
    total += 1;
  });
  return histograms.map((histogram, c) =>
    binToLab(histogramPercentile(histogram, total, 0.5), c),
  );
};

/** Offsets of the pixels in a strip around the rectangle's edge. */
const forEachBorderPixel = (
  imageWidth: number,
  rect: PixelRect,
  visit: (offset: number) => void,
) => {
  const strip = Math.max(
    1,
    Math.round(Math.min(rect.width, rect.height) * 0.1),
  );
  for (let { y } = rect; y < rect.y + rect.height; y += 1) {
    const edgeRow = y < rect.y + strip || y >= rect.y + rect.height - strip;
    const row = y * imageWidth;
    for (let { x } = rect; x < rect.x + rect.width; x += 1) {
      if (edgeRow || x < rect.x + strip || x >= rect.x + rect.width - strip) {
        visit((row + x) * 4);
      }
    }
  }
};

/** Lab distance of every pixel in rect from water, row by row. */
const distancesFrom = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
  water: number[],
) => {
  const distances = new Float32Array(rect.width * rect.height);
  const lab = new Float32Array(3);
  let far = 0;
  let n = 0;
  for (let { y } = rect; y < rect.y + rect.height; y += 1) {
    let i = (y * imageWidth + rect.x) * 4;
    for (let x = 0; x < rect.width; x += 1, i += 4, n += 1) {
      toLab(pixels, i, lab);
      const d = Math.hypot(
        lab[0] - water[0],
        lab[1] - water[1],
        lab[2] - water[2],
      );
      distances[n] = d;
      if (d > FAR_FROM_WATER) far += 1;
    }
  }
  return { distances, farShare: far / Math.max(1, n) };
};

/**
 * The water colour of rect and each pixel's Lab distance from it, row by
 * row. Water is the median of rect, or of its border when rect is mostly
 * boat.
 */
const waterOf = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
) => {
  const median = medianLab(pixels, (visit) =>
    forEachSample(imageWidth, rect, visit),
  );
  const fromMedian = distancesFrom(pixels, imageWidth, rect, median);
  if (fromMedian.farShare <= FAR_SHARE_LIMIT) {
    return { water: median, distances: fromMedian.distances };
  }
  // Mostly boat: the median is the hull, so take water from the edges.
  const border = medianLab(pixels, (visit) =>
    forEachBorderPixel(imageWidth, rect, visit),
  );
  return {
    water: border,
    distances: distancesFrom(pixels, imageWidth, rect, border).distances,
  };
};

/** Lab distance from the water colour of each pixel in rect, row by row. */
const waterDistances = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
) => waterOf(pixels, imageWidth, rect).distances;

const waterContrast = (
  out: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
  tinted: boolean,
) => {
  const distances = waterDistances(out, imageWidth, rect);
  const histogram = new Uint32Array(D_BINS);
  const step = distances.length > SAMPLE_ALL_LIMIT ? 2 : 1;
  let total = 0;
  for (let n = 0; n < distances.length; n += step) {
    histogram[
      Math.min(D_BINS - 1, Math.floor(distances[n] * D_BINS_PER_UNIT))
    ] += 1;
    total += 1;
  }
  const p995 = Math.max(
    1,
    (histogramPercentile(histogram, total, 0.995) + 1) / D_BINS_PER_UNIT,
  );
  let n = 0;
  for (let { y } = rect; y < rect.y + rect.height; y += 1) {
    let i = (y * imageWidth + rect.x) * 4;
    for (let x = 0; x < rect.width; x += 1, i += 4, n += 1) {
      const g = Math.min(255, (distances[n] * 255) / p995);
      if (tinted) {
        out[i] = (out[i] + g) / 2;
        out[i + 1] = (out[i + 1] + g) / 2;
        out[i + 2] = (out[i + 2] + g) / 2;
      } else {
        out[i] = g;
        out[i + 1] = g;
        out[i + 2] = g;
      }
      out[i + 3] = 255;
    }
  }
};

/**
 * Returns the RGBA pixels with rect transformed for display; pixels outside
 * rect are copied unchanged. 'off' returns the input array itself, and the
 * input is never modified.
 */
export const applyZoomTransform = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  imageWidth: number,
  imageHeight: number,
  visibleRect: PixelRect,
  mode: ZoomTransformMode,
): Uint8ClampedArray<ArrayBuffer> => {
  if (mode === 'off') return pixels;
  const rect = clampRect(visibleRect, imageWidth, imageHeight);
  const out = new Uint8ClampedArray(pixels);
  if (rect.width === 0 || rect.height === 0) return out;
  if (mode === 'autoLevels') {
    autoLevels(out, imageWidth, rect);
  } else {
    waterContrast(out, imageWidth, rect, mode === 'waterTinted');
  }
  return out;
};

/** A run of source rows, y0 inclusive to y1 exclusive. */
export type RowSpan = { y0: number; y1: number };

/**
 * Lab distance from water that marks a pixel as not water: a multiple of the
 * typical (median) water distance, within limits. Choppy water needs the
 * upper limit to skip glints; on calm water a grey hull differs from the
 * water by only 15 to 20.
 */
const GUIDE_FAR_NOISE_FACTOR = 3;
const GUIDE_FAR_MIN = 10;
const GUIDE_FAR_MAX = 25;
/**
 * A pixel on the guide must clear the threshold by this share of its excess
 * over GUIDE_FAR_MIN to count as contact. On choppy water a faint streak
 * joined to the hull, such as a smear or the bow wave, is just over the
 * threshold while the bow ball is well over it. On calm water the threshold
 * is already low and a faint bow tip is real, so no margin is added.
 */
const GUIDE_CONTACT_MARGIN = 0.5;
/**
 * Fewest connected non-water source pixels for a highlight. A dark seam or
 * bow marking can cut the bow off from the hull, leaving a patch of only
 * about 120 pixels, so the row span below is what rejects most glints.
 */
const GUIDE_MIN_BLOB = 40;
/** Fewest rows a patch spans; glints are wide but only a few rows tall. */
const GUIDE_MIN_BLOB_ROWS = 6;
/**
 * Or fewest columns: a distant hull's deck can be only 4 or 5 rows tall but
 * is longer than any glint (glints measured up to about 95 pixels).
 */
const GUIDE_MIN_BLOB_COLS = 120;

/**
 * Marks the pixels of each 4-connected non-water patch that is large enough
 * to be a boat, for a mask of rect's pixels row by row.
 */
const boatLikePixels = (far: Uint8Array, width: number, height: number) => {
  const label = new Int32Array(far.length).fill(-1);
  const boatLike: boolean[] = [];
  const stack = new Int32Array(far.length);
  for (let start = 0; start < far.length; start += 1) {
    if (far[start] && label[start] < 0) {
      const id = boatLike.length;
      let area = 0;
      let minRow = height;
      let maxRow = -1;
      let minCol = width;
      let maxCol = -1;
      let top = 0;
      stack[top] = start;
      top += 1;
      label[start] = id;
      while (top > 0) {
        top -= 1;
        const n = stack[top];
        area += 1;
        const row = Math.floor(n / width);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
        const x = n % width;
        minCol = Math.min(minCol, x);
        maxCol = Math.max(maxCol, x);
        for (let k = 0; k < 4; k += 1) {
          let m = -1;
          if (k === 0 && x > 0) m = n - 1;
          else if (k === 1 && x < width - 1) m = n + 1;
          else if (k === 2 && n >= width) m = n - width;
          else if (k === 3 && n < (height - 1) * width) m = n + width;
          if (m >= 0 && far[m] && label[m] < 0) {
            label[m] = id;
            stack[top] = m;
            top += 1;
          }
        }
      }
      boatLike.push(
        area >= GUIDE_MIN_BLOB &&
          (maxRow - minRow + 1 >= GUIDE_MIN_BLOB_ROWS ||
            maxCol - minCol + 1 >= GUIDE_MIN_BLOB_COLS),
      );
    }
  }
  const result = new Uint8Array(far.length);
  for (let n = 0; n < far.length; n += 1) {
    if (label[n] >= 0 && boatLike[label[n]]) result[n] = 1;
  }
  return result;
};

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Fewest consecutive rows for a whole-view contact to count. */
const PATCH_MIN_ROWS = 3;

/** Edge check: search from this far ahead of the guide to this far behind. */
const EDGE_AHEAD = 2;
const EDGE_BEHIND = 30;
/**
 * A front edge needs a left-to-right lightness change this many times the
 * view's typical one (ripples and glints run horizontally, so theirs is
 * small), and at least EDGE_MIN.
 */
const EDGE_FACTOR = 10;
const EDGE_MIN = 8;
/** Rows a front edge must continue over to count. */
const EDGE_MIN_ROWS = 3;

/**
 * Lightness change a front edge needs: EDGE_FACTOR times the typical
 * left-to-right change in rect (sampling every 7th pixel), and at least
 * EDGE_MIN.
 */
const strongEdge = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
) => {
  const { width, height } = rect;
  const lab = new Float32Array(3);
  const lightness = (row: number, col: number) => {
    toLab(pixels, ((rect.y + row) * imageWidth + rect.x + col) * 4, lab);
    return lab[0];
  };
  const sample: number[] = [];
  for (let n = 0; n < width * height; n += 7) {
    const row = Math.floor(n / width);
    const col = n % width;
    sample.push(
      col > 0 && col < width - 1
        ? 4 * Math.abs(lightness(row, col + 1) - lightness(row, col - 1))
        : 0,
    );
  }
  return Math.max(EDGE_MIN, EDGE_FACTOR * medianOf(sample));
};

/**
 * Rows (relative to rect) where the boat's front edge has reached the guide.
 * The front edge is the first strong left-to-right lightness change in the
 * direction of travel near the guide, located to a fraction of a pixel, so
 * contact is found where the edge starts rather than once a pixel is solidly
 * unlike the water. strong is the lightness change an edge needs.
 */
const edgeContactRows = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  rect: PixelRect,
  lineX: (row: number) => number,
  travelStep: 1 | -1,
  strong: number,
) => {
  const { width, height } = rect;
  const light = new Float32Array(width * height);
  const lab = new Float32Array(3);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      toLab(pixels, ((rect.y + row) * imageWidth + rect.x + col) * 4, lab);
      [light[row * width + col]] = lab;
    }
  }
  // Left-to-right lightness change within each row, scaled like a Sobel
  // filter. No blending with the rows above and below, so an edge does not
  // spill past the rows the boat covers.
  const grad = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 1; col < width - 1; col += 1) {
      const n = row * width + col;
      grad[n] = 4 * Math.abs(light[n + 1] - light[n - 1]);
    }
  }
  /** Front edge x (image coordinates) in the row, if any. */
  const frontEdge = (row: number) => {
    const guide = lineX(row) - rect.x;
    // From ahead of the guide (direction of travel) back toward the boat.
    const from = Math.floor(guide + travelStep * EDGE_AHEAD);
    const to = Math.floor(guide - travelStep * EDGE_BEHIND);
    const step = -travelStep;
    const g = (c: number) =>
      c > 0 && c < width - 1 ? grad[row * width + c] : 0;
    for (let c = from; step > 0 ? c <= to : c >= to; c += step) {
      const v = g(c);
      if (v >= strong && v >= g(c - 1) && v >= g(c + 1)) {
        // Peak of a parabola through the three samples.
        const a = g(c - 1);
        const b = g(c + 1);
        const curve = a - 2 * v + b;
        const offset = curve !== 0 ? (0.5 * (a - b)) / curve : 0;
        return rect.x + c + 0.5 + offset;
      }
    }
    return undefined;
  };

  const edges = Array.from({ length: height }, (_, row) => frontEdge(row));
  const hits = new Uint8Array(height);
  let start = -1;
  for (let row = 0; row <= height; row += 1) {
    const edge = row < height ? edges[row] : undefined;
    if (edge !== undefined) {
      if (start < 0) start = row;
    } else if (start >= 0) {
      if (row - start >= EDGE_MIN_ROWS) {
        for (let r = start; r < row; r += 1) {
          const reached =
            travelStep < 0
              ? (edges[r] as number) <= lineX(r)
              : (edges[r] as number) >= lineX(r);
          if (reached) hits[r] = 1;
        }
      }
      start = -1;
    }
  }
  return hits;
};

/** Rows touching the guide by each check, from row y of the image. */
export type GuideContactRows = {
  y: number;
  /** Whole-view check: a boat-like patch unlike the view's water. */
  patch: Uint8Array;
  /** Edge check: the boat's front edge has reached the guide. */
  edge: Uint8Array;
};

/**
 * The two checks behind guideNonWaterSpans, row by row. The water colour and
 * the noise levels the checks compare against come from statsRect when
 * given, so the answer does not depend on how the view is framed; otherwise
 * from the visible rect.
 */
export const guideContactRows = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  visibleRect: PixelRect,
  xTop: number,
  xBottom: number,
  travelStep: 1 | -1 = 1,
  statsRect: PixelRect | undefined = undefined,
): GuideContactRows => {
  const rect = clampRect(visibleRect, imageWidth, imageHeight);
  if (rect.width < 3 || rect.height === 0) {
    const none = new Uint8Array(0);
    return { y: rect.y, patch: none, edge: none };
  }
  const clampedStats =
    statsRect && clampRect(statsRect, imageWidth, imageHeight);
  const stats =
    clampedStats && clampedStats.width >= 3 && clampedStats.height > 0
      ? clampedStats
      : rect;
  const fromStats = waterOf(pixels, imageWidth, stats);
  const distances =
    stats === rect
      ? fromStats.distances
      : distancesFrom(pixels, imageWidth, rect, fromStats.water).distances;
  const histogram = new Uint32Array(D_BINS);
  fromStats.distances.forEach((d) => {
    histogram[Math.min(D_BINS - 1, Math.floor(d * D_BINS_PER_UNIT))] += 1;
  });
  const median =
    histogramPercentile(histogram, fromStats.distances.length, 0.5) /
    D_BINS_PER_UNIT;
  const threshold = Math.min(
    GUIDE_FAR_MAX,
    Math.max(GUIDE_FAR_MIN, GUIDE_FAR_NOISE_FACTOR * median),
  );
  const contact =
    threshold + (threshold - GUIDE_FAR_MIN) * GUIDE_CONTACT_MARGIN;
  const far = new Uint8Array(distances.length);
  for (let n = 0; n < distances.length; n += 1) {
    far[n] = distances[n] > threshold ? 1 : 0;
  }
  const boatLike = boatLikePixels(far, rect.width, rect.height);
  const lineCol = (row: number) =>
    Math.floor(xTop + ((xBottom - xTop) * (rect.y + row + 0.5)) / imageHeight) -
    rect.x;
  const edge = edgeContactRows(
    pixels,
    imageWidth,
    rect,
    (row) => xTop + ((xBottom - xTop) * (rect.y + row + 0.5)) / imageHeight,
    travelStep,
    strongEdge(pixels, imageWidth, stats),
  );
  // Whole-view contact, kept only in runs of PATCH_MIN_ROWS rows: a light
  // ripple joined to the hull beside the bow ball touches the line for a
  // row or two before the bow does.
  const patch = new Uint8Array(rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const onLine = lineCol(row);
    patch[row] = [onLine, onLine + travelStep].some((col) => {
      const n = row * rect.width + col;
      return (
        col >= 0 &&
        col < rect.width &&
        boatLike[n] === 1 &&
        distances[n] >= contact
      );
    })
      ? 1
      : 0;
  }
  let run = -1;
  for (let row = 0; row <= rect.height; row += 1) {
    if (row < rect.height && patch[row]) {
      if (run < 0) run = row;
    } else if (run >= 0) {
      if (row - run < PATCH_MIN_ROWS) patch.fill(0, run, row);
      run = -1;
    }
  }
  return { y: rect.y, patch, edge };
};

/**
 * Rows of rect where the guide line touches something unlike the water. The
 * guide runs from x = xTop at y = 0 to x = xBottom at the image bottom. A row
 * counts when the pixel the line passes through (0), or the next pixel in
 * the direction of travel (+1), clearly differs from the water and is part of
 * a non-water patch several rows tall or longer than a glint (in runs of at
 * least PATCH_MIN_ROWS rows), or when the boat's front edge has reached the
 * line (see edgeContactRows). A bow tip on the line counts, but not one with water
 * between it and the line on the approach side. travelStep is -1 for boats
 * moving right to left.
 */
export const guideNonWaterSpans = (
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  visibleRect: PixelRect,
  xTop: number,
  xBottom: number,
  travelStep: 1 | -1 = 1,
): RowSpan[] => {
  const { y, patch, edge } = guideContactRows(
    pixels,
    imageWidth,
    imageHeight,
    visibleRect,
    xTop,
    xBottom,
    travelStep,
  );
  const spans: RowSpan[] = [];
  let start = -1;
  for (let row = 0; row <= patch.length; row += 1) {
    const hit = row < patch.length && (edge[row] === 1 || patch[row] === 1);
    if (hit && start < 0) start = row;
    if (!hit && start >= 0) {
      spans.push({ y0: y + start, y1: y + row });
      start = -1;
    }
  }
  return spans;
};
