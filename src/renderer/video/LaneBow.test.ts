import {
  autoZoomBoatPoint,
  laneAtPoint,
  laneBowAfterAutoZoom,
  sprintLaneBow,
} from './LaneBow';
import type { BoatObservation } from './AutoZoomToFinish';
import type { GuideLine } from './VideoSettings';

const mockEvent = {
  current: undefined as
    { RaceType?: string; eventItems?: Array<{ Bow?: string }> } | undefined,
};
const mockSettings = {
  guides: [] as GuideLine[],
  laneBelowGuide: false,
  enableLaneGuides: true,
};
jest.mock('../util/UseSettings', () => ({
  getCurrentEvent: () => mockEvent.current,
}));
jest.mock('./VideoSettings', () => ({
  Dir: { Horiz: 0, Vert: 1 },
  getImage: () => ({ width: 1920, height: 1080 }),
  getVideoSettings: () => mockSettings,
}));

const W = 1920;
const H = 1080;
const lane = (n: number, pt: number, enabled = true): GuideLine => ({
  dir: 0,
  label: `Lane ${n}`,
  pt1: pt,
  pt2: pt,
  enabled,
});
// Lane guides of CT_20260329_144417 (lanes above their guides).
const tutorialGuides: GuideLine[] = [
  { dir: 1, label: 'Finish', pt1: -6, pt2: -6, enabled: true },
  lane(0, 0.122, false),
  lane(1, 0.7752),
  lane(2, 0.6168),
  lane(3, 0.5067),
  lane(4, 0.4366),
  lane(5, 0.3471),
  lane(6, 0.2745),
];

/** 70% down a detected boat box: where auto zoom judges the lane. */
const boatPoint = (x: number, y0: number, y1: number) => ({
  x,
  y: y0 + (y1 - y0) * 0.7,
});

describe('laneAtPoint', () => {
  it('finds the lanes of detected boats, lanes above their guides', () => {
    // Bows 3, 4 and 5 at frame 91 of CT_20260329_144417.
    expect(
      laneAtPoint(tutorialGuides, false, boatPoint(905, 430, 546), W, H),
    ).toBe('3');
    expect(
      laneAtPoint(tutorialGuides, false, boatPoint(1098, 363, 477), W, H),
    ).toBe('4');
    expect(
      laneAtPoint(tutorialGuides, false, boatPoint(1599, 257, 355), W, H),
    ).toBe('5');
  });

  it('uses the nearest guide above for lanes below their guides', () => {
    expect(laneAtPoint(tutorialGuides, true, { x: 900, y: 500 }, W, H)).toBe(
      '4',
    );
  });

  it('finds no lane beyond the outer guide', () => {
    // Below Lane 1, with lanes above their guides.
    expect(
      laneAtPoint(tutorialGuides, false, { x: 900, y: 1000 }, W, H),
    ).toBeUndefined();
  });

  it('follows a sloped guide and skips disabled ones', () => {
    // Lane 2 runs from 0.5 at the left edge to 0.7 at the right.
    const guides = [
      lane(1, 0.9),
      { ...lane(2, 0.5), pt2: 0.7 },
      lane(3, 0.6, false),
    ];
    // At the left edge Lane 2's guide is at y 540: a point at 600 is below it.
    expect(laneAtPoint(guides, false, { x: 0, y: 600 }, W, H)).toBe('1');
    // At the right edge it is at y 756: the same point is above it.
    expect(laneAtPoint(guides, false, { x: W, y: 600 }, W, H)).toBe('2');
  });
});

describe('sprintLaneBow', () => {
  const sprint = {
    RaceType: 'Sprint',
    eventItems: ['1', '2', '3', '4', '5'].map((Bow) => ({ Bow })),
  };
  const point = boatPoint(1098, 363, 477);
  const base = {
    guides: tutorialGuides,
    laneBelowGuide: false,
    enableLaneGuides: true,
    event: sprint,
    point,
    width: W,
    height: H,
  };

  it('gives the bow of the lane in a sprint race', () => {
    expect(sprintLaneBow(base)).toBe('4');
  });

  it('adds the event bow prefix', () => {
    const prefixed = {
      RaceType: 'Sprint',
      eventItems: ['C3', 'C4', 'C5'].map((Bow) => ({ Bow })),
    };
    expect(sprintLaneBow({ ...base, event: prefixed })).toBe('C4');
  });

  it('needs a sprint race, lane guides shown and a scheduled lane', () => {
    expect(
      sprintLaneBow({ ...base, event: { ...sprint, RaceType: 'Head' } }),
    ).toBeUndefined();
    expect(sprintLaneBow({ ...base, event: undefined })).toBeUndefined();
    expect(sprintLaneBow({ ...base, enableLaneGuides: false })).toBeUndefined();
    const empty4 = { ...sprint, eventItems: [{ Bow: '3' }, { Bow: '5' }] };
    expect(sprintLaneBow({ ...base, event: empty4 })).toBeUndefined();
  });
});

const observation = (
  frameNum: number,
  edgeX: number,
  y: number,
  height: number,
): BoatObservation => ({
  frameNum,
  edge: 'left',
  edgeX,
  centerY: y + height / 2,
  detection: {
    text: '',
    confidence: 0,
    box: { x: 0, y: 0, width: 0, height: 0 },
    boatBox: { x: edgeX, y, width: 800, height },
  },
});

describe('autoZoomBoatPoint', () => {
  it('uses the observation nearest the crossing, 70% down the boat box', () => {
    const observations = [
      observation(91, 1098, 363, 114),
      observation(130, 960, 365, 110),
      observation(131, 950, 366, 110),
    ];
    expect(autoZoomBoatPoint({ frameNum: 130.8, observations })).toEqual({
      x: 950,
      y: 366 + 77,
    });
    expect(
      autoZoomBoatPoint({ frameNum: 1, observations: [] }),
    ).toBeUndefined();
  });
});

describe('laneBowAfterAutoZoom', () => {
  it('names the crew by the lane auto zoom ended on in a sprint race', () => {
    mockSettings.guides = tutorialGuides;
    mockEvent.current = {
      RaceType: 'Sprint',
      eventItems: ['3', '4', '5'].map((Bow) => ({ Bow })),
    };
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = {
      frameNum: 182.1,
      observations: [
        observation(182, 956, 257, 98),
        observation(183, 941, 258, 98),
      ],
    };
    expect(laneBowAfterAutoZoom(result)).toBe('5');
    mockEvent.current = { ...mockEvent.current, RaceType: 'Head' };
    expect(laneBowAfterAutoZoom(result)).toBeUndefined();
  });
});
