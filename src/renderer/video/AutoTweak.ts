import { getAutoTweakAfterZoom } from '../util/UseSettings';
import {
  getHyperZoomFactor,
  getImage,
  getTravelRightToLeft,
  getVideoFrameNum,
  getVideoScaling,
} from './VideoSettings';
import { getFinishLine, getVisibleSourceRect, moveToFrame } from './VideoUtils';
import { guideContactRows, type RowSpan } from './ZoomTransform';
import type { AppImage, Rect } from '../shared/AppTypes';

/**
 * Furthest the search looks either way, in milliseconds. Auto zoom is
 * usually within a few milliseconds, so an edge found further away is more
 * likely a water feature than the bow.
 */
export const AUTO_TWEAK_RANGE_MS = 6;
/**
 * Auto zoom lands a median 1 ms after the bow touches (SDFC26), so the
 * search starts that much earlier, and stays there when no edge is found.
 */
export const AUTO_ZOOM_BIAS_MS = 1;

/**
 * Finds the first frame where the bow touches the timing guide, starting
 * from the current one, in steps of one frame step (as the arrow keys move).
 * When touching it looks back for a clear frame, otherwise forward for a
 * touching one, in doubling jumps (1, 2, 4, ... steps) up to maxSteps away.
 * It then halves the gap between the last clear and first touching steps
 * until they are one step apart, and ends on the touching one. Returns
 * 'restore' when nothing changes within maxSteps, and 'aborted' when a step
 * fails.
 */
export const findGuideContact = async (
  isTouching: () => boolean,
  step: (offset: number) => Promise<boolean>,
  maxSteps: number,
): Promise<'found' | 'restore' | 'aborted'> => {
  const startTouching = isTouching();
  const direction = startTouching ? -1 : 1;
  let pos = 0;
  let previous = 0;
  let size = 1;
  for (;;) {
    const room = maxSteps - Math.abs(pos);
    if (room <= 0) return 'restore';
    const jump = direction * Math.min(size, room);
    // eslint-disable-next-line no-await-in-loop
    if (!(await step(jump))) return 'aborted';
    previous = pos;
    pos += jump;
    if (isTouching() !== startTouching) break;
    size *= 2;
  }
  // The clear step comes before the touching one in time.
  let clear = startTouching ? pos : previous;
  let touching = startTouching ? previous : pos;
  let current = pos;
  while (touching - clear > 1) {
    const mid = Math.floor((touching + clear) / 2);
    // eslint-disable-next-line no-await-in-loop
    if (!(await step(mid - current))) return 'aborted';
    current = mid;
    if (isTouching()) touching = mid;
    else clear = mid;
  }
  if (current !== touching && !(await step(touching - current))) {
    return 'aborted';
  }
  return 'found';
};

/** Source rows to check, y0 inclusive to y1 exclusive. */
type RowBand = { y0: number; y1: number };

/**
 * Whether a detected bow card is plausibly this boat's card. The detector's
 * boat box includes the card, which stands at the bow with its lower edge
 * about half to two-thirds of the way down the box (47-62% in SDFC26) and is
 * a third or so of the box tall. A small false card found above or away from
 * the boat would put the search band in the wrong place, so it is not used.
 */
export const isCardOnBoat = (card: Rect, boatBox: Rect) => {
  if (card.width <= 0 || card.height <= 0) return false;
  if (boatBox.width <= 0 || boatBox.height <= 0) return false;
  const overlaps =
    card.x < boatBox.x + boatBox.width && card.x + card.width > boatBox.x;
  const top = card.y >= boatBox.y - card.height * 0.25;
  const bottom = card.y + card.height <= boatBox.y + boatBox.height * 0.75;
  const bigEnough = card.height >= boatBox.height * 0.15;
  return overlaps && top && bottom && bigEnough;
};

/** Where the bow was clicked, and what the detector found on its boat. */
export type BowWhere = { clickY: number; card?: Rect; boatBox?: Rect };

/**
 * Part of the boat box where the bow ball sits: cards end 47-62% down, and a
 * ball was seen as low as 85% down.
 */
const BOAT_BAND_TOP = 0.35;
const BOAT_BAND_BOTTOM = 0.9;

/**
 * Share of the source the guide checks take their water and noise levels
 * from, centred on the band: what auto zoom's 5x view shows.
 */
const STATS_SHARE = 1 / 5;

/**
 * Rows where the bow is expected to cross. Around the lower edge of the bow
 * card when the boat has one, since the ball sits just below it. Otherwise
 * from the boat box: the ball sits about half to two-thirds of the way down
 * it, above the waterline shadow and bow wave. Failing both, around the
 * zoom point.
 */
export const bowCrossingBand = (
  where: BowWhere,
  viewHeight: number,
): RowBand & { from: 'boat box' | 'bow card' | 'click' } => {
  const { boatBox, card, clickY } = where;
  if (card && card.height > 0) {
    const bottom = card.y + card.height;
    return {
      y0: bottom - card.height * 0.25,
      // Not further: the waterline shadow and bow wave below can reach the
      // guide ahead of the bow ball.
      y1: bottom + card.height * 0.35,
      from: 'bow card',
    };
  }
  if (boatBox && boatBox.width > 0 && boatBox.height > 0) {
    return {
      y0: boatBox.y + boatBox.height * BOAT_BAND_TOP,
      y1: boatBox.y + boatBox.height * BOAT_BAND_BOTTOM,
      from: 'boat box',
    };
  }
  const half = Math.max(8, viewHeight * 0.1);
  return { y0: clickY - half, y1: clickY + half, from: 'click' };
};

/** Rows in the band that each check marks. */
type BandContact = { y: number; patch: Uint8Array; edge: Uint8Array };

/**
 * The guide checks over the band's rows, with the water and noise levels
 * from a fixed area around the band, so the answer does not depend on how
 * the view is framed.
 */
const bandContact = (image: AppImage, band: RowBand): BandContact => {
  const finish = getFinishLine();
  const xTop = image.width / 2 + finish.pt1;
  const xBottom = image.width / 2 + finish.pt2;
  const centerY = (band.y0 + band.y1) / 2;
  const width = image.width * STATS_SHARE;
  const height = image.height * STATS_SHARE;
  const statsRect = {
    x: xTop + ((xBottom - xTop) * centerY) / image.height - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
  const y0 = Math.floor(band.y0);
  const { data } = image;
  return guideContactRows(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    image.width,
    image.height,
    { x: statsRect.x, width, y: y0, height: Math.ceil(band.y1) - y0 },
    xTop,
    xBottom,
    getTravelRightToLeft() ? -1 : 1,
    statsRect,
  );
};

const countMarks = (marks: Uint8Array) =>
  marks.reduce((n, mark) => n + mark, 0);

/** Runs of adjacent marked rows, from row y of the image. */
const markedSpans = (y: number, marks: Uint8Array): RowSpan[] => {
  const spans: RowSpan[] = [];
  let start = -1;
  for (let row = 0; row <= marks.length; row += 1) {
    const hit = row < marks.length && marks[row] === 1;
    if (hit && start < 0) start = row;
    if (!hit && start >= 0) {
      spans.push({ y0: y + start, y1: y + row });
      start = -1;
    }
  }
  return spans;
};

/**
 * Edge contact counted as the bow: any row. A bow ball first reaches the
 * guide in only a row or two, often not adjacent, so requiring more (3
 * adjacent rows was tried on SDFC26) stops several milliseconds late.
 */
const bowSpans = ({ y, edge }: BandContact) => markedSpans(y, edge);

/** The last auto tweak's band, which the guide highlight follows. */
let tweakGuide: { file: string; band: RowBand } | undefined;

/** Forgets the last auto tweak's band, as when a new auto zoom starts. */
export const clearAutoTweakGuide = () => {
  tweakGuide = undefined;
};

/** Changes whenever the band autoTweakGuideSpans uses changes. */
export const autoTweakGuideKey = () =>
  tweakGuide
    ? `${tweakGuide.file}:${tweakGuide.band.y0}-${tweakGuide.band.y1}`
    : '';

/**
 * Rows where the guide highlight shows contact on image after an auto zoom:
 * exactly the edge contact the auto tweak counts as the bow, so the
 * highlight matches its decision. Undefined when no auto tweak has run on the file.
 */
export const autoTweakGuideSpans = (image: AppImage): RowSpan[] | undefined => {
  if (!tweakGuide || tweakGuide.file !== image.file || !image.width) {
    return undefined;
  }
  return bowSpans(bandContact(image, tweakGuide.band));
};

/**
 * After an auto zoom, when enabled, steps the zoomed view to the first frame
 * where the bow's front edge touches the timing guide. The search starts
 * AUTO_ZOOM_BIAS_MS before auto zoom's frame and looks AUTO_TWEAK_RANGE_MS
 * either way; with no edge in that range it stays at the start. The bow is
 * looked for below its bow card when one was detected, otherwise in its boat
 * box, otherwise around clickY. The guide highlight then shows the same
 * check (see autoTweakGuideSpans). Returns the frame shown, or undefined
 * when the setting is off or the user moved on.
 */
export const autoTweakAfterZoom = async (
  where: BowWhere,
  isCurrent: () => boolean,
): Promise<number | undefined> => {
  tweakGuide = undefined;
  if (!getAutoTweakAfterZoom()) return undefined;
  const zoomFrame = getVideoFrameNum();
  // A step is the hyperzoom resolution when zoomed 3x or more (as for the
  // arrow keys), otherwise a whole frame.
  const hyperZoom = getHyperZoomFactor();
  const stepMs =
    getVideoScaling().zoomY >= 3 && hyperZoom > 0
      ? hyperZoom
      : 1000 / (getImage().fps || 60);
  const maxSteps = Math.max(1, Math.round(AUTO_TWEAK_RANGE_MS / stepMs));
  const biasSteps = Math.round(AUTO_ZOOM_BIAS_MS / stepMs);
  const band = bowCrossingBand(where, getVisibleSourceRect().height);
  tweakGuide = { file: getImage().file, band };
  console.log(
    `Auto tweak: rows ${Math.round(band.y0)}-${Math.round(band.y1)} from ${band.from}`,
  );
  let expectedFrame = zoomFrame;
  // The frame each step returns; the image datum may not be updated yet.
  let shown = getImage();
  const step = async (offset: number) => {
    if (!isCurrent() || getVideoFrameNum() !== expectedFrame) return false;
    const image = await moveToFrame(
      getVideoFrameNum(),
      offset,
      true,
      isCurrent,
    );
    if (!image || !isCurrent()) return false;
    shown = image;
    expectedFrame = getVideoFrameNum();
    return true;
  };
  if (biasSteps > 0 && !(await step(-biasSteps))) return undefined;
  const startFrame = expectedFrame;
  const outcome = await findGuideContact(
    () => {
      const contact = bandContact(shown, band);
      const touching = bowSpans(contact).length > 0;
      // Tallest adjacent run of edge rows, for analysis.
      const run = Math.max(
        0,
        ...markedSpans(contact.y, contact.edge).map(({ y0, y1 }) => y1 - y0),
      );
      console.log(
        `Auto tweak: frame ${shown.frameNum.toFixed(3)} ${touching ? 'touching' : 'clear'} ` +
          `patch:${countMarks(contact.patch)} edge:${countMarks(contact.edge)} run:${run}`,
      );
      return touching;
    },
    step,
    maxSteps,
  );
  if (outcome === 'found') {
    console.log(
      `Auto tweak: bow touches the guide at frame ${expectedFrame.toFixed(3)} (from ${zoomFrame.toFixed(3)})`,
    );
    return expectedFrame;
  }
  if (outcome === 'restore' && isCurrent()) {
    console.log(
      `Auto tweak: no contact within range; at frame ${startFrame.toFixed(3)} (from ${zoomFrame.toFixed(3)})`,
    );
    await moveToFrame(startFrame, undefined, true, isCurrent);
    return startFrame;
  }
  return undefined;
};
