import { convertTimestampToLocalMicros } from 'renderer/shared/Util';
import { FileStatus, TimeSegment } from './VideoTypes';

type SegmentBounds = Pick<TimeSegment, 'startTsMicro' | 'endTsMicro' | 'fps'>;

const frameMicro = (segment: SegmentBounds) =>
  segment.fps && segment.fps > 0 ? 1000000 / segment.fps : 0;

/** Local time-of-day bounds of each video file, for use with findTimeSegment. */
export const fileSegmentBounds = (
  fileStatusList: FileStatus[],
): SegmentBounds[] =>
  fileStatusList.map((item) => ({
    startTsMicro: convertTimestampToLocalMicros(item.startTime, item.tzOffset),
    endTsMicro: convertTimestampToLocalMicros(item.endTime, item.tzOffset),
    fps: item.fps,
  }));

/** Find the segment that owns the hint. A hint between segments goes to the
 * one whose edge frame is nearer, provided it is within one frame interval of
 * that edge. A hint equally distant from both goes to the earlier segment.
 * Pass every file so ownership is decided once; segments must be sorted by
 * start time and must not overlap. */
export function findTimeSegment<T extends SegmentBounds>(
  segments: T[],
  timestampMicro: number,
): { segment: T | undefined; segmentIndex: number } {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (segments[mid].startTsMicro <= timestampMicro) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  // segments[high] is the last to start at or before the hint.
  const before = segments[high];
  if (before && timestampMicro <= before.endTsMicro) {
    return { segment: before, segmentIndex: high };
  }
  const after = segments[high + 1];
  const beforeGap = before ? timestampMicro - before.endTsMicro : Infinity;
  const afterGap = after ? after.startTsMicro - timestampMicro : Infinity;
  if (before && beforeGap <= afterGap && beforeGap <= frameMicro(before)) {
    return { segment: before, segmentIndex: high };
  }
  if (after && afterGap < beforeGap && afterGap <= frameMicro(after)) {
    return { segment: after, segmentIndex: high + 1 };
  }
  return { segment: undefined, segmentIndex: -1 };
}
