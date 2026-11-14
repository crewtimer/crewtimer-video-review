import { getCurrentEvent } from '../util/UseSettings';
import { normalizeBowForEvent, type BowEvent } from './BowNumber';
import type { AutoZoomFinishResult } from './AutoZoomToFinish';
import {
  Dir,
  getImage,
  getVideoSettings,
  type GuideLine,
  type Point,
} from './VideoSettings';

/**
 * Where on the boat its lane is judged: this far down the boat box, on the
 * hull below the bow card and above the reflection.
 */
const LANE_POINT_FRACTION = 0.7;

/**
 * The lane a point lies in, from the enabled horizontal lane guides: the
 * trailing number of the guide's label, such as 3 for "Lane 3". With lanes
 * below their guides, a point is in the lane of the nearest guide above it;
 * otherwise of the nearest guide below it. Guides may slope; pt1 and pt2 are
 * fractions of the frame height at its left and right edges.
 */
export const laneAtPoint = (
  guides: GuideLine[],
  laneBelowGuide: boolean,
  point: Point,
  width: number,
  height: number,
): string | undefined => {
  let best: { lane: string; gap: number } | undefined;
  guides.forEach((guide) => {
    const lane = /(\d+)\s*$/.exec(guide.label)?.[1];
    if (!guide.enabled || guide.dir !== Dir.Horiz || lane === undefined) {
      return;
    }
    const y =
      (guide.pt1 + ((guide.pt2 - guide.pt1) * point.x) / width) * height;
    const gap = laneBelowGuide ? point.y - y : y - point.y;
    if (gap >= 0 && (!best || gap < best.gap)) {
      best = { lane, gap };
    }
  });
  return best?.lane;
};

/**
 * In a sprint race with lane guides shown, the event's bow for the lane at
 * point (the bow is the lane number), when the event schedules it.
 */
export const sprintLaneBow = ({
  guides,
  laneBelowGuide,
  enableLaneGuides,
  event,
  point,
  width,
  height,
}: {
  guides: GuideLine[];
  laneBelowGuide: boolean;
  enableLaneGuides: boolean;
  event: (BowEvent & { RaceType?: string }) | undefined;
  point: Point;
  width: number;
  height: number;
}): string | undefined => {
  if (!enableLaneGuides || event?.RaceType !== 'Sprint') {
    return undefined;
  }
  const lane = laneAtPoint(guides, laneBelowGuide, point, width, height);
  if (lane === undefined) {
    return undefined;
  }
  const bow = normalizeBowForEvent(lane, event).trim();
  return event.eventItems?.some((entry) => entry.Bow?.trim() === bow)
    ? bow
    : undefined;
};

/**
 * The point on the boat that auto zoom ended up on: the leading edge of the
 * observation nearest the crossing, LANE_POINT_FRACTION down its boat box.
 */
export const autoZoomBoatPoint = ({
  frameNum,
  observations,
}: Pick<AutoZoomFinishResult, 'frameNum' | 'observations'>):
  Point | undefined => {
  const nearest = [...observations].sort(
    (a, b) => Math.abs(a.frameNum - frameNum) - Math.abs(b.frameNum - frameNum),
  )[0];
  if (!nearest) return undefined;
  const { boatBox } = nearest.detection;
  return {
    x: nearest.edgeX,
    y: boatBox.y + boatBox.height * LANE_POINT_FRACTION,
  };
};

/**
 * The bow for the lane auto zoom ended up on, for a sprint race with lane
 * guides shown, or undefined. Used when no bow card could be read.
 */
export const laneBowAfterAutoZoom = (
  result: Pick<AutoZoomFinishResult, 'frameNum' | 'observations'>,
): string | undefined => {
  const point = autoZoomBoatPoint(result);
  const image = getImage();
  if (!point || !image.width || !image.height) return undefined;
  const { guides, laneBelowGuide, enableLaneGuides } = getVideoSettings();
  const bow = sprintLaneBow({
    guides,
    laneBelowGuide,
    enableLaneGuides,
    event: getCurrentEvent(),
    point,
    width: image.width,
    height: image.height,
  });
  if (bow) {
    console.log(`Auto zoom: no bow card read; using bow ${bow} from its lane`);
  }
  return bow;
};
