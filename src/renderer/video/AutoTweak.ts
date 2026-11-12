import { getAutoTweakAfterZoom } from '../util/UseSettings';
import {
  getImage,
  getTravelRightToLeft,
  getVideoFrameNum,
} from './VideoSettings';
import { getFinishLine, getVisibleSourceRect, moveToFrame } from './VideoUtils';
import { guideNonWaterSpans } from './ZoomTransform';
import type { AppImage, Rect } from '../shared/AppTypes';

/** Most steps taken each way before returning to the starting frame. */
export const AUTO_TWEAK_MAX_STEPS = 10;

/**
 * Finds the first frame where the bow touches the timing guide, starting
 * from the current one. When touching, steps back until it is not; then
 * steps forward until it is. Returns 'restore' when either phase sees no
 * change within maxSteps, and 'aborted' when a step fails. With so few steps,
 * scanning is as quick as a binary search.
 */
export const findGuideContact = async (
  isTouching: () => boolean,
  step: (offset: -1 | 1) => Promise<boolean>,
  maxSteps = AUTO_TWEAK_MAX_STEPS,
): Promise<'found' | 'restore' | 'aborted'> => {
  /** Steps until isTouching() equals want; undefined when none within range. */
  const stepUntil = async (offset: -1 | 1, want: boolean) => {
    for (let taken = 1; taken <= maxSteps; taken += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await step(offset))) return 'aborted';
      if (isTouching() === want) return 'reached';
    }
    return undefined;
  };
  if (isTouching()) {
    // Back up until the bow is clear of the guide.
    const backed = await stepUntil(-1, false);
    if (backed !== 'reached') return backed ?? 'restore';
  }
  // Then forward to the first frame touching it.
  const found = await stepUntil(1, true);
  if (found === 'reached') return 'found';
  return found ?? 'restore';
};

/** Source rows to check, y0 inclusive to y1 exclusive. */
type RowBand = { y0: number; y1: number };

/**
 * Rows where the bow is expected to cross: around the lower edge of its bow
 * card when one was detected, since the bow ball sits just below the card;
 * otherwise around where the bow was clicked.
 */
export const bowCrossingBand = (
  clickY: number,
  card: Rect | undefined,
  viewHeight: number,
): RowBand => {
  if (card && card.height > 0) {
    const bottom = card.y + card.height;
    return {
      y0: bottom - card.height * 0.25,
      y1: bottom + card.height * 0.75,
    };
  }
  const half = Math.max(8, viewHeight * 0.1);
  return { y0: clickY - half, y1: clickY + half };
};

/** Whether the frame shows the guide touching a boat within band. */
const guideTouchingNear = (
  image: AppImage,
  where: { clickY: number; card?: Rect },
) => {
  if (!image.width) return false;
  const rect = getVisibleSourceRect();
  const finish = getFinishLine();
  const { data } = image;
  const spans = guideNonWaterSpans(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    image.width,
    image.height,
    rect,
    image.width / 2 + finish.pt1,
    image.width / 2 + finish.pt2,
    getTravelRightToLeft() ? -1 : 1,
  );
  const band = bowCrossingBand(where.clickY, where.card, rect.height);
  return spans.some(({ y0, y1 }) => y1 > band.y0 && y0 < band.y1);
};

/**
 * After an auto zoom, when enabled, steps the zoomed view to the first frame
 * where the bow touches the timing guide, using the same check as the guide
 * highlight. The bow is looked for below its bow card when one was detected,
 * otherwise around clickY. Returns the frame shown, or undefined when the
 * setting is off, nothing changed, or the user moved on.
 */
export const autoTweakAfterZoom = async (
  where: { clickY: number; card?: Rect },
  isCurrent: () => boolean,
): Promise<number | undefined> => {
  if (!getAutoTweakAfterZoom()) return undefined;
  const startFrame = getVideoFrameNum();
  let expectedFrame = startFrame;
  // The frame each step returns; the image datum may not be updated yet.
  let shown = getImage();
  const step = async (offset: -1 | 1) => {
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
  const outcome = await findGuideContact(() => {
    const touching = guideTouchingNear(shown, where);
    console.log(
      `Auto tweak: frame ${shown.frameNum.toFixed(3)} ${touching ? 'touching' : 'clear'}`,
    );
    return touching;
  }, step);
  if (outcome === 'found') {
    console.log(
      `Auto tweak: bow touches the guide at frame ${expectedFrame.toFixed(3)} (from ${startFrame.toFixed(3)})`,
    );
    return expectedFrame;
  }
  if (outcome === 'restore' && isCurrent()) {
    console.log('Auto tweak: no contact within range; restoring frame');
    await moveToFrame(startFrame, undefined, true, isCurrent);
  }
  return undefined;
};
