/**
 * Renders an image of each lap published from this app, plus a thumbnail, and
 * hands them to main for upload to Cloud Storage
 * (ctvideo/{regattaID}/{uuid}.jpg and {uuid}-tn.jpg).
 *
 * When a time is recorded from the video, the image is the exact frame that
 * produced that time: the displayed frame itself when not zoomed, or a
 * whole-frame RIFE at the same fractional frame when zoomed (the displayed
 * frame then only has the visible region interpolated).  Any other frame
 * fetch runs in the background so the reviewer's view is never disturbed.
 */
import { Lap } from 'crewtimer-common';
import type { AppImage } from 'renderer/shared/AppTypes';
import { onLapPublished } from '../util/LapStorageDatum';
import { getUploadLapImages } from '../util/UseSettings';
import {
  findSeekTarget,
  requestBackgroundVideoFrame,
} from './RequestVideoFrame';
import {
  DEFAULT_GUIDE_COLOR,
  getImage,
  getInterpolationTechnique,
  getVideoScaling,
  getVideoSettings,
  Dir,
  VideoSidecar,
} from './VideoSettings';
import { getFinishLine } from './VideoUtils';
import { getFileStatusByName } from './VideoFileStatus';
import { drawCornerBadge } from './FinishPhoto';

/** Wait for a lap to stop changing before rendering it. */
const SETTLE_MS = 2000;
const MAX_WIDTH = 1920;
const JPEG_QUALITY = [0.85, 0.7, 0.5];
/** Must stay under the storage.rules ctvideo size limit. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Longest thumbnail side, matching scripts/make_thumbnails.py --size 150. */
const THUMB_SIZE = 150;
/** The make_thumbnails.py default quality. */
const THUMB_QUALITY = 0.85;

/** Native code clamps this oversized crop to an exact full-frame RIFE request. */
const FULL_FRAME_CROP = { x: 0, y: 0, width: 100000, height: 100000 };

/** Finish guide offsets from frame center, as in GuideLine. */
interface FinishGuide {
  pt1: number;
  pt2: number;
}

/** The displayed frame a recorded time came from. */
interface LapFrame {
  image: AppImage;
  /** Finish guide of the captured frame's file; guides change per file. */
  finish: FinishGuide;
  /** Zoomed views only RIFE-interpolate the visible region. */
  zoomed: boolean;
  /**
   * Whole-frame RIFE at the same fractional frame, started at capture so it
   * overlaps the zoom-out and seek to the next crew.  Set only when needed.
   */
  wholeFrame?: Promise<AppImage | undefined>;
}

interface PendingLap {
  lap: Lap;
  frame?: LapFrame;
}

const pendingLaps = new Map<string, PendingLap>();
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Bumped on every publish so a render overtaken by a newer one is dropped. */
const generations = new Map<string, number>();
/** Frames captured by captureLapFrame, claimed by the following publish. */
const capturedFrames = new Map<string, LapFrame>();

/** The image and time most recently shown in the video timestamp display. */
let displayedTimestamp: { image: AppImage; time: string } | undefined;

/**
 * Record which image produced the displayed timestamp.  A time typed into the
 * Time field does not update this, so it never matches the displayed frame.
 */
export const setDisplayedTimestampImage = (image: AppImage, time: string) => {
  displayedTimestamp = { image, time };
};

/**
 * Capture the displayed frame for a lap being recorded from the video.  Call
 * before publishing and before the view moves on to the next crew.
 */
export const captureLapFrame = (lap: Lap) => {
  if (!getUploadLapImages() || !lap.uuid || !lap.Time) return;
  const image = getImage();
  if (
    !displayedTimestamp ||
    displayedTimestamp.image !== image ||
    displayedTimestamp.time !== lap.Time
  ) {
    return;
  }
  const zoomed = getVideoScaling().zoomY !== 1;
  const { pt1, pt2 } = getFinishLine();
  const frame: LapFrame = { image, zoomed, finish: { pt1, pt2 } };
  // An integral frameNum is a decoded frame with no interpolation, so a zoomed
  // view of it is already exact.  Otherwise only the visible region was
  // interpolated, so interpolate the whole frame now.
  if (zoomed && !Number.isInteger(image.frameNum)) {
    // Timing is logged by requestBackgroundVideoFrame ('Background frame rife crop ...').
    frame.wholeFrame = requestBackgroundVideoFrame({
      videoFile: image.file,
      frameNum: image.frameNum,
      blend: true,
      saveAs: '',
      closeTo: false,
      interpMethod: 'rife',
      crop: FULL_FRAME_CROP,
    }).catch((e) => {
      console.warn(
        'Whole-frame RIFE failed',
        e instanceof Error ? e.message : e,
      );
      return undefined;
    });
  }
  capturedFrames.set(lap.uuid, frame);
};

/**
 * Finish guide saved for a video file, read from its sidecar the same way
 * VideoFileUtils loads it, falling back to the current guide.
 */
const finishForFile = (videoFile: string): FinishGuide => {
  const sidecar = getFileStatusByName(videoFile)?.sidecar as
    VideoSidecar | undefined;
  if (sidecar?.guides) {
    const vert = sidecar.guides.find((guide) => guide.dir === Dir.Vert);
    return vert?.enabled
      ? { pt1: vert.pt1, pt2: vert.pt2 }
      : { pt1: 0, pt2: 0 };
  }
  if (sidecar?.guide) {
    return { pt1: Number(sidecar.guide.pt1), pt2: Number(sidecar.guide.pt2) };
  }
  const { pt1, pt2 } = getFinishLine();
  return { pt1, pt2 };
};

/** Fetch the frame to save and the finish guide that belongs to it. */
const getLapFrameImage = async (
  time: string,
  frame?: LapFrame,
): Promise<{ image: AppImage; finish: FinishGuide } | undefined> => {
  if (frame?.wholeFrame) {
    console.log(`Lap image ${time}: using whole-frame RIFE from capture`);
    const image = await frame.wholeFrame;
    return image && { image, finish: frame.finish };
  }
  if (frame) {
    console.log(
      `Lap image ${time}: using displayed frame ${frame.image.frameNum} ` +
        `(${frame.zoomed ? 'zoomed, decoded frame' : 'not zoomed'})`,
    );
    return { image: frame.image, finish: frame.finish };
  }
  // Not recorded from the video (e.g. edited in the lap list): seek by time.
  console.log(`Lap image ${time}: not recorded from video, seeking by time`);
  const target = findSeekTarget(time);
  if (!target) return undefined;
  const finish = finishForFile(target.videoFile);
  const interpMethod = getInterpolationTechnique();
  const image = await requestBackgroundVideoFrame({
    videoFile: target.videoFile,
    toTimestamp: target.time,
    blend: true,
    saveAs: '',
    closeTo: false,
    interpMethod,
    crop: interpMethod === 'rife' ? FULL_FRAME_CROP : undefined,
  });
  return image && { image, finish };
};

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

/**
 * Scale the image so its longer side is at most THUMB_SIZE, never upscaling.
 * Halving in steps first keeps detail that a single large downscale skips.
 */
const renderThumbnail = async (
  image: HTMLCanvasElement,
): Promise<Uint8Array | undefined> => {
  const scale = Math.min(1, THUMB_SIZE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  let current = image;
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const half = document.createElement('canvas');
    half.width = Math.round(current.width / 2);
    half.height = Math.round(current.height / 2);
    const halfCtx = half.getContext('2d');
    if (!halfCtx) return undefined;
    halfCtx.imageSmoothingQuality = 'high';
    halfCtx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  const thumb = document.createElement('canvas');
  thumb.width = width;
  thumb.height = height;
  const ctx = thumb.getContext('2d');
  if (!ctx) return undefined;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, width, height);
  const blob = await toJpeg(thumb, THUMB_QUALITY);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
};

/** Draw the lap frame with the finish line and the bow number. */
const renderLapImage = async (
  lap: Lap,
  frame?: LapFrame,
): Promise<{ jpeg: Uint8Array; thumbnail?: Uint8Array } | undefined> => {
  const { Time: time = '', Bow: bow = '' } = lap;
  const result = await getLapFrameImage(time, frame);
  if (!result) return undefined;
  const { image, finish } = result;

  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) return undefined;
  sourceCtx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );

  const scale = Math.min(1, MAX_WIDTH / image.width);
  const out = document.createElement('canvas');
  out.width = Math.round(image.width * scale);
  out.height = Math.round(image.height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, out.width, out.height);

  ctx.strokeStyle = getVideoSettings().guideColor || DEFAULT_GUIDE_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(out.width * 0.0015));
  ctx.beginPath();
  ctx.moveTo((image.width / 2 + finish.pt1) * scale, 0);
  ctx.lineTo((image.width / 2 + finish.pt2) * scale, out.height);
  ctx.stroke();

  const fontSize = Math.max(16, Math.round(out.height * 0.04));
  drawCornerBadge(ctx, [bow], 'right', fontSize);

  for (const quality of JPEG_QUALITY) {
    // eslint-disable-next-line no-await-in-loop
    const blob = await toJpeg(out, quality);
    if (blob && blob.size < MAX_BYTES) {
      // eslint-disable-next-line no-await-in-loop
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      // eslint-disable-next-line no-await-in-loop
      const thumbnail = await renderThumbnail(out);
      return { jpeg, thumbnail };
    }
  }
  return undefined;
};

const processLap = async (uuid: string) => {
  const pending = pendingLaps.get(uuid);
  pendingLaps.delete(uuid);
  settleTimers.delete(uuid);
  if (!pending) return;
  const { lap, frame } = pending;
  const generation = generations.get(uuid);
  try {
    const rendered = await renderLapImage(lap, frame);
    if (generations.get(uuid) !== generation || !getUploadLapImages()) {
      // Republished, deleted, or uploads turned off while rendering.
      return;
    }
    if (rendered) {
      await window.LapImages.queueImage(
        uuid,
        rendered.jpeg,
        {
          gate: lap.Gate || '',
          eventNum: lap.EventNum || '',
          bow: lap.Bow || '',
          time: lap.Time || '',
          overlay: 'bow',
        },
        rendered.thumbnail,
      );
    } else {
      console.warn(`No video frame for lap image ${lap.Bow} @ ${lap.Time}`);
    }
  } catch (e) {
    console.warn('Lap image failed', e instanceof Error ? e.message : e);
  }
};

const onLap = (lap: Lap) => {
  if (!lap.uuid) return;
  const { uuid } = lap;
  const captured = capturedFrames.get(uuid);
  capturedFrames.delete(uuid);
  if (!getUploadLapImages()) return;
  generations.set(uuid, (generations.get(uuid) || 0) + 1);
  const prior = pendingLaps.get(uuid);
  clearTimeout(settleTimers.get(uuid));
  settleTimers.delete(uuid);
  pendingLaps.delete(uuid);

  if (lap.State === 'Deleted') {
    window.LapImages.queueDelete(uuid);
    return;
  }
  if (!lap.Time || !lap.Bow || lap.Bow === '?' || lap.Bow === '*') return;

  // An edit within the settle window keeps the captured frame if the time is unchanged.
  const frame =
    captured ?? (prior?.lap.Time === lap.Time ? prior.frame : undefined);
  pendingLaps.set(uuid, { lap: { ...lap }, frame });
  settleTimers.set(
    uuid,
    setTimeout(() => processLap(uuid), SETTLE_MS),
  );
};

/** Hook lap publishing and resume any uploads left from a prior session. */
export const startLapImages = () => {
  onLapPublished('lapImages', onLap);
  window.LapImages.start();
};
