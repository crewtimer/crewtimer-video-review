import moment from 'moment';
import { UseDatum } from 'react-usedatum';
import { AppImage, Rect } from 'renderer/shared/AppTypes';
import {
  N_IMAGE,
  N_VIDEO_FILE,
  N_VIDEO_DIR,
  N_TIMEZONE,
} from 'renderer/shared/Constants';
import { UseMemDatum, UseStoredDatum } from 'renderer/store/UseElectronDatum';
import generateTestPattern from '../util/ImageUtils';
import { loadVideoSidecar } from './VideoUtils';

export interface VideoPosition {
  frameNum: number;
  file: string;
}
export type Point = { x: number; y: number };

export interface VideoScaling {
  destX: number; /// X offset in dest canvas units of image
  destY: number; /// Y offset in dest canvas units of image
  destWidth: number; /// Width in pixels of destination canvas
  destHeight: number; /// width in pixels of destination canvas
  srcCenterPoint: Point; /// Center point in source image units
  srcWidth: number; /// Width of source image
  srcHeight: number; /// Height of source image
  scaledWidth: number; /// Width in zoomed pixels of dest canvas
  scaledHeight: number; /// Height in zoomed pixels of dest canvas
  pixScale: number; /// convert canvas pixels to src pixels
  zoom: number; /// zoom factor
}

export const [useVideoScaling, setVideoScaling, getVideoScaling] =
  UseDatum<VideoScaling>({
    destX: 0,
    destY: 0,
    destWidth: 1,
    destHeight: 1,
    srcCenterPoint: { x: 0, y: 0 },
    srcWidth: 1,
    srcHeight: 1,
    scaledWidth: 1,
    scaledHeight: 1,
    pixScale: 1,
    zoom: 1,
  });

export const [useVideoError, setVideoError] = UseDatum<string | undefined>(
  undefined
);
export const [useZoomWindow, setZoomWindow, getZoomWindow] = UseDatum<Rect>({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

export const [useVideoFrameNum, setVideoFrameNum, getVideoFrameNum] =
  UseDatum<number>(1);

export const [useVideoFile, setVideoFile, getVideoFile] = UseStoredDatum(
  N_VIDEO_FILE,
  '',
  (current) => {
    loadVideoSidecar(current);
    return;
  }
);
export const [useVideoTimestamp, setVideoTimestamp, getVideoTimestamp] =
  UseDatum('');
export const [useVideoBow, setVideoBow, getVideoBow] = UseDatum('');
export const [useVideoEvent, setVideoEvent, getVideoEvent] = UseDatum('');
export const [usePlaceSort, setPlaceSort, getSortPlace] = UseDatum(true);
export const [useSelectedIndex, setSelectedIndex, getSelectedIndex] =
  UseDatum(0);

export const [useTimezoneOffset, setTimezoneOffset, getTimezoneOffset] =
  UseDatum<number | undefined>(undefined);
export const [useTimezone, setTimezone, getTimezone] = UseStoredDatum<string>(
  N_TIMEZONE,
  '',
  (newValue) => {
    let currentOffsetMinutes = undefined;
    if (newValue) {
      const tzDetails = moment.tz.zone(newValue);
      // Get the current offset in minutes for the specified timezone
      currentOffsetMinutes = tzDetails?.utcOffset(moment().valueOf());
    }

    if (currentOffsetMinutes === undefined) {
      // If the timezone is not set, default to the local timezone
      currentOffsetMinutes = new Date().getTimezoneOffset();
    }

    // Store as an offset that can be added to UTC to get local time
    setTimezoneOffset(-currentOffsetMinutes);
  }
);
export const [useTravelRightToLeft, , getTravelRightToLeft] = UseStoredDatum(
  'travelRightToLeft',
  false
);

export const [useHyperZoomFactor, , getHyperZoomFactor] = UseStoredDatum(
  'hyperZoomFactor',
  2
);
export const [useResetZoomCounter, setResetZoomCounter, getResetZoomCounter] =
  UseDatum(0);
export const resetVideoZoom = () => {
  setResetZoomCounter((c) => c + 1);
};

/// Mouse wheel zoom factor
export const [useMouseWheelFactor, setMouseWheelFactor, getMouseWheelFactor] =
  UseStoredDatum<number>('wheelFactor', 4);
export const [useMouseWheelInverted] = UseStoredDatum('wheelInvert', false);

export const [useVideoDir, setVideoDir, getVideoDir] = UseStoredDatum(
  N_VIDEO_DIR,
  '.'
);

export enum Dir {
  Horiz,
  Vert,
}

export interface GuideLine {
  enabled: boolean;
  dir: Dir;
  label: string;
  pt1: number; /// Vert: offset from center, H: Offset from top of video in video pixel units
  pt2: number;
}

/**
 * Video props stored with each video file as a .json file
 */
export interface VideoGuides {
  guides: GuideLine[];
  laneBelowGuide: boolean;
}

/**
 * Global video setting defaults
 */
interface VideoSettings extends VideoGuides {
  timingHintSource: string;
  sidecarSource?: string;
}
export const [useVideoSettings, setVideoSettings, getVideoSettings] =
  UseStoredDatum<VideoSettings>('videoSettings', {
    timingHintSource: '',
    laneBelowGuide: false,
    guides: [
      { dir: Dir.Vert, pt1: 0, pt2: 0, label: 'Finish', enabled: true },
      { dir: Dir.Horiz, pt1: 200, pt2: 200, label: 'Lane 0', enabled: false },
      { dir: Dir.Horiz, pt1: 210, pt2: 210, label: 'Lane 1', enabled: false },
      { dir: Dir.Horiz, pt1: 220, pt2: 220, label: 'Lane 2', enabled: false },
      { dir: Dir.Horiz, pt1: 230, pt2: 230, label: 'Lane 3', enabled: false },
      { dir: Dir.Horiz, pt1: 240, pt2: 240, label: 'Lane 4', enabled: false },
      { dir: Dir.Horiz, pt1: 250, pt2: 250, label: 'Lane 5', enabled: false },
      { dir: Dir.Horiz, pt1: 260, pt2: 260, label: 'Lane 6', enabled: false },
      { dir: Dir.Horiz, pt1: 270, pt2: 270, label: 'Lane 7', enabled: false },
      { dir: Dir.Horiz, pt1: 280, pt2: 280, label: 'Lane 8', enabled: false },
      { dir: Dir.Horiz, pt1: 290, pt2: 290, label: 'Lane 9', enabled: false },
      {
        dir: Dir.Horiz,
        pt1: 300,
        pt2: 300,
        label: 'Lane 10',
        enabled: false,
      },
      {
        dir: Dir.Horiz,
        pt1: 310,
        pt2: 310,
        label: 'Lane 11',
        enabled: false,
      },
    ],
  });

export const [useImage, setImage, getImage] = UseMemDatum<AppImage>(
  N_IMAGE,
  generateTestPattern()
);
