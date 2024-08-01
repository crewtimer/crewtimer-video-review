/**
 * Represents a time segment with start and end times.
 */
export type TimeSegment = {
  /** The start time of the segment in HH:MM:SS.sss format. */
  startTime: string;
  /** The end time of the segment in HH:MM:SS.sss format. */
  endTime: string;
  label: string;
  pct: number;
  pctOffset: number;
  startTsMicro: number;
  endTsMicro: number;
};
