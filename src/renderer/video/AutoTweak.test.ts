import {
  autoTweakAfterZoom,
  autoTweakGuideSpans,
  bowCrossingBand,
  findGuideContact,
  isCardOnBoat,
} from './AutoTweak';

/**
 * A 1 ms hyperzoom timeline in whole milliseconds. The edge check finds the
 * bow from frame edgeAt on, in the given rows of each image.
 */
const timeline = { at: 0, edgeAt: 0, rows: [110, 111, 112, 113, 114] };
const image = (at: number) => ({
  file: 'a.mp4',
  width: 400,
  height: 400,
  fps: 60,
  frameNum: at,
  data: new Uint8Array(400 * 400 * 4),
});

jest.mock('../util/UseSettings', () => ({ getAutoTweakAfterZoom: () => true }));
jest.mock('./VideoSettings', () => ({
  getHyperZoomFactor: () => 1,
  getImage: () => image(timeline.at),
  getTravelRightToLeft: () => true,
  getVideoFrameNum: () => timeline.at,
  getVideoScaling: () => ({ zoomY: 5 }),
}));
jest.mock('./VideoUtils', () => ({
  getFinishLine: () => ({ pt1: 0, pt2: 0 }),
  getVisibleSourceRect: () => ({ x: 0, y: 0, width: 80, height: 80 }),
  moveToFrame: async (frameNum: number, offset?: number) => {
    timeline.at = frameNum + (offset ?? 0);
    return image(timeline.at);
  },
}));
jest.mock('./ZoomTransform', () => ({
  guideContactRows: (
    _pixels: unknown,
    _width: number,
    _height: number,
    rect: { y: number; height: number },
  ) => {
    const marks = new Uint8Array(rect.height);
    // The frame being checked is the one last moved to.
    if (timeline.at >= timeline.edgeAt) {
      for (let row = 0; row < rect.height; row += 1) {
        if (timeline.rows.includes(rect.y + row)) marks[row] = 1;
      }
    }
    return { y: rect.y, patch: new Uint8Array(rect.height), edge: marks };
  },
}));

/**
 * Steps along a timeline: touching[i] says whether step i shows the bow on
 * the guide. Starts at step start; returns the search and where it ended.
 */
const run = async (
  touching: boolean[],
  start: number,
  maxSteps: number,
  failAt?: number,
) => {
  let at = start;
  const visited: number[] = [];
  const outcome = await findGuideContact(
    () => touching[at],
    async (offset) => {
      at += offset;
      visited.push(at);
      return at !== failAt && at >= 0 && at < touching.length;
    },
    maxSteps,
  );
  return { outcome, at, renders: visited.length };
};

// Bow reaches the guide at step 30.
const contactAt30 = Array.from({ length: 80 }, (_, i) => i >= 30);

describe('findGuideContact', () => {
  it('finds the first touching step from before contact', async () => {
    for (const start of [29, 27, 20, 11]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await run(contactAt30, start, 20);
      expect(result.outcome).toBe('found');
      expect(result.at).toBe(30);
    }
  });

  it('finds the first touching step from after contact', async () => {
    for (const start of [30, 31, 34, 41, 49]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await run(contactAt30, start, 20);
      expect(result.outcome).toBe('found');
      expect(result.at).toBe(30);
    }
  });

  it('reaches 11 steps back, as bow 65 needed, in few renders', async () => {
    const result = await run(contactAt30, 41, 20);
    expect(result).toEqual({ outcome: 'found', at: 30, renders: 8 });
  });

  it('asks to restore when nothing changes within range', async () => {
    expect((await run(contactAt30, 9, 20)).outcome).toBe('restore');
    expect((await run(contactAt30, 51, 20)).outcome).toBe('restore');
    const neverTouching = contactAt30.map(() => false);
    expect((await run(neverTouching, 40, 20)).outcome).toBe('restore');
  });

  it('stops when a step fails', async () => {
    expect((await run(contactAt30, 25, 20, 26)).outcome).toBe('aborted');
  });
});

describe('bowCrossingBand', () => {
  it('falls back to the part of the boat box where the bow ball sits', () => {
    // Bow 343: boat box rows 632-793, ball at row 736, click at row 801.
    const boatBox = { x: 540, y: 632, width: 540, height: 161 };
    const band = bowCrossingBand({ clickY: 801, boatBox }, 216);
    expect(band.from).toBe('boat box');
    expect(band.y0).toBeLessThan(736);
    expect(band.y1).toBeGreaterThan(736);
    expect(band.y1).toBeLessThan(801);
  });

  it('reaches a ball low in the boat box', () => {
    // Bow 246: boat box rows 542-668, ball about 85% down at row 650.
    const boatBox = { x: 540, y: 542, width: 540, height: 126 };
    const band = bowCrossingBand({ clickY: 630, boatBox }, 216);
    expect(band.y0).toBeLessThan(650);
    expect(band.y1).toBeGreaterThan(650);
  });

  it('uses the lower edge of a bow card first', () => {
    // Card rows 100..140; the bow ball sits just below it.
    const card = { x: 50, y: 100, width: 30, height: 40 };
    const boatBox = { x: 40, y: 90, width: 300, height: 120 };
    expect(bowCrossingBand({ clickY: 60, card, boatBox }, 200)).toEqual({
      y0: 130,
      y1: 154,
      from: 'bow card',
    });
  });

  it('falls back to the click', () => {
    expect(bowCrossingBand({ clickY: 60 }, 200)).toEqual({
      y0: 40,
      y1: 80,
      from: 'click',
    });
    const noCard = { x: 0, y: 0, width: 0, height: 0 };
    expect(bowCrossingBand({ clickY: 60, card: noCard }, 50)).toEqual({
      y0: 52,
      y1: 68,
      from: 'click',
    });
  });
});

describe('isCardOnBoat', () => {
  // Real SDFC26 detections: the boat box includes its card.
  it('accepts real cards inside the top of their boat box', () => {
    const real = [
      [
        { x: 594, y: 408, width: 78, height: 63 },
        { x: 554, y: 390, width: 526, height: 171 },
      ],
      [
        { x: 578, y: 342, width: 70, height: 58 },
        { x: 547, y: 328, width: 533, height: 118 },
      ],
      [
        { x: 565, y: 407, width: 63, height: 45 },
        { x: 538, y: 367, width: 542, height: 152 },
      ],
      [
        { x: 612, y: 479, width: 69, height: 55 },
        { x: 551, y: 449, width: 529, height: 160 },
      ],
      [
        { x: 568, y: 752, width: 86, height: 58 },
        { x: 537, y: 691, width: 542, height: 193 },
      ],
    ];
    real.forEach(([card, boat]) => expect(isCardOnBoat(card, boat)).toBe(true));
  });

  const boat = { x: 100, y: 200, width: 300, height: 120 };

  it('rejects a small card above the boat', () => {
    expect(isCardOnBoat({ x: 120, y: 170, width: 8, height: 10 }, boat)).toBe(
      false,
    );
  });

  it('rejects a tiny card on the boat', () => {
    expect(isCardOnBoat({ x: 120, y: 210, width: 8, height: 10 }, boat)).toBe(
      false,
    );
  });

  it('rejects a card low on the hull or beside the boat', () => {
    expect(isCardOnBoat({ x: 120, y: 280, width: 40, height: 40 }, boat)).toBe(
      false,
    );
    expect(isCardOnBoat({ x: 20, y: 210, width: 40, height: 40 }, boat)).toBe(
      false,
    );
  });

  it('rejects a missing card', () => {
    expect(isCardOnBoat({ x: 0, y: 0, width: 0, height: 0 }, boat)).toBe(false);
  });
});

describe('autoTweakAfterZoom', () => {
  // Card ending at row 110: the band covers the rows the edge is found in.
  const where = { clickY: 0, card: { x: 0, y: 70, width: 40, height: 40 } };
  const tweak = async (
    zoomAt: number,
    edgeAt: number,
    rows = [110, 111, 112, 113, 114],
  ) => {
    timeline.at = zoomAt;
    timeline.edgeAt = edgeAt;
    timeline.rows = rows;
    return autoTweakAfterZoom(where, () => true);
  };

  it('finds the edge within range of auto zoom', async () => {
    expect(await tweak(100, 98)).toBe(98);
    expect(await tweak(100, 105)).toBe(105);
    // Searched from 1 ms early, 99 +/- 6: 94 is the earliest it can confirm.
    expect(await tweak(100, 94)).toBe(94);
    expect(await tweak(100, 93)).toBe(99);
    expect(await tweak(100, 106)).toBe(99);
  });

  it('starts 1 ms before auto zoom, which is usually that late', async () => {
    expect(await tweak(100, 99)).toBe(99);
  });

  it('stays 1 ms before auto zoom when no edge is in range', async () => {
    // Too early or too late to be this bow, as when a water feature or a
    // blurry front puts the edge far from auto zoom.
    expect(await tweak(100, 90)).toBe(99);
    expect(timeline.at).toBe(99);
    expect(await tweak(100, 110)).toBe(99);
    expect(timeline.at).toBe(99);
  });

  it('counts a bow ball first touching in a single row', async () => {
    expect(await tweak(100, 97, [112])).toBe(97);
    expect(await tweak(100, 97, [104, 112])).toBe(97);
  });

  it('highlights exactly what the tweak decided', async () => {
    await tweak(100, 98);
    expect(autoTweakGuideSpans(image(98) as never)).toEqual([
      { y0: 110, y1: 115 },
    ]);
    timeline.at = 97;
    expect(autoTweakGuideSpans(image(97) as never)).toEqual([]);
    expect(
      autoTweakGuideSpans({ ...image(98), file: 'b.mp4' } as never),
    ).toBeUndefined();
  });
});
