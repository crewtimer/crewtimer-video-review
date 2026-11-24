import { UseDatum } from 'react-usedatum';
import type {
  AppImage,
  BowDetection,
  BowDetectionResult,
  Rect,
} from '../shared/AppTypes';
import { updateVideoScaling } from '../util/ImageScaling';
import {
  getCourseArea,
  getImage,
  getTravelRightToLeft,
  getHyperZoomFactor,
  getVideoFile,
  getVideoFrameNum,
  getVideoScaling,
  Point,
} from './VideoSettings';
import { filterToCourseArea } from './BowDetectionSelection';
import { getFinishLine, moveToFrame } from './VideoUtils';
import { getBowDetectionOptions } from '../util/UseSettings';
import { getFileStatusList } from './VideoFileStatus';
import { overlapHandover } from './TimeSegmentUtils';

const MAX_CLICK_DISTANCE = 50;
const MAX_SEARCH_ITERATIONS = 12;
const MAX_FRAME_JUMP = 120;
const MIN_VELOCITY = 0.05;
const STALLED_STEP_FRAMES = 3;
const MAX_STALLED_STEPS = 2;
/** Detector jitter, in px, allowed against the travel direction. */
const MAX_BACKWARD_PX = 3;
/** Boxes moving against the travel direction ignored before giving up. */
const MAX_IGNORED_BOXES = 8;
const MAX_ADJACENT_BOAT_AREA_RATIO = 2.5;
const MAX_EXTENDED_VELOCITY_RATIO = 4;
const MATCH_RECOVERY_RADIUS = 3;
const MATCH_RECOVERY_BACKTRACK = 12;
const MAX_CACHED_DETECTIONS = 200;

type BoxEdge = 'left' | 'right';

export type BoatObservation = {
  frameNum: number;
  detection: BowDetection;
  edge: BoxEdge;
  edgeX: number;
  centerY: number;
};

export type AutoZoomFinishResult = {
  frameNum: number;
  bow: string;
  observations: BoatObservation[];
};

type InterpolatedBoatOverlay = {
  videoFile: string;
  detectionOptionsKey: string;
  first: BoatObservation;
  second: BoatObservation;
  bow: string;
  displayFrame: number;
};

const detectionCache = new Map<string, Promise<BowDetectionResult>>();
let interpolatedBoatOverlay: InterpolatedBoatOverlay | undefined;
let interpolationExtensionRequest = 0;
let autoZoomOperation = 0;

export const clearAutoZoomDetectionCache = () => detectionCache.clear();

export const clearAutoZoomInterpolation = () => {
  autoZoomOperation += 1;
  interpolatedBoatOverlay = undefined;
  interpolationExtensionRequest += 1;
};

const bowDetectionOptionsKey = () => {
  const options = getBowDetectionOptions();
  const course = getCourseArea();
  const courseKey = course.enabled ? `${course.top}-${course.bottom}` : 'all';
  return `${options.numericOnly ? 'numeric' : 'alphanumeric'}:${options.cardLength}:${options.scheduledBows.join(',')}:${courseKey}`;
};

export const hasAutoZoomInterpolation = (videoFile: string) =>
  interpolatedBoatOverlay?.videoFile === videoFile &&
  interpolatedBoatOverlay.detectionOptionsKey === bowDetectionOptionsKey();

export const hasAutoZoomInterpolationAtFrame = (
  videoFile: string,
  frameNum: number,
) =>
  interpolatedBoatOverlay?.videoFile === videoFile &&
  interpolatedBoatOverlay.detectionOptionsKey === bowDetectionOptionsKey() &&
  Math.abs(interpolatedBoatOverlay.displayFrame - frameNum) <= 0.01;

export const interpolateRect = (
  first: Rect,
  second: Rect,
  fraction: number,
) => ({
  x: first.x + (second.x - first.x) * fraction,
  y: first.y + (second.y - first.y) * fraction,
  width: first.width + (second.width - first.width) * fraction,
  height: first.height + (second.height - first.height) * fraction,
});

export const interpolateBoatDetection = (
  first: BoatObservation,
  second: BoatObservation,
  frameNum: number,
): BowDetection => {
  const fraction =
    (frameNum - first.frameNum) / (second.frameNum - first.frameNum);
  // This exported helper is declared later so the lower-level geometry
  // routines remain grouped together; it is initialized before any calls.
  // eslint-disable-next-line no-use-before-define
  const interpolated = interpolateDetectionPair(
    first.detection,
    second.detection,
    fraction,
  );
  return {
    ...interpolated,
    // The tracked bow identifies the boat, but must not manufacture an OCR
    // label on a frame where the nearer detection did not recognize it.
    text: interpolated.text,
  };
};

export const adjustInterpolatedBoatDetection = (
  videoFile: string,
  frameNum: number,
  detections: BowDetection[],
) => {
  const overlay = interpolatedBoatOverlay;
  if (!overlay || overlay.videoFile !== videoFile) {
    return detections;
  }
  const lowerFrame = Math.min(overlay.first.frameNum, overlay.second.frameNum);
  const upperFrame = Math.max(overlay.first.frameNum, overlay.second.frameNum);
  if (frameNum < lowerFrame || frameNum > upperFrame) {
    return detections;
  }
  const interpolatedDetection = interpolateBoatDetection(
    overlay.first,
    overlay.second,
    frameNum,
  );
  const target = interpolatedDetection.boatBox;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  let matchIndex = -1;
  let matchScore = Number.POSITIVE_INFINITY;
  const targetBow = interpolatedDetection.text.trim();
  const hasSameBow = detections.some(
    ({ text }) => targetBow && text.trim() === targetBow,
  );
  detections.forEach((detection, index) => {
    if (hasSameBow && detection.text.trim() !== targetBow) {
      return;
    }
    const centerY = detection.boatBox.y + detection.boatBox.height / 2;
    const centerX = detection.boatBox.x + detection.boatBox.width / 2;
    const textPenalty =
      interpolatedDetection.text &&
      detection.text &&
      interpolatedDetection.text !== detection.text
        ? 1000
        : 0;
    const score =
      Math.abs(centerX - targetCenterX) +
      Math.abs(centerY - targetCenterY) +
      textPenalty;
    if (score < matchScore) {
      matchIndex = index;
      matchScore = score;
    }
  });
  if (matchIndex < 0) {
    // eslint-disable-next-line no-use-before-define
    return omitOverlappingBoatDetections([
      ...detections,
      interpolatedDetection,
    ]);
  }
  // eslint-disable-next-line no-use-before-define
  return omitOverlappingBoatDetections(
    detections.map((detection, index) =>
      index === matchIndex
        ? {
            ...detection,
            text: detection.text || interpolatedDetection.text,
            confidence: Math.max(
              detection.confidence,
              interpolatedDetection.confidence,
            ),
            boatBox: interpolatedDetection.boatBox,
            box: interpolatedDetection.box,
          }
        : detection,
    ),
  );
};

const edgeX = (box: Rect, edge: BoxEdge) =>
  edge === 'left' ? box.x : box.x + box.width;

const rectArea = (box: Rect) =>
  Math.max(0, box.width) * Math.max(0, box.height);

export const areAdjacentBoatBoxesComparable = (first: Rect, second: Rect) => {
  const smallerArea = Math.min(rectArea(first), rectArea(second));
  const largerArea = Math.max(rectArea(first), rectArea(second));
  return (
    smallerArea > 0 && largerArea / smallerArea <= MAX_ADJACENT_BOAT_AREA_RATIO
  );
};

export const isPlausibleExtendedVelocity = (
  priorVelocity: number,
  observedVelocity: number,
) =>
  Math.abs(observedVelocity) >= MIN_VELOCITY &&
  Math.sign(observedVelocity) === Math.sign(priorVelocity) &&
  Math.abs(observedVelocity) <=
    Math.max(30, Math.abs(priorVelocity) * MAX_EXTENDED_VELOCITY_RATIO);

export const buildBoatMatchRecoveryFrames = (
  targetFrame: number,
  priorFrame: number,
  minFrame: number,
  maxFrame: number,
) => {
  const frames: number[] = [];
  const add = (frame: number) => {
    if (
      frame >= minFrame &&
      frame <= maxFrame &&
      frame !== targetFrame &&
      frame !== priorFrame &&
      !frames.includes(frame)
    ) {
      frames.push(frame);
    }
  };
  const towardPrior = Math.sign(priorFrame - targetFrame) || -1;
  for (let radius = 1; radius <= MATCH_RECOVERY_RADIUS; radius += 1) {
    add(targetFrame + towardPrior * radius);
    add(targetFrame - towardPrior * radius);
  }
  for (
    let radius = MATCH_RECOVERY_RADIUS + 1;
    radius <= MATCH_RECOVERY_BACKTRACK &&
    radius < Math.abs(targetFrame - priorFrame);
    radius += 1
  ) {
    add(targetFrame + towardPrior * radius);
  }
  if (Math.abs(targetFrame - priorFrame) > 2) {
    add(Math.round((targetFrame + priorFrame) / 2));
    add(priorFrame + Math.sign(targetFrame - priorFrame));
  }
  return frames;
};

const overlapOfSmaller = (first: Rect, second: Rect) => {
  const intersectionWidth = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );
  const smallerArea = Math.min(rectArea(first), rectArea(second));
  return smallerArea > 0
    ? (intersectionWidth * intersectionHeight) / smallerArea
    : 0;
};

const hasValidBow = ({ text }: BowDetection) => {
  const bow = text.trim();
  return bow !== '' && bow !== '?';
};

export const omitOverlappingBoatDetections = (
  detections: BowDetection[],
  overlapThreshold = 0.8,
) => {
  const parents = detections.map((_detection, index) => index);
  const root = (index: number): number => {
    if (parents[index] !== index) {
      parents[index] = root(parents[index]);
    }
    return parents[index];
  };
  const join = (first: number, second: number) => {
    const firstRoot = root(first);
    const secondRoot = root(second);
    if (firstRoot !== secondRoot) {
      parents[secondRoot] = firstRoot;
    }
  };

  detections.forEach((first, firstIndex) => {
    detections.slice(firstIndex + 1).forEach((second, offset) => {
      if (overlapOfSmaller(first.boatBox, second.boatBox) >= overlapThreshold) {
        join(firstIndex, firstIndex + offset + 1);
      }
    });
  });

  const groups = new Map<number, number[]>();
  detections.forEach((_detection, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(index);
    groups.set(root(index), group);
  });
  const omitted = new Set<number>();
  groups.forEach((indexes) => {
    if (indexes.length < 2) {
      return;
    }
    const valid = indexes.filter((index) => hasValidBow(detections[index]));
    if (!valid.length) {
      return;
    }
    const keep = valid.sort(
      (first, second) =>
        rectArea(detections[first].boatBox) -
        rectArea(detections[second].boatBox),
    )[0];
    indexes.forEach((index) => {
      if (index !== keep) {
        omitted.add(index);
      }
    });
  });
  return detections.filter((_detection, index) => !omitted.has(index));
};

const distanceToVerticalEdge = (point: Point, box: Rect, edge: BoxEdge) => {
  const x = edgeX(box, edge);
  const nearestY = Math.max(box.y, Math.min(point.y, box.y + box.height));
  return Math.hypot(point.x - x, point.y - nearestY);
};

export const selectBoatEdgeNearPoint = (
  detections: BowDetection[],
  point: Point,
  maxDistance = MAX_CLICK_DISTANCE,
): { detection: BowDetection; edge: BoxEdge } | undefined => {
  const choices = detections.flatMap((detection) =>
    (['left', 'right'] as const).map((edge) => ({
      detection,
      edge,
      distance: distanceToVerticalEdge(point, detection.boatBox, edge),
    })),
  );
  const closest = choices.sort((a, b) => a.distance - b.distance)[0];
  return closest && closest.distance <= maxDistance ? closest : undefined;
};

/** Maps detected bow text to scheduled bows and identifies scored crews. */
export interface BowSelectionFilter {
  /** e.g. a detected '4' to a scheduled 'C4'. */
  normalizeBow: (bow: string) => string;
  /** True when this crew already has a recorded time. */
  isScoredBow: (bow: string) => boolean;
}

export const selectBoatEdgeNearFinish = (
  detections: BowDetection[],
  finishX: number,
  knownBow = '',
  maxDistance = 100,
  leadingEdge: BoxEdge | undefined = undefined,
  bowFilter: BowSelectionFilter | undefined = undefined,
): { detection: BowDetection; edge: BoxEdge } | undefined => {
  const normalize = (bow: string) =>
    bowFilter ? bowFilter.normalizeBow(bow.trim()) : bow.trim();
  const normalizedBow = normalize(knownBow);
  // The known bow's number, such as 4 for C4.
  const knownDigits = /\d+$/.exec(knownBow.trim())?.[0] ?? '';
  // 0: the known bow. 1: a reading with a spurious leading digit, such as 24
  // for 4, so a misread card at the hint frame still identifies the crew
  // rather than handing the search to whichever boat is nearest the finish.
  // 2: any other boat.
  const bowMatchRank = (text: string) => {
    if (normalize(text) === normalizedBow) {
      return 0;
    }
    const digits = text.trim();
    return knownDigits &&
      /^\d+$/.test(digits) &&
      digits.length > knownDigits.length &&
      digits.endsWith(knownDigits)
      ? 1
      : 2;
  };
  const candidateEdges = leadingEdge
    ? ([leadingEdge] as const)
    : (['left', 'right'] as const);
  // A crew that already has a time is not the one being looked for, even
  // when its bow is nearer the finish. When several boats read as the same
  // scored crew, at most one of them is that crew: a misread card (such as
  // 23 for bow 4, trimmed to 3) can match the crew just scored. The one
  // furthest along in the direction of travel crossed first, so it is taken
  // as the scored crew and the others stay eligible. Without a known
  // direction, all of them are skipped.
  const furthestAlong = new Map<string, BowDetection>();
  if (bowFilter && leadingEdge) {
    detections.forEach((detection) => {
      if (!hasValidBow(detection)) return;
      const bow = normalize(detection.text);
      if (bow === normalizedBow || !bowFilter.isScoredBow(bow)) return;
      const current = furthestAlong.get(bow);
      const x = edgeX(detection.boatBox, leadingEdge);
      const ahead = current
        ? leadingEdge === 'left'
          ? x < edgeX(current.boatBox, leadingEdge)
          : x > edgeX(current.boatBox, leadingEdge)
        : true;
      if (ahead) furthestAlong.set(bow, detection);
    });
  }
  const eligible = detections.filter((detection) => {
    if (!bowFilter || !hasValidBow(detection)) {
      return true;
    }
    const bow = normalize(detection.text);
    if (bow === normalizedBow || !bowFilter.isScoredBow(bow)) {
      return true;
    }
    const scored = furthestAlong.get(bow);
    return !!scored && scored !== detection;
  });
  const choices = eligible
    .flatMap((detection) =>
      candidateEdges.map((edge) => ({
        detection,
        edge,
        distance: Math.abs(edgeX(detection.boatBox, edge) - finishX),
      })),
    )
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => {
      if (normalizedBow && normalizedBow !== '?') {
        const aRank = bowMatchRank(a.detection.text);
        const bRank = bowMatchRank(b.detection.text);
        if (aRank !== bRank) {
          return aRank - bRank;
        }
      }
      return a.distance - b.distance;
    });
  const closest = choices[0];
  return closest
    ? { detection: closest.detection, edge: closest.edge }
    : undefined;
};

const detectFrame = (videoFile: string, frameNum: number) => {
  const integerFrame = Math.round(frameNum);
  const options = getBowDetectionOptions();
  const key = `${videoFile}:${integerFrame}:${bowDetectionOptionsKey()}`;
  let pending = detectionCache.get(key);
  if (!pending) {
    // Filter with the bounds the key names, not ones changed during detection.
    const courseArea = getCourseArea();
    const frameHeight = getVideoScaling().srcHeight;
    pending = window.VideoUtils.detectBow({
      videoFile,
      frameNum: integerFrame,
      closeTo: false,
      ...options,
    }).then((result) => ({
      ...result,
      detections: omitOverlappingBoatDetections(
        filterToCourseArea(result.detections, courseArea, frameHeight),
      ),
    }));
    detectionCache.set(key, pending);
    pending.catch(() => {
      if (detectionCache.get(key) === pending) {
        detectionCache.delete(key);
      }
    });
    if (detectionCache.size > MAX_CACHED_DETECTIONS) {
      const oldestKey = detectionCache.keys().next().value;
      if (oldestKey) {
        detectionCache.delete(oldestKey);
      }
    }
  }
  return pending;
};

/** Farthest a recorded boat's edge may be from the finish at its time. */
const MAX_RECORDED_EDGE_DISTANCE = 30;

/**
 * Whether a clicked boat is the crew whose recorded time is displayed: its
 * bow reads as that crew or, when unreadable, its edge is at the finish.
 * No boat near the click is treated as the recorded crew.
 */
export const isRecordedBoatSelection = (
  selected: { detection: BowDetection; edge: BoxEdge } | undefined,
  finishX: number,
  recordedBow: string,
  normalizeBow: (bow: string) => string,
) => {
  if (!selected) {
    return true;
  }
  if (hasValidBow(selected.detection)) {
    return normalizeBow(selected.detection.text.trim()) === recordedBow;
  }
  return (
    Math.abs(edgeX(selected.detection.boatBox, selected.edge) - finishX) <=
    MAX_RECORDED_EDGE_DISTANCE
  );
};

/** The boat edge nearest a click on the displayed frame. */
export const detectBoatNearPoint = async (point: Point) => {
  const result = await detectFrame(getVideoFile(), getVideoFrameNum());
  return selectBoatEdgeNearPoint(result.detections, point);
};

export const getCachedAutoZoomDetections = (
  videoFile: string,
  frameNum: number,
) => {
  return detectionCache.get(
    `${videoFile}:${Math.round(frameNum)}:${bowDetectionOptionsKey()}`,
  );
};

export const restoreMissingCardDetections = (
  detections: BowDetection[],
  cachedDetections: BowDetection[],
) =>
  detections.map((detection) => {
    if (detection.box.width > 0 && detection.box.height > 0) {
      return detection;
    }
    const centerX = detection.boatBox.x + detection.boatBox.width / 2;
    const centerY = detection.boatBox.y + detection.boatBox.height / 2;
    const cached = cachedDetections
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .map((candidate) => ({
        candidate,
        distance:
          Math.abs(
            candidate.boatBox.x + candidate.boatBox.width / 2 - centerX,
          ) +
          Math.abs(
            candidate.boatBox.y + candidate.boatBox.height / 2 - centerY,
          ),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    const maxDistance = Math.max(100, detection.boatBox.width);
    if (!cached || cached.distance > maxDistance) {
      return detection;
    }
    return {
      ...detection,
      box: cached.candidate.box,
      text: detection.text || cached.candidate.text,
      confidence: Math.max(detection.confidence, cached.candidate.confidence),
    };
  });

export function interpolateDetectionPair(
  first: BowDetection,
  second: BowDetection,
  fraction: number,
): BowDetection {
  const boatBox = interpolateRect(first.boatBox, second.boatBox, fraction);
  const firstHasCard = first.box.width > 0 && first.box.height > 0;
  const secondHasCard = second.box.width > 0 && second.box.height > 0;
  let box = { x: 0, y: 0, width: 0, height: 0 };
  if (firstHasCard && secondHasCard) {
    box = interpolateRect(first.box, second.box, fraction);
  } else {
    const reference = firstHasCard ? first : secondHasCard ? second : undefined;
    if (reference) {
      const scaleX = boatBox.width / Math.max(1, reference.boatBox.width);
      const scaleY = boatBox.height / Math.max(1, reference.boatBox.height);
      box = {
        x: boatBox.x + (reference.box.x - reference.boatBox.x) * scaleX,
        y: boatBox.y + (reference.box.y - reference.boatBox.y) * scaleY,
        width: reference.box.width * scaleX,
        height: reference.box.height * scaleY,
      };
    }
  }
  return {
    text:
      first.text && first.text === second.text
        ? first.text
        : fraction < 0.5
          ? first.text || second.text
          : second.text || first.text,
    confidence: Math.max(first.confidence, second.confidence),
    boatBox,
    box,
  };
}

const findDetectionMatch = (
  reference: BowDetection,
  candidates: BowDetection[],
  availableIndexes: Set<number>,
) => {
  const centerX = reference.boatBox.x + reference.boatBox.width / 2;
  const centerY = reference.boatBox.y + reference.boatBox.height / 2;
  const match = [...availableIndexes]
    .map((index) => {
      const candidate = candidates[index];
      if (
        !areAdjacentBoatBoxesComparable(reference.boatBox, candidate.boatBox)
      ) {
        return undefined;
      }
      const bowPenalty =
        reference.text && candidate.text && reference.text !== candidate.text
          ? 50
          : 0;
      return {
        index,
        detection: candidate,
        distance:
          Math.abs(
            candidate.boatBox.x + candidate.boatBox.width / 2 - centerX,
          ) +
          Math.abs(
            candidate.boatBox.y + candidate.boatBox.height / 2 - centerY,
          ) +
          bowPenalty,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((a, b) => a.distance - b.distance)[0];
  return match && match.distance <= Math.max(100, reference.boatBox.width)
    ? match
    : undefined;
};

export const getInterpolatedBowDetections = async (
  videoFile: string,
  frameNum: number,
): Promise<BowDetection[] | undefined> => {
  const firstFrame = Math.floor(frameNum);
  const fraction = frameNum - firstFrame;
  if (fraction <= 0.001 || fraction >= 0.999) {
    return undefined;
  }
  const [firstResult, secondResult] = await Promise.all([
    detectFrame(videoFile, firstFrame),
    detectFrame(videoFile, firstFrame + 1),
  ]);
  if (fraction >= 0.5) {
    const unusedFirst = new Set(firstResult.detections.keys());
    return omitOverlappingBoatDetections(
      secondResult.detections.map((second) => {
        const match = findDetectionMatch(
          second,
          firstResult.detections,
          unusedFirst,
        );
        if (!match) {
          return second;
        }
        unusedFirst.delete(match.index);
        return interpolateDetectionPair(match.detection, second, fraction);
      }),
    );
  }
  const unusedSecond = new Set(secondResult.detections.keys());
  return omitOverlappingBoatDetections(
    firstResult.detections.map((first) => {
      const match = findDetectionMatch(
        first,
        secondResult.detections,
        unusedSecond,
      );
      if (!match) {
        return first;
      }
      unusedSecond.delete(match.index);
      return interpolateDetectionPair(first, match.detection, fraction);
    }),
  );
};

const makeObservation = (
  frameNum: number,
  detection: BowDetection,
  edge: BoxEdge,
): BoatObservation => ({
  frameNum,
  detection,
  edge,
  edgeX: edgeX(detection.boatBox, edge),
  centerY: detection.boatBox.y + detection.boatBox.height / 2,
});

const matchBoat = (
  detections: BowDetection[],
  prior: BoatObservation,
  expectedEdgeX: number,
) => {
  const priorBox = prior.detection.boatBox;
  const candidates = detections
    .filter(({ boatBox }) => boatBox.width > 0 && boatBox.height > 0)
    .filter(({ boatBox }) => areAdjacentBoatBoxesComparable(priorBox, boatBox))
    .map((detection) => {
      const box = detection.boatBox;
      const yOverlap = Math.max(
        0,
        Math.min(priorBox.y + priorBox.height, box.y + box.height) -
          Math.max(priorBox.y, box.y),
      );
      const yRatio =
        yOverlap / Math.max(1, Math.min(priorBox.height, box.height));
      const candidateCenterY = box.y + box.height / 2;
      const bowPenalty =
        prior.detection.text &&
        detection.text &&
        prior.detection.text !== detection.text
          ? 100
          : 0;
      return {
        detection,
        score:
          Math.abs(edgeX(box, prior.edge) - expectedEdgeX) +
          Math.abs(candidateCenterY - prior.centerY) * 0.5 +
          bowPenalty,
        yRatio,
      };
    })
    .filter(({ yRatio }) => yRatio >= 0.2)
    .sort((a, b) => a.score - b.score);

  const best = candidates[0];
  const maxDistance = Math.max(100, priorBox.width * 1.5);
  return best && best.score <= maxDistance ? best.detection : undefined;
};

export const extendAutoZoomInterpolation = async (
  videoFile: string,
  frameNum: number,
) => {
  const extensionRequest = interpolationExtensionRequest + 1;
  interpolationExtensionRequest = extensionRequest;
  const overlay = interpolatedBoatOverlay;
  if (
    !overlay ||
    overlay.videoFile !== videoFile ||
    overlay.detectionOptionsKey !== bowDetectionOptionsKey()
  ) {
    return false;
  }
  const lowerBound = Math.min(overlay.first.frameNum, overlay.second.frameNum);
  const upperBound = Math.max(overlay.first.frameNum, overlay.second.frameNum);
  if (frameNum >= lowerBound && frameNum <= upperBound) {
    interpolatedBoatOverlay = { ...overlay, displayFrame: frameNum };
    return true;
  }

  const firstFrame = Math.floor(frameNum);
  const secondFrame = firstFrame + 1;
  const oldVelocity =
    (overlay.second.edgeX - overlay.first.edgeX) /
    (overlay.second.frameNum - overlay.first.frameNum);
  const reference =
    Math.abs(frameNum - overlay.first.frameNum) <
    Math.abs(frameNum - overlay.second.frameNum)
      ? overlay.first
      : overlay.second;

  const expectedFirstEdge =
    reference.edgeX + oldVelocity * (firstFrame - reference.frameNum);
  let firstResult = await detectFrame(videoFile, firstFrame);
  let firstDetection = matchBoat(
    firstResult.detections,
    reference,
    expectedFirstEdge,
  );
  if (!firstDetection && firstFrame > 1) {
    firstResult = await detectFrame(videoFile, firstFrame - 1);
    firstDetection = matchBoat(
      firstResult.detections,
      reference,
      reference.edgeX +
        oldVelocity * (firstResult.frameNum - reference.frameNum),
    );
  }
  if (!firstDetection) {
    console.log(
      `Auto Zoom to Finish: unable to extend boat track at frame ${firstFrame}`,
    );
    return false;
  }
  const first = makeObservation(
    firstResult.frameNum,
    firstDetection,
    reference.edge,
  );

  const expectedSecondEdge = first.edgeX + oldVelocity;
  let secondResult = await detectFrame(videoFile, secondFrame);
  let secondDetection = matchBoat(
    secondResult.detections,
    first,
    expectedSecondEdge,
  );
  if (!secondDetection && secondFrame < getImage().numFrames) {
    secondResult = await detectFrame(videoFile, secondFrame + 1);
    secondDetection = matchBoat(
      secondResult.detections,
      first,
      first.edgeX + oldVelocity * (secondResult.frameNum - first.frameNum),
    );
  }
  if (!secondDetection) {
    console.log(
      `Auto Zoom to Finish: unable to extend boat track at frame ${secondFrame}`,
    );
    return false;
  }
  const second = makeObservation(
    secondResult.frameNum,
    secondDetection,
    reference.edge,
  );
  const observedVelocity =
    (second.edgeX - first.edgeX) / (second.frameNum - first.frameNum);
  if (!isPlausibleExtendedVelocity(oldVelocity, observedVelocity)) {
    console.log(
      `Auto Zoom to Finish: rejected extended velocity ${observedVelocity.toFixed(2)}px/frame`,
    );
    return false;
  }
  if (extensionRequest !== interpolationExtensionRequest) {
    return false;
  }

  const detectedBows = [firstDetection.text, secondDetection.text].filter(
    Boolean,
  );
  interpolatedBoatOverlay = {
    ...overlay,
    first,
    second,
    bow:
      detectedBows.find((value) => value === overlay.bow) ||
      detectedBows[0] ||
      overlay.bow,
    displayFrame: frameNum,
  };
  console.log(
    `Auto Zoom to Finish: extended interpolation to frames ${first.frameNum}-${second.frameNum}`,
  );
  return true;
};

const signedFinishDistance = (
  observation: BoatObservation,
  finishX: number,
  rightToLeft: boolean,
) => (rightToLeft ? -1 : 1) * (observation.edgeX - finishX);

const findBracket = (
  observations: BoatObservation[],
  finishX: number,
  rightToLeft: boolean,
) => {
  const sorted = [...observations].sort((a, b) => a.frameNum - b.frameNum);
  for (let index = 1; index < sorted.length; index += 1) {
    const first = sorted[index - 1];
    const second = sorted[index];
    if (
      signedFinishDistance(first, finishX, rightToLeft) *
        signedFinishDistance(second, finishX, rightToLeft) <=
      0
    ) {
      return [first, second] as const;
    }
  }
  return undefined;
};

export const interpolateCrossingFrame = (
  first: BoatObservation,
  second: BoatObservation,
  finishX: number,
) =>
  first.frameNum +
  ((finishX - first.edgeX) * (second.frameNum - first.frameNum)) /
    (second.edgeX - first.edgeX);

export const interpolateBoatEdgePoint = (
  first: BoatObservation,
  second: BoatObservation,
  frameNum: number,
  boatBoxYFraction = 0.5,
): Point => {
  const fraction =
    (frameNum - first.frameNum) / (second.frameNum - first.frameNum);
  const firstY =
    boatBoxYFraction === 0.5
      ? first.centerY
      : first.detection.boatBox.y +
        first.detection.boatBox.height * boatBoxYFraction;
  const secondY =
    boatBoxYFraction === 0.5
      ? second.centerY
      : second.detection.boatBox.y +
        second.detection.boatBox.height * boatBoxYFraction;
  return {
    x: first.edgeX + (second.edgeX - first.edgeX) * fraction,
    y: firstY + (secondY - firstY) * fraction,
  };
};

export const chooseBracketRefinementFrame = (
  first: BoatObservation,
  second: BoatObservation,
  finishX: number,
) => {
  const lowerFrame = Math.min(first.frameNum, second.frameNum);
  const upperFrame = Math.max(first.frameNum, second.frameNum);
  if (upperFrame - lowerFrame <= 1) {
    return undefined;
  }
  const estimatedCrossing = interpolateCrossingFrame(first, second, finishX);
  return Math.max(
    lowerFrame + 1,
    Math.min(upperFrame - 1, Math.round(estimatedCrossing)),
  );
};

/**
 * Whether a boat edge moved against the travel direction relative to any
 * accepted observation: a bad detector box, such as one that lost the bow.
 */
export const movesAgainstTravel = (
  current: BoatObservation,
  observations: readonly BoatObservation[],
  rightToLeft: boolean,
) => {
  const direction = rightToLeft ? -1 : 1;
  return observations.some(
    (other) =>
      other.frameNum !== current.frameNum &&
      direction *
        (current.edgeX - other.edgeX) *
        Math.sign(current.frameNum - other.frameNum) <
        -MAX_BACKWARD_PX,
  );
};

/**
 * A frame inside the bracket to refine it, nearest the estimated crossing
 * and not yet tried; undefined when none is left.
 */
export const chooseUntriedRefinementFrame = (
  first: BoatObservation,
  second: BoatObservation,
  finishX: number,
  tried: ReadonlySet<number>,
) => {
  const frame = chooseBracketRefinementFrame(first, second, finishX);
  if (frame === undefined) {
    return undefined;
  }
  const lowerFrame = Math.min(first.frameNum, second.frameNum) + 1;
  const upperFrame = Math.max(first.frameNum, second.frameNum) - 1;
  for (let offset = 0; offset <= upperFrame - lowerFrame; offset += 1) {
    for (const candidate of [frame - offset, frame + offset]) {
      if (
        candidate >= lowerFrame &&
        candidate <= upperFrame &&
        !tried.has(candidate)
      ) {
        return candidate;
      }
    }
  }
  return undefined;
};

/**
 * The boat box's leading edge reaches the guide a median 0.7 ms before the
 * bow ball does (257 SDFC26 crossings against reviewed times), so auto zoom
 * moves its crossing this much later.
 */
export const AUTO_ZOOM_BIAS_MS = 0.7;

/** Moves a crossing frame later by AUTO_ZOOM_BIAS_MS. */
export const correctAutoZoomBias = (frameNum: number, fps: number) =>
  fps > 0 ? frameNum + (AUTO_ZOOM_BIAS_MS * fps) / 1000 : frameNum;

/**
 * Rounds a frame to the nearest hyperzoom step in time, so arrow keys step
 * on from a grid time. Leaves it unchanged without a hyperzoom resolution.
 */
export const roundFrameToHyperZoomGrid = (
  frameNum: number,
  referenceFrame: number,
  referenceTimeMicro: number,
  fps: number,
  resolutionMs: number,
) => {
  if (resolutionMs <= 0 || fps <= 0) {
    return frameNum;
  }
  const crossingTimeMs =
    referenceTimeMicro / 1000 + ((frameNum - referenceFrame) * 1000) / fps;
  const roundedTimeMs =
    Math.round(crossingTimeMs / resolutionMs) * resolutionMs;
  return (
    referenceFrame + ((roundedTimeMs - referenceTimeMicro / 1000) * fps) / 1000
  );
};

/** The file that displays a frame of videoFile: where files overlap, a frame
 * past the split is shown by the neighbour that owns it. */
const fileShowingFrame = (videoFile: string, frameNum: number) => {
  const files = getFileStatusList();
  const index = files.findIndex((item) => item.filename === videoFile);
  const handover =
    index >= 0 ? overlapHandover(files, index, frameNum) : undefined;
  return handover ? files[handover.fileIndex].filename : videoFile;
};

const runAutoZoomToFinish = async (
  selectInitialBoat: (
    detections: BowDetection[],
    finishX: number,
  ) => { detection: BowDetection; edge: BoxEdge } | undefined,
  zoomClickPoint?: Point,
  initialImage?: AppImage,
  boatBoxYFraction = 0.5,
  travelRightToLeft = getTravelRightToLeft(),
): Promise<AutoZoomFinishResult | undefined | null> => {
  const operation = autoZoomOperation + 1;
  autoZoomOperation = operation;
  const videoFile = initialImage?.file ?? getVideoFile();
  // A seek to another file supersedes the search and closes this file.
  const operationIsCurrent = () =>
    operation === autoZoomOperation && getVideoFile() === videoFile;
  // The final seek may hand over to the overlapping file that shows it.
  const seekGuard = (seekFile: string) => () =>
    operation === autoZoomOperation &&
    (getVideoFile() === videoFile || getVideoFile() === seekFile);
  const detect = (frameNum: number) =>
    detectFrame(videoFile, frameNum).catch((error) => {
      if (!operationIsCurrent()) {
        return undefined;
      }
      throw error;
    });
  interpolatedBoatOverlay = undefined;
  const image = initialImage ?? getImage();
  const initialFrame = Math.round(initialImage?.frameNum ?? getVideoFrameNum());
  const finish = getFinishLine();
  const finishX = image.width / 2 + (finish.pt1 + finish.pt2) / 2;
  // The configured travel direction is trusted; a box that moves against
  // it is a bad detection, not evidence of the opposite direction.
  const rightToLeft = travelRightToLeft;
  let stalledSteps = 0;
  const ignored: BoatObservation[] = [];
  const tried = new Set<number>();
  const initialResult = await detect(initialFrame);
  if (!initialResult || !operationIsCurrent()) {
    return null;
  }
  const selected = selectInitialBoat(initialResult.detections, finishX);
  if (!selected) {
    console.log('Auto Zoom to Finish: no eligible boat edge found');
    return undefined;
  }

  const observations = [
    makeObservation(initialResult.frameNum, selected.detection, selected.edge),
  ];
  tried.add(observations[0].frameNum);
  const initialDistance = signedFinishDistance(
    observations[0],
    finishX,
    rightToLeft,
  );
  let timeDirection = initialDistance < 0 ? 1 : -1;
  let nextFrame = initialFrame + timeDirection;
  // Frame estimated to put the boat edge on the finish at this velocity.
  const stepToward = (from: BoatObservation, velocity: number) => {
    const estimated = from.frameNum + (finishX - from.edgeX) / velocity;
    const delta = Math.max(
      -MAX_FRAME_JUMP,
      Math.min(MAX_FRAME_JUMP, Math.round(estimated) - from.frameNum),
    );
    const frame = from.frameNum + (delta || timeDirection);
    // An estimate past either end of the file stops at its first or last
    // frame, so the search still looks there.
    const clamped = Math.max(1, Math.min(image.numFrames, frame));
    return clamped === from.frameNum ? frame : clamped;
  };

  for (let iteration = 0; iteration < MAX_SEARCH_ITERATIONS; iteration += 1) {
    const prior = observations[observations.length - 1];
    if (nextFrame < 1 || nextFrame > image.numFrames) {
      console.log(
        `Auto Zoom to Finish: the crossing is before the start or after the end of the file (frame ${nextFrame})`,
      );
      return undefined;
    }
    // Sequential observations are required to estimate and refine velocity.
    // eslint-disable-next-line no-await-in-loop
    let result = await detect(nextFrame);
    if (!result || !operationIsCurrent()) {
      return null;
    }
    const expectedEdgeAtFrame = (detectedFrame: number) =>
      observations.length >= 2
        ? prior.edgeX +
          ((prior.edgeX - observations[observations.length - 2].edgeX) /
            (prior.frameNum - observations[observations.length - 2].frameNum)) *
            (detectedFrame - prior.frameNum)
        : prior.edgeX;
    let matched = matchBoat(
      result.detections,
      prior,
      expectedEdgeAtFrame(result.frameNum),
    );
    const recoveryFrames = buildBoatMatchRecoveryFrames(
      nextFrame,
      prior.frameNum,
      1,
      image.numFrames,
    );
    for (const recoveryFrame of recoveryFrames) {
      if (matched) {
        break;
      }
      // Probe nearby frames on both sides, then backtrack toward the last
      // observation when an estimated jump lands on a bad detection.
      // eslint-disable-next-line no-await-in-loop
      result = await detect(recoveryFrame);
      if (!result || !operationIsCurrent()) {
        return null;
      }
      matched = matchBoat(
        result.detections,
        prior,
        expectedEdgeAtFrame(result.frameNum),
      );
    }
    if (!matched) {
      console.log(
        `Auto Zoom to Finish: boat match failed at frame ${nextFrame}`,
      );
      return undefined;
    }
    const current = makeObservation(result.frameNum, matched, prior.edge);
    tried.add(current.frameNum);
    const ignore = movesAgainstTravel(current, observations, rightToLeft);
    if (ignore) {
      ignored.push(current);
      if (ignored.length > MAX_IGNORED_BOXES) {
        console.log(
          'Auto Zoom to Finish: too many boat boxes move against the travel direction',
        );
        return undefined;
      }
      // Ignored boxes do not use up the search budget.
      iteration -= 1;
      const [earlier, later] = ignored.slice(-2);
      if (
        observations.length === 1 &&
        later &&
        !movesAgainstTravel(later, [earlier], rightToLeft)
      ) {
        // Two later boxes agree with each other but not with the starting
        // box, so the starting box is the bad one. Continue from them.
        const spanVelocity =
          (later.edgeX - earlier.edgeX) / (later.frameNum - earlier.frameNum);
        console.log(
          `Auto Zoom to Finish: starting box at frame ${initialFrame} disagrees with frames ${earlier.frameNum} and ${later.frameNum}; continuing from them`,
        );
        observations.splice(0, observations.length, earlier, later);
        ignored.splice(0);
        timeDirection =
          signedFinishDistance(later, finishX, rightToLeft) < 0 ? 1 : -1;
        nextFrame =
          Math.abs(spanVelocity) < MIN_VELOCITY
            ? later.frameNum + timeDirection * STALLED_STEP_FRAMES
            : stepToward(later, spanVelocity);
        // eslint-disable-next-line no-continue
        continue;
      }
      console.log(
        `Auto Zoom to Finish: ignoring the boat box at frame ${current.frameNum}; it moves against the travel direction`,
      );
    } else {
      observations.push(current);
    }
    const bracket = findBracket(observations, finishX, rightToLeft);
    const refinementFrame = bracket
      ? chooseUntriedRefinementFrame(bracket[0], bracket[1], finishX, tried)
      : undefined;
    if (bracket && refinementFrame !== undefined) {
      const lowerFrame = Math.min(bracket[0].frameNum, bracket[1].frameNum);
      const upperFrame = Math.max(bracket[0].frameNum, bracket[1].frameNum);
      nextFrame = refinementFrame;
      console.log(
        `Auto Zoom to Finish: refining bracket ${lowerFrame}-${upperFrame} at frame ${nextFrame}`,
      );
      // Do not accept a wide linear interpolation; detector box motion is not
      // stable enough over a long interval for finish-line timing.
      // eslint-disable-next-line no-continue
      continue;
    }
    if (bracket) {
      const crossingFrame = interpolateCrossingFrame(
        bracket[0],
        bracket[1],
        finishX,
      );
      const seekFrame = roundFrameToHyperZoomGrid(
        correctAutoZoomBias(crossingFrame, image.fps),
        image.frameNum,
        image.tsMicro,
        image.fps,
        getHyperZoomFactor(),
      );
      const targetEdgePoint = interpolateBoatEdgePoint(
        bracket[0],
        bracket[1],
        crossingFrame,
        boatBoxYFraction,
      );
      const recognizedBows = observations
        .map(({ detection }) => detection.text)
        .filter(Boolean);
      const bow =
        recognizedBows.sort(
          (a, b) =>
            recognizedBows.filter((value) => value === b).length -
            recognizedBows.filter((value) => value === a).length,
        )[0] || '';
      interpolatedBoatOverlay = {
        videoFile,
        detectionOptionsKey: bowDetectionOptionsKey(),
        first: bracket[0],
        second: bracket[1],
        bow,
        displayFrame: seekFrame,
      };
      console.log(
        `Auto Zoom to Finish: crossing=${crossingFrame.toFixed(3)} seek=${seekFrame.toFixed(3)} bow=${bow || '?'} observations=${observations
          .map(
            (value) =>
              `${value.frameNum}:${value.edgeX.toFixed(1)}:${value.detection.text || '?'}`,
          )
          .join(',')}`,
      );
      updateVideoScaling({
        zoomY: 5,
        srcCenterPoint: {
          x: targetEdgePoint.x,
          y: zoomClickPoint?.y ?? targetEdgePoint.y,
        },
        srcClickPoint: zoomClickPoint ?? targetEdgePoint,
        autoZoomed: true,
      });
      // A crossing past the split with an overlapping file is shown by that
      // file, so the seek's own file switch must not cancel it.
      const seekIsCurrent = seekGuard(fileShowingFrame(videoFile, seekFrame));
      // eslint-disable-next-line no-await-in-loop
      await moveToFrame(seekFrame, undefined, true, seekIsCurrent);
      if (!seekIsCurrent()) {
        return null;
      }
      return { frameNum: seekFrame, bow, observations };
    }

    if (ignore) {
      // Step past the bad box, onward in the direction of the search.
      nextFrame =
        current.frameNum +
        (Math.sign(current.frameNum - prior.frameNum) || timeDirection) *
          STALLED_STEP_FRAMES;
      // eslint-disable-next-line no-continue
      continue;
    }
    const previous = observations[observations.length - 2];
    const velocity =
      (current.edgeX - previous.edgeX) / (current.frameNum - previous.frameNum);
    const expectedDirection = rightToLeft ? -1 : 1;
    if (
      Math.abs(velocity) < MIN_VELOCITY ||
      Math.sign(velocity) !== expectedDirection
    ) {
      // A near-zero speed is an unreliable measurement, usually one jittered
      // detector box, not evidence of the opposite direction. Measure again
      // over a longer span before drawing any conclusion.
      stalledSteps += 1;
      if (stalledSteps > MAX_STALLED_STEPS) {
        console.log(
          `Auto Zoom to Finish: boat is not moving (${velocity.toFixed(2)}px/frame)`,
        );
        return undefined;
      }
      console.log(
        `Auto Zoom to Finish: unreliable velocity ${velocity.toFixed(2)}px/frame; measuring over ${STALLED_STEP_FRAMES} frames`,
      );
      nextFrame = current.frameNum + timeDirection * STALLED_STEP_FRAMES;
      // eslint-disable-next-line no-continue
      continue;
    }
    stalledSteps = 0;
    nextFrame = stepToward(current, velocity);
  }
  console.log('Auto Zoom to Finish: finish line was not bracketed');
  return undefined;
};

/**
 * Number of auto zooms in progress. The video shows a spinner while it is
 * above zero; a count, not a flag, so a superseded auto zoom finishing late
 * does not hide the spinner of the one that replaced it.
 */
export const [useAutoZoomBusy, setAutoZoomBusy, getAutoZoomBusy] =
  UseDatum<number>(0);

const whileBusy = async <T>(run: () => Promise<T>): Promise<T> => {
  setAutoZoomBusy(getAutoZoomBusy() + 1);
  try {
    return await run();
  } finally {
    setAutoZoomBusy(Math.max(0, getAutoZoomBusy() - 1));
  }
};

export const autoZoomToFinish = (clickPoint: Point) =>
  whileBusy(() =>
    runAutoZoomToFinish(
      (detections) => selectBoatEdgeNearPoint(detections, clickPoint),
      clickPoint,
    ),
  );

const searchNearFinish = async (
  knownBow: string,
  maxDistance: number,
  initialImage?: AppImage,
  bowFilter?: BowSelectionFilter,
) => {
  const search = (rightToLeft: boolean) =>
    runAutoZoomToFinish(
      (detections, finishX) =>
        selectBoatEdgeNearFinish(
          detections,
          finishX,
          knownBow,
          maxDistance,
          rightToLeft ? 'left' : 'right',
          bowFilter,
        ),
      undefined,
      initialImage,
      0.7,
      rightToLeft,
    );
  // The configured travel direction is trusted, never second-guessed.
  return search(getTravelRightToLeft());
};

export const autoZoomToFinishNearFinish = (
  knownBow: string,
  maxDistance: number,
  initialImage?: AppImage,
  bowFilter?: BowSelectionFilter,
) =>
  whileBusy(() =>
    searchNearFinish(knownBow, maxDistance, initialImage, bowFilter),
  );
