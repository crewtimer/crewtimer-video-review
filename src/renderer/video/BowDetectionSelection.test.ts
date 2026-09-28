import type { BowDetection } from '../shared/AppTypes';
import { selectBowCardNearestPoint } from './BowDetectionSelection';

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
