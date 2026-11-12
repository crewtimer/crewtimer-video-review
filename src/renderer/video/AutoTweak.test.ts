import { bowCrossingBand, findGuideContact } from './AutoTweak';

jest.mock('../util/UseSettings', () => ({ getAutoTweakAfterZoom: () => true }));
jest.mock('./VideoSettings', () => ({}));
jest.mock('./VideoUtils', () => ({}));

/**
 * Frames along a timeline: touching[i] says whether frame i shows the bow on
 * the guide. Starts at frame start; returns the search and where it ended.
 */
const run = async (touching: boolean[], start: number, failAt?: number) => {
  let frame = start;
  const visited: number[] = [];
  const outcome = await findGuideContact(
    () => touching[frame],
    async (offset) => {
      frame += offset;
      visited.push(frame);
      return frame !== failAt && frame >= 0 && frame < touching.length;
    },
  );
  return { outcome, frame, visited };
};

// Bow reaches the guide at frame 10.
const contactAt10 = Array.from({ length: 20 }, (_, i) => i >= 10);

describe('findGuideContact', () => {
  it('steps forward to the first touching frame', async () => {
    expect(await run(contactAt10, 7)).toEqual({
      outcome: 'found',
      frame: 10,
      visited: [8, 9, 10],
    });
  });

  it('backs up until clear, then forward to the first touching frame', async () => {
    expect(await run(contactAt10, 13)).toEqual({
      outcome: 'found',
      frame: 10,
      visited: [12, 11, 10, 9, 10],
    });
  });

  it('moves forward until touching after a back step skips past', async () => {
    // A step from a fractional frame drops the fraction, so the first step
    // back can land two frames back; the forward phase checks each frame.
    let frame = 12;
    let first = true;
    const outcome = await findGuideContact(
      () => contactAt10[frame],
      async (offset) => {
        frame += offset === -1 && first ? -4 : offset;
        first = false;
        return true;
      },
    );
    expect(outcome).toBe('found');
    expect(frame).toBe(10);
  });

  it('stays put when already on the first touching frame', async () => {
    const result = await run(contactAt10, 10);
    expect(result.outcome).toBe('found');
    expect(result.frame).toBe(10);
  });

  it('searches up to 10 steps each way, then asks to restore', async () => {
    // Bow reaches the guide at frame 20.
    const contactAt20 = Array.from({ length: 40 }, (_, i) => i >= 20);
    expect((await run(contactAt20, 10)).outcome).toBe('found');
    expect((await run(contactAt20, 9)).outcome).toBe('restore');
    expect((await run(contactAt20, 29)).outcome).toBe('found');
    expect((await run(contactAt20, 30)).outcome).toBe('restore');
    const neverTouching = contactAt20.map(() => false);
    expect((await run(neverTouching, 5)).outcome).toBe('restore');
  });

  it('stops when a step fails', async () => {
    expect((await run(contactAt10, 7, 9)).outcome).toBe('aborted');
  });
});

describe('bowCrossingBand', () => {
  it('looks around the lower edge of a detected bow card', () => {
    // Card rows 100..140; the bow ball sits just below it.
    const card = { x: 50, y: 100, width: 30, height: 40 };
    expect(bowCrossingBand(60, card, 200)).toEqual({ y0: 130, y1: 170 });
  });

  it('looks around the click without a card', () => {
    expect(bowCrossingBand(60, undefined, 200)).toEqual({ y0: 40, y1: 80 });
    const noCard = { x: 0, y: 0, width: 0, height: 0 };
    expect(bowCrossingBand(60, noCard, 50)).toEqual({ y0: 52, y1: 68 });
  });
});
