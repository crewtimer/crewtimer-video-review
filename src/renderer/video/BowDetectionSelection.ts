import type { BowDetection } from '../shared/AppTypes';
import type { CourseArea, Point } from './VideoSettings';

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

/**
 * Keep the detections whose boat sits between the course area guides,
 * judged by the vertical center of the boat box (or the card box for a
 * card found without a boat). Returns the detections unchanged when the
 * course area is off or the frame height is unknown.
 */
export const filterToCourseArea = (
  detections: BowDetection[],
  courseArea: CourseArea,
  frameHeight: number,
) => {
  if (!courseArea.enabled || !(frameHeight > 1)) {
    return detections;
  }
  const top = courseArea.top * frameHeight;
  const bottom = courseArea.bottom * frameHeight;
  return detections.filter(({ boatBox, box }) => {
    const rect = boatBox.width > 0 && boatBox.height > 0 ? boatBox : box;
    if (!(rect.width > 0 && rect.height > 0)) {
      return true;
    }
    const centerY = rect.y + rect.height / 2;
    return centerY >= top && centerY <= bottom;
  });
};
