import type { BowDetection } from '../shared/AppTypes';
import type { Point } from './VideoSettings';

/** Return the detected bow card whose center is nearest the source click. */
export const selectBowCardNearestPoint = (
  detections: BowDetection[],
  point: Point,
) => {
  let nearest: BowDetection | undefined;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  detections.forEach((detection) => {
    const { box } = detection;
    if (box.width <= 0 || box.height <= 0) {
      return;
    }

    const deltaX = box.x + box.width / 2 - point.x;
    const deltaY = box.y + box.height / 2 - point.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared < nearestDistanceSquared) {
      nearest = detection;
      nearestDistanceSquared = distanceSquared;
    }
  });

  return nearest;
};
