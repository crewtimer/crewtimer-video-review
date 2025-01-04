import { UseDatum } from 'react-usedatum';
import { AppImage } from 'renderer/shared/AppTypes';
import { N_IMAGE, N_VIDEO_FILE, N_VIDEO_DIR } from 'renderer/shared/Constants';
import { UseMemDatum, UseStoredDatum } from 'renderer/store/UseElectronDatum';
import { generateTestPattern } from '../util/ImageUtils';

export interface VideoPosition {
  frameNum: number;
  file: string;
}
export type Point = { x: number; y: number };

export interface VideoScaling {
  destWidth: number; /// Width in pixels of destination canvas
  destHeight: number; /// width in pixels of destination canvas
  srcWidth: number; /// Width of source image
  srcHeight: number; /// Height of source image
  srcCenterPoint: Point; /// Center point in source image units
  zoomX: number; // x-axis zoom factor
  zoomY: number; // y-axis zoom factor

  // Calculated from above parms
  scaleX: number; /// transform from src canvas to dest canvas
  scaleY: number; /// transform from src canvas to dest canvas
  destX: number; /// X offset in dest canvas units of image
  destY: number; /// Y offset in dest canvas units of image
}

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
  enableLaneGuides: boolean;
  enableAutoZoom: boolean;
}

/** Contents of the json video sidecar file */
export interface VideoSidecar extends VideoGuides {
  file: {
    startTs: string; /// Start timestamp in UTC seconds
    stopTs: string; /// Stop timestamp in UTC seconds
    numFrames: number; /// Number of video frames in the video
    fps: number; /// The number of frames/second
    tzOffset?: number; /// Timezone offset in minutes
    tzName?: string; /// Timezone name
  };
  guide?: {
    pt1: number;
    pt2: number;
  };
}

/**
 *  Read the current video guide settings from a JSON file.  The JSON file is named after the video file
 *
 * @param videoFile - The path to the video file
 * @param loadOnly - If true, do not update the video settings
 */
// eslint-disable-next-line import/no-mutable-exports
export let loadVideoSidecar = (
  videoFile: string,
  loadOnly?: boolean,
): Promise<VideoSidecar | undefined> => {
  videoFile as any;
  loadOnly as any;
  return Promise.resolve(undefined);
};

export const setLoadVideoSidecar = (func: typeof loadVideoSidecar) => {
  // eslint-disable-next-line no-import-assign
  loadVideoSidecar = func;
};

export const [useVideoScaling, setVideoScaling, getVideoScaling] =
  UseDatum<VideoScaling>({
    destX: 0,
    destY: 0,
    destWidth: 1,
    destHeight: 1,
    srcCenterPoint: { x: 0, y: 0 },
    srcWidth: 1,
    srcHeight: 1,
    scaleX: 1,
    scaleY: 1,
    zoomX: 1,
    zoomY: 1,
  });

export const [useJumpToEndPending, setJumpToEndPending] = UseDatum(false);

export const [useVideoError, setVideoError] = UseDatum<string | undefined>(
  undefined,
);
export const [useVideoFrameNum, setVideoFrameNum, getVideoFrameNum] =
  UseDatum<number>(1);

export const [useVideoFile, setVideoFile, getVideoFile] = UseStoredDatum(
  N_VIDEO_FILE,
  '',
  (current) => {
    loadVideoSidecar(current);
  },
);
export const [useVideoTimestamp, setVideoTimestamp, getVideoTimestamp] =
  UseDatum('');
export const [useVideoBow, setVideoBow, getVideoBow] = UseDatum('');
export const [useVideoEvent, setVideoEvent, getVideoEvent] = UseDatum('');
export const [usePlaceSort, setPlaceSort, getSortPlace] = UseDatum(true);
export const [useSelectedIndex, setSelectedIndex, getSelectedIndex] =
  UseDatum(0);

export const [useTravelRightToLeft, , getTravelRightToLeft] = UseStoredDatum(
  'travelRightToLeft',
  false,
);

export const [useHyperZoomFactor, , getHyperZoomFactor] = UseStoredDatum(
  'hyperZoomFactor',
  0,
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
  '.',
);

export const VideoGuidesKeys: (keyof VideoGuides)[] = [
  'guides',
  'laneBelowGuide',
  'enableLaneGuides',
  'enableAutoZoom',
];

/**
 * Global video setting defaults
 */
export interface VideoSettings extends VideoGuides {
  timingHintSource: string;
  sidecarSource?: string;
}

export const [useVideoSettings, setVideoSettings, getVideoSettings] =
  UseStoredDatum<VideoSettings>('videoSettings', {
    timingHintSource: '',
    laneBelowGuide: false,
    enableLaneGuides: true,
    enableAutoZoom: true,
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
  generateTestPattern(),
);

export const [useAutoZoomPending, setAutoZoomPending, getAutoZoomPending] =
  UseDatum<undefined | Point>(undefined);
