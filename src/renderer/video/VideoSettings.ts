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

export const [useVideoDir, setVideoDir, getVideoDir] = UseStoredDatum(
  N_VIDEO_DIR,
  '.'
);

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
