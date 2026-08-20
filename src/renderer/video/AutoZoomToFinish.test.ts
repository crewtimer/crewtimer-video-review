import type { BowDetection } from '../shared/AppTypes';
import {
  areAdjacentBoatBoxesComparable,
  buildBoatMatchRecoveryFrames,
  chooseBracketRefinementFrame,
  ceilFrameToHyperZoomGrid,
  interpolateCrossingFrame,
  interpolateBoatEdgePoint,
  interpolateDetectionPair,
  interpolateBoatDetection,
  interpolateRect,
  isPlausibleExtendedVelocity,
  omitOverlappingBoatDetections,
  selectBoatEdgeNearPoint,
  selectBoatEdgeNearFinish,
  restoreMissingCardDetections,
  type BoatObservation,
} from './AutoZoomToFinish';

jest.mock('../util/ImageScaling', () => ({ updateVideoScaling: jest.fn() }));
jest.mock('./VideoSettings', () => ({}));
jest.mock('./VideoUtils', () => ({}));

const detection = (x: number, y = 100): BowDetection => ({
  text: '17',
  confidence: 0.9,
  box: { x: x + 10, y: y + 10, width: 20, height: 20 },
  boatBox: { x, y, width: 200, height: 50 },
});

const observation = (frameNum: number, x: number): BoatObservation => ({
  frameNum,
  detection: detection(x),
  edge: 'right',
  edgeX: x + 200,
  centerY: 125,
});

describe('Auto Zoom to Finish geometry', () => {
  test('searches both sides of a failed jump before backtracking', () => {
    expect(buildBoatMatchRecoveryFrames(4668, 4658, 1, 4752)).toEqual([
      4667, 4669, 4666, 4670, 4665, 4671, 4664, 4663, 4662, 4661, 4660, 4659,
    ]);
  });

  test('backtracks far enough to recover a valid frame before a bad jump', () => {
    const frames = buildBoatMatchRecoveryFrames(3899, 3871, 1, 6648);
    expect(frames).toContain(3889);
    expect(frames.at(-1)).toBe(3872);
  });

  test('keeps recovery frames within the video', () => {
    expect(buildBoatMatchRecoveryFrames(2, 1, 1, 10)).toEqual([3, 4, 5]);
  });

  test('rejects an adjacent full-frame box for a normally sized boat', () => {
    expect(
      areAdjacentBoatBoxesComparable(
        { x: 360, y: 283, width: 429, height: 112 },
        { x: 0, y: 273, width: 790, height: 222 },
      ),
    ).toBe(false);
  });

  test('rejects a large velocity jump while extending a boat track', () => {
    expect(isPlausibleExtendedVelocity(-17, -360)).toBe(false);
    expect(isPlausibleExtendedVelocity(-17, -20)).toBe(true);
  });

  test('selects the closest boat edge to the click', () => {
    const selected = selectBoatEdgeNearPoint([detection(100), detection(500)], {
      x: 302,
      y: 125,
    });
    expect(selected?.detection.boatBox.x).toBe(100);
    expect(selected?.edge).toBe('right');
  });

  test('rejects clicks farther than 50 pixels from every edge', () => {
    expect(
      selectBoatEdgeNearPoint([detection(100)], { x: 400, y: 300 }),
    ).toBeUndefined();
  });

  test('prefers a known bow near the finish over a closer unmatched boat', () => {
    const unmatched = detection(280);
    unmatched.text = '12';
    const matched = detection(250);
    matched.text = '17';
    const selected = selectBoatEdgeNearFinish(
      [unmatched, matched],
      500,
      '17',
      100,
    );
    expect(selected?.detection.text).toBe('17');
    expect(selected?.edge).toBe('right');
  });

  test('rejects finish-line boat edges beyond 100 pixels', () => {
    expect(
      selectBoatEdgeNearFinish([detection(100)], 500, '17'),
    ).toBeUndefined();
  });

  test('uses only the left boat edge for right-to-left automatic selection', () => {
    const wrongTrailingEdge = detection(300);
    const correctLeadingEdge = detection(490);
    const selected = selectBoatEdgeNearFinish(
      [wrongTrailingEdge, correctLeadingEdge],
      500,
      '',
      Number.POSITIVE_INFINITY,
      'left',
    );
    expect(selected?.detection).toBe(correctLeadingEdge);
    expect(selected?.edge).toBe('left');
  });

  test('uses only the right boat edge for left-to-right automatic selection', () => {
    const correctLeadingEdge = detection(290);
    const wrongTrailingEdge = detection(500);
    const selected = selectBoatEdgeNearFinish(
      [correctLeadingEdge, wrongTrailingEdge],
      500,
      '',
      Number.POSITIVE_INFINITY,
      'right',
    );
    expect(selected?.detection).toBe(correctLeadingEdge);
    expect(selected?.edge).toBe('right');
  });

  test('keeps the smallest valid detection among highly overlapping boats', () => {
    const large = detection(100);
    large.boatBox = { x: 90, y: 90, width: 240, height: 70 };
    large.text = '';
    const small = detection(100);
    small.text = '17';
    expect(omitOverlappingBoatDetections([large, small])).toEqual([small]);
  });

  test('retains overlapping detections when neither has a valid bow', () => {
    const first = detection(100);
    first.text = '';
    const second = detection(105);
    second.text = '?';
    expect(omitOverlappingBoatDetections([first, second])).toHaveLength(2);
  });

  test('restores a missing card from cached detection of the same boat', () => {
    const current = detection(102);
    current.text = '';
    current.box = { x: 0, y: 0, width: 0, height: 0 };
    const restored = restoreMissingCardDetections([current], [detection(100)]);
    expect(restored[0].boatBox.x).toBe(102);
    expect(restored[0].box).toEqual(detection(100).box);
    expect(restored[0].text).toBe('17');
  });

  test('does not restore a card from an unrelated cached boat', () => {
    const current = detection(500);
    current.box = { x: 0, y: 0, width: 0, height: 0 };
    const restored = restoreMissingCardDetections([current], [detection(100)]);
    expect(restored[0].box.width).toBe(0);
  });

  test('interpolates the fractional crossing frame', () => {
    expect(
      interpolateCrossingFrame(observation(10, 280), observation(11, 320), 500),
    ).toBeCloseTo(10.5);
  });

  test('centers zoom on the boat edge midpoint at the crossing', () => {
    const first = observation(10, 280);
    const second = observation(11, 320);
    first.centerY = 100;
    second.centerY = 140;
    expect(interpolateBoatEdgePoint(first, second, 10.5)).toEqual({
      x: 500,
      y: 120,
    });
  });

  test('can target 30 percent up from the bottom of the boat box', () => {
    const first = observation(10, 280);
    const second = observation(11, 320);
    first.detection.boatBox = { x: 100, y: 80, width: 200, height: 40 };
    second.detection.boatBox = { x: 120, y: 100, width: 200, height: 60 };
    expect(interpolateBoatEdgePoint(first, second, 10.5, 0.7)).toEqual({
      x: 500,
      y: 125,
    });
  });

  test('interpolates all boat box edges at the crossing fraction', () => {
    expect(
      interpolateRect(
        { x: 100, y: 50, width: 200, height: 40 },
        { x: 120, y: 54, width: 220, height: 44 },
        0.25,
      ),
    ).toEqual({ x: 105, y: 51, width: 205, height: 41 });
  });

  test('interpolates boat and card annotations between decoded frames', () => {
    const first = detection(100, 100);
    const second = detection(120, 108);
    const adjusted = interpolateDetectionPair(first, second, 0.25);
    expect(adjusted.boatBox).toEqual({
      x: 105,
      y: 102,
      width: 200,
      height: 50,
    });
    expect(adjusted.box).toEqual({
      x: 115,
      y: 112,
      width: 20,
      height: 20,
    });
  });

  test('recomputes the boat position for a nudged fractional frame', () => {
    const adjusted = interpolateBoatDetection(
      observation(10, 280),
      observation(11, 320),
      10.6,
    );
    expect(adjusted.boatBox.x).toBeCloseTo(304);
    expect(adjusted.boatBox.x + adjusted.boatBox.width).toBeCloseTo(504);
    expect(adjusted.box.x).toBeCloseTo(314);
    expect(adjusted.box.x + adjusted.box.width).toBeCloseTo(334);
  });

  test('keeps a tracked card relative to its boat when the next card is missing', () => {
    const first = observation(10, 280);
    const second = observation(11, 320);
    second.detection.box = { x: 0, y: 0, width: 0, height: 0 };
    second.detection.text = '';
    const adjusted = interpolateBoatDetection(first, second, 10.4);
    expect(adjusted.boatBox.x).toBeCloseTo(296);
    expect(adjusted.box.x).toBeCloseTo(306);
    expect(adjusted.box.y).toBeCloseTo(110);
    expect(adjusted.box.width).toBeCloseTo(20);
    expect(adjusted.box.height).toBeCloseTo(20);
    expect(adjusted.text).toBe('17');
    expect(interpolateBoatDetection(first, second, 10.6).text).toBe('17');
  });

  test('rounds the crossing timestamp up to the hyperzoom grid', () => {
    // Frame 10.5 is 350ms at 30fps when frame 10 is at 333ms. The next 2ms
    // grid point is 350ms, which maps back to frame 10.51.
    expect(ceilFrameToHyperZoomGrid(10.5, 10, 333000, 30, 2)).toBeCloseTo(
      10.51,
    );
  });

  test('does not move a timestamp already on the grid', () => {
    expect(ceilFrameToHyperZoomGrid(10, 10, 350000, 30, 2)).toBeCloseTo(10);
  });

  test('refines a wide crossing bracket near the estimated crossing', () => {
    expect(
      chooseBracketRefinementFrame(
        observation(165, 2099),
        observation(270, 945),
        1458,
      ),
    ).toBe(242);
    expect(
      chooseBracketRefinementFrame(
        observation(241, 1260),
        observation(242, 1240),
        1458,
      ),
    ).toBeUndefined();
  });
});
