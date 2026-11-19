/* eslint-disable */
// Runs the app's auto zoom to finish (src/renderer/video/AutoZoomToFinish.ts)
// outside Electron for scripts/autozoom_regression.py.
//
// The app-state modules auto zoom reads (video settings, user settings, frame
// seeking) are replaced by the stand-ins below; bow detection goes to the real
// native module with the same models and post-processing as the main process
// (src/main/video/video-main.ts 'video:detectBow').
//
// Usage: node autozoom_regression_runner.js <cases.json> <results.json>
// Each case: { id, videoFile, numFrames, reviewedEpochMs, reviewedFrame,
//              startEpochMs, startFrame, bow, scoredBows, courseArea,
//              hyperZoomMs, travelRightToLeft, cardLength, scheduledBowEndings }
// The frames are estimates; the runner places both times from frame timestamps.
const Module = require('module');
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..');
const BOWDETECT = path.join(REPO, 'native/bowdetect');
const [, , casesFile, resultsFile] = process.argv;

const state = {
  image: undefined,
  courseArea: { enabled: false, top: 0, bottom: 1 },
  hyperZoomMs: 0,
  travelRightToLeft: false,
  detectionOptions: { numericOnly: true, cardLength: 'auto', scheduledBows: [] },
};

const stubs = {
  // VideoSettings
  getCourseArea: () => state.courseArea,
  getImage: () => state.image,
  getTravelRightToLeft: () => state.travelRightToLeft,
  getHyperZoomFactor: () => state.hyperZoomMs,
  getVideoFile: () => state.image.file,
  getVideoFrameNum: () => state.image.frameNum,
  getVideoScaling: () => ({ srcHeight: state.image.height, zoomY: 1 }),
  // ImageScaling
  updateVideoScaling: () => {},
  // VideoUtils: the finish guide at the image centre, as in the SDFC26 sidecars.
  getFinishLine: () => ({ enabled: true, dir: 1, label: 'Finish', pt1: 0, pt2: 0 }),
  moveToFrame: async () => {},
  // UseSettings: numeric OCR (the default) with the crossing's event schedule.
  getBowDetectionOptions: () => state.detectionOptions,
  // VideoFileStatus / TimeSegmentUtils: one file, no overlaps.
  getFileStatusList: () => [],
  overlapHandover: () => undefined,
};

const STUB_ID = '\0autozoom-regression-stub';
const stubModule = new Module(STUB_ID);
stubModule.exports = stubs;
stubModule.loaded = true;
require.cache[STUB_ID] = stubModule;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (
    parent?.filename?.endsWith(path.join('video', 'AutoZoomToFinish.ts')) &&
    /\/(VideoSettings|VideoUtils|UseSettings|ImageScaling|VideoFileStatus|TimeSegmentUtils)$/.test(request)
  ) {
    return STUB_ID;
  }
  return resolve.call(this, request, parent, ...rest);
};

require(path.join(REPO, 'node_modules/ts-node')).register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});
const { nativeVideoExecutor } = require(path.join(REPO, 'native/ffreader/index.js'));
const { trimToCardLength } = require(path.join(REPO, 'src/renderer/video/BowNumber.ts'));
const AutoZoom = require(path.join(REPO, 'src/renderer/video/AutoZoomToFinish.ts'));

global.window = {
  VideoUtils: {
    detectBow: async (request) => {
      const numericOnly = request.numericOnly !== false;
      const result = await nativeVideoExecutor({
        op: 'detectBowAtFrame',
        request: {
          ...request,
          boatModelFile: path.join(BOWDETECT, 'crewtimer-boat-train.onnx'),
          cardModelFile: path.join(BOWDETECT, 'bow_card_detect.onnx'),
          numberModelFile: path.join(BOWDETECT, numericOnly ? 'bow_crnn_numeric.onnx' : 'bow_crnn.onnx'),
        },
      });
      if (result.status && result.status !== 'OK') throw new Error(result.status);
      if (numericOnly) {
        result.detections = result.detections.map((d) => ({
          ...d,
          text: trimToCardLength(d.text, request.cardLength, request.scheduledBows),
        }));
      }
      return result;
    },
  },
};

const grab = async (videoFile, frameNum) => {
  const image = await nativeVideoExecutor({
    op: 'grabFrameAt',
    request: { videoFile, frameNum, tsMilli: 0, closeTo: false },
  });
  if (image.status !== 'OK') throw new Error(`grabFrameAt ${frameNum}: ${image.status}`);
  return image;
};

/**
 * Fractional frame shown at epochMs, from the timestamp of the nearest frame
 * (frames are not exactly 1/fps apart from the file's start time).
 */
const frameAtTime = async (videoFile, epochMs, estimate) => {
  let frame = estimate;
  for (let pass = 0; pass < 2; pass += 1) {
    const image = await grab(videoFile, Math.max(1, Math.round(frame)));
    frame = image.frameNum + ((epochMs - image.tsMicro / 1000) * image.fps) / 1000;
  }
  return frame;
};

const runCase = async (c) => {
  state.courseArea = c.courseArea ?? { enabled: false, top: 0, bottom: 1 };
  state.hyperZoomMs = c.hyperZoomMs;
  state.travelRightToLeft = c.travelRightToLeft;
  state.detectionOptions = {
    numericOnly: true,
    cardLength: c.cardLength ?? 'auto',
    scheduledBows: c.scheduledBowEndings ?? [],
  };
  await nativeVideoExecutor({ op: 'openFile', file: c.videoFile });
  try {
    const reviewedFrame = await frameAtTime(c.videoFile, c.reviewedEpochMs, c.reviewedFrame);
    const startFrame = await frameAtTime(c.videoFile, c.startEpochMs, c.startFrame);
    const image = await grab(c.videoFile, Math.min(c.numFrames, Math.max(1, Math.round(startFrame))));
    image.file = c.videoFile;
    state.image = image;
    const scored = new Set(c.scoredBows);
    const result = await AutoZoom.autoZoomToFinishNearFinish(c.bow, Number.POSITIVE_INFINITY, image, {
      normalizeBow: (bow) => bow,
      isScoredBow: (bow) => scored.has(bow),
    });
    if (!result) return { status: 'no crossing found', reviewedFrame, startFrame };
    return {
      status: 'OK',
      reviewedFrame,
      startFrame,
      seekFrame: result.frameNum,
      detectedBow: result.bow,
      fps: image.fps,
    };
  } finally {
    await nativeVideoExecutor({ op: 'closeFile', file: c.videoFile });
    AutoZoom.clearAutoZoomDetectionCache();
  }
};

(async () => {
  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const results = [];
  const log = console.log;
  for (const c of cases) {
    const lines = [];
    console.log = (...args) => lines.push(args.join(' '));
    let out;
    try {
      out = await runCase(c);
    } catch (e) {
      out = { status: `error: ${e instanceof Error ? e.message : e}` };
    } finally {
      console.log = log;
    }
    results.push({ id: c.id, ...out, log: lines.filter((l) => l.startsWith('Auto Zoom')) });
    process.stderr.write(out.status === 'OK' ? '.' : 'x');
  }
  process.stderr.write('\n');
  fs.writeFileSync(resultsFile, JSON.stringify(results));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
