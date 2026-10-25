import { convertTimestampToLocalMicros } from 'renderer/shared/Util';
import { FileStatus, TimeSegment } from './VideoTypes';

export type SegmentBounds = Pick<
  TimeSegment,
  'startTsMicro' | 'endTsMicro' | 'fps'
>;

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

/** Time where ownership passes from one segment to the next: the midpoint
 * between the first segment's last frame and the next segment's first frame.
 * Files that overlap split the overlap in half; files with a gap between them
 * split the gap in half. */
export const segmentSplitMicro = (
  before: SegmentBounds,
  after: SegmentBounds,
) => (before.endTsMicro + after.startTsMicro) / 2;

/** The part of a segment's own frames that it owns. With no overlap this is
 * the whole segment. */
export function ownedRange(
  segments: SegmentBounds[],
  index: number,
): { startTsMicro: number; endTsMicro: number } {
  const segment = segments[index];
  const prev = segments[index - 1];
  const next = segments[index + 1];
  return {
    startTsMicro: prev
      ? Math.min(
          segment.endTsMicro,
          Math.max(segment.startTsMicro, segmentSplitMicro(prev, segment)),
        )
      : segment.startTsMicro,
    endTsMicro: next
      ? Math.max(
          segment.startTsMicro,
          Math.min(segment.endTsMicro, segmentSplitMicro(segment, next)),
        )
      : segment.endTsMicro,
  };
}

/** Find the segment that owns the hint. Ownership passes to the next segment
 * at segmentSplitMicro, so a hint where two files overlap goes to the file
 * whose own range it is nearer the middle of, and a hint between files goes
 * to the file whose edge frame is nearer, provided it is within one frame
 * interval of that edge. A hint exactly at the split goes to the earlier
 * segment. Pass every file so ownership is decided once; segments must be
 * sorted by start time and only neighbouring segments may overlap. */
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
  // segments[high] is the last to start at or before the hint. The owner is
  // it or one of its neighbours.
  let index = high;
  if (
    index > 0 &&
    timestampMicro <= segmentSplitMicro(segments[index - 1], segments[index])
  ) {
    index -= 1;
  } else if (
    index + 1 < segments.length &&
    (index < 0 ||
      timestampMicro > segmentSplitMicro(segments[index], segments[index + 1]))
  ) {
    index += 1;
  }
  const segment = segments[index];
  if (
    segment &&
    timestampMicro >= segment.startTsMicro - frameMicro(segment) &&
    timestampMicro <= segment.endTsMicro + frameMicro(segment)
  ) {
    return { segment, segmentIndex: index };
  }
  return { segment: undefined, segmentIndex: -1 };
}

type FileFrames = Pick<
  FileStatus,
  'startTime' | 'endTime' | 'numFrames' | 'fps'
>;

/** UTC bounds of each file. Ownership splits are the same in UTC and local
 * time, so stepping between files needs no time zone. */
const utcBounds = (files: FileFrames[]): SegmentBounds[] =>
  files.map((file) => ({
    startTsMicro: file.startTime,
    endTsMicro: file.endTime,
    fps: file.fps,
  }));

/** Files whose frame times are known, so frame numbers map to times. */
const hasFrames = (file: FileFrames | undefined): file is FileFrames =>
  Boolean(file && file.numFrames > 1 && file.endTime > file.startTime);

/** Position of a time in a file as a fractional frame number (1-based). */
const frameAt = (file: FileFrames, timeMicro: number) =>
  1 +
  ((timeMicro - file.startTime) / (file.endTime - file.startTime)) *
    (file.numFrames - 1);

const timeAt = (file: FileFrames, frameNum: number) =>
  file.startTime +
  ((frameNum - 1) / (file.numFrames - 1)) * (file.endTime - file.startTime);

/** First and last frames a file owns. A file that overlaps its neighbours
 * gives up the frames past the split. */
export function ownedFrames(
  files: FileFrames[],
  index: number,
): { first: number; last: number } | undefined {
  const file = files[index];
  if (!hasFrames(file)) {
    return undefined;
  }
  const owned = ownedRange(utcBounds(files), index);
  const clamp = (frameNum: number) =>
    Math.max(1, Math.min(file.numFrames, frameNum));
  // A frame exactly at the split belongs to the earlier file.
  const first =
    owned.startTsMicro > file.startTime
      ? clamp(Math.floor(frameAt(file, owned.startTsMicro)) + 1)
      : 1;
  const last =
    owned.endTsMicro < file.endTime
      ? clamp(Math.floor(frameAt(file, owned.endTsMicro)))
      : file.numFrames;
  return { first, last };
}

/** When stepping to a frame that lies past the split with an overlapping
 * neighbour, returns the neighbour and its frame at the same time, so stepping
 * continues at that time instead of jumping to the neighbour's first or last
 * frame. Returns undefined when the frame stays in this file or the files
 * don't overlap. */
export function overlapHandover(
  files: FileFrames[],
  index: number,
  frameNum: number,
): { fileIndex: number; frameNum: number } | undefined {
  const file = files[index];
  if (!hasFrames(file)) {
    return undefined;
  }
  const timeMicro = timeAt(file, frameNum);
  const bounds = utcBounds(files);
  const handover = (neighbourIndex: number) => {
    const neighbour = files[neighbourIndex];
    if (!hasFrames(neighbour)) {
      return undefined;
    }
    return {
      fileIndex: neighbourIndex,
      frameNum: Math.max(
        1,
        Math.min(neighbour.numFrames, frameAt(neighbour, timeMicro)),
      ),
    };
  };
  const next = files[index + 1];
  if (
    next &&
    next.startTime <= file.endTime &&
    timeMicro > segmentSplitMicro(bounds[index], bounds[index + 1])
  ) {
    return handover(index + 1);
  }
  const prev = files[index - 1];
  if (
    prev &&
    file.startTime <= prev.endTime &&
    timeMicro <= segmentSplitMicro(bounds[index - 1], bounds[index])
  ) {
    return handover(index - 1);
  }
  return undefined;
}
