import { KeyMap } from 'crewtimer-common';

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

/**
 * Represents a time object with a time property in HH:MM:SS.sss format.
 */
export type TimeObject = {
  Time: string;
  Bow: string;
  EventNum: string;
};

export interface FileStatus {
  open: boolean;
  numFrames: number;
  filename: string;
  startTime: number;
  endTime: number;
  duration: number;
  fps: number;
  tzOffset: number;
  tzName?: string;
  sidecar: KeyMap;
}
