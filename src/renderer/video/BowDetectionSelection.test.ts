import type { BowDetection } from '../shared/AppTypes';
import {
  filterToCourseArea,
  selectBowCardNearestPoint,
} from './BowDetectionSelection';

const detection = (
  x: number,
  y: number,
  width = 20,
  height = 10,
): BowDetection => ({
  text: `${x}`,
  confidence: 0.9,
  box: { x, y, width, height },
  boatBox: { x, y, width: 100, height: 30 },
});

describe('selectBowCardNearestPoint', () => {
  test('selects the card whose center is nearest the click point', () => {
    const first = detection(10, 10);
    const nearest = detection(90, 45);
    const third = detection(150, 80);

    expect(
      selectBowCardNearestPoint([first, nearest, third], { x: 105, y: 52 }),
    ).toBe(nearest);
  });

  test('ignores detections without a bow card box', () => {
    const boatOnly = detection(100, 100, 0, 0);
    const card = detection(200, 200);

    expect(
      selectBowCardNearestPoint([boatOnly, card], { x: 100, y: 100 }),
    ).toBe(card);
  });

  test('returns undefined when no bow card was detected', () => {
    expect(
      selectBowCardNearestPoint([detection(100, 100, 0, 0)], {
        x: 100,
        y: 100,
      }),
    ).toBeUndefined();
  });
});

describe('filterToCourseArea', () => {
  const area = { enabled: true, top: 0.25, bottom: 0.9 };

  test('drops boats whose center is outside the course area', () => {
    // Boat boxes are 30 high, so centers are y + 15 in a 1000 high frame.
    const farShore = detection(10, 100);
    const onCourse = detection(10, 500);
    const nearEdge = detection(10, 950);

    expect(
      filterToCourseArea([farShore, onCourse, nearEdge], area, 1000),
    ).toEqual([onCourse]);
  });

  test('keeps a boat straddling a guide when its center is inside', () => {
    const straddling = detection(10, 240);

    expect(filterToCourseArea([straddling], area, 1000)).toEqual([straddling]);
  });

  test('uses the card box for a card found without a boat', () => {
    const cardOnly: BowDetection = {
      ...detection(10, 100),
      boatBox: { x: 0, y: 0, width: 0, height: 0 },
    };

    expect(filterToCourseArea([cardOnly], area, 1000)).toEqual([]);
  });

  test('returns all detections when the course area is off', () => {
    const detections = [detection(10, 100), detection(10, 500)];

    expect(
      filterToCourseArea(detections, { ...area, enabled: false }, 1000),
    ).toBe(detections);
  });
});
