import { UseDatum } from 'react-usedatum';
import { AppImage, Rect } from 'renderer/shared/AppTypes';
import {
  N_IMAGE,
  N_IMAGE_FRAMES,
  N_VIDEO_FILE,
  N_VIDEO_DIR,
} from 'renderer/shared/Constants';
import { UseMemDatum, UseStoredDatum } from 'renderer/store/UseElectronDatum';

export interface VideoPosition {
  frameNum: number;
  file: string;
}

export const [useZoomWindow, setZoomWindow] = UseDatum<Rect>({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});
export const [useVideoPosition, setVideoPosition] = UseDatum<VideoPosition>({
  frameNum: 0,
  file: '',
});

export const [useVideoFile, setVideoFile, getVideoFile] = UseStoredDatum(
  N_VIDEO_FILE,
  ''
);
export const [useVideoTimestamp, setVideoTimestamp] = UseDatum('');
export const [useVideoBow, setVideoBow] = UseDatum('');
export const [useVideoEvent, setVideoEvent] = UseDatum('');
export const [useSelectedIndex, setSelectedIndex] = UseDatum(0);

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
interface VideoSettings {
  guides: GuideLine[];
  lane1Top: boolean;
  travelRtoL: boolean;
  videoPanel: boolean;
  timingPanel: boolean;
}
export const [useVideoSettings, , getVideoSettings] =
  UseStoredDatum<VideoSettings>('videoSettings', {
    lane1Top: false,
    travelRtoL: false,
    videoPanel: true,
    timingPanel: true,
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

export const [useImage, setImage] = UseMemDatum<AppImage>(N_IMAGE, {
  height: 0,
  width: 0,
  frameNum: 0,
  timestamp: 0,
  fps: 30,
  numFrames: 0,
  data: new Uint8Array(0),
  file: '',
});

export const [useNumFrames] = UseMemDatum(N_IMAGE_FRAMES, 1);
