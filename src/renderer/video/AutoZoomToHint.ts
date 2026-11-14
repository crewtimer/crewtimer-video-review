import type { AppImage } from 'renderer/shared/AppTypes';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import {
  getZoomToTimingGuide,
  getLabelNumbers,
  normalizeBowForCurrentEvent,
  getWaypoint,
  selectEventForBow,
} from 'renderer/util/UseSettings';
import { getVideoEvent, setVideoBow } from './VideoSettings';
import { autoZoomToFinishNearFinish } from './AutoZoomToFinish';
import { laneBowAfterAutoZoom } from './LaneBow';

/**
 * After seeking to a timing hint, auto zoom to the crossing nearest the
 * finish when zoom to timing guide is enabled.
 */
export const autoZoomAfterSeekToHint = async (
  next: { Bow?: string; uuid?: string },
  image: AppImage,
) => {
  if (getZoomToTimingGuide()) {
    // The seek has already selected the hint's event.
    const scoredPrefix = `${gateFromWaypoint(getWaypoint())}_${getVideoEvent()}`;
    const result = await autoZoomToFinishNearFinish(
      next.Bow || '',
      Number.POSITIVE_INFINITY,
      image,
      {
        normalizeBow: normalizeBowForCurrentEvent,
        isScoredBow: (bow) => {
          const lap = getEntryResult(`${scoredPrefix}_${bow}`);
          return !!lap?.Time && lap.State !== 'Deleted';
        },
      },
    );
    if (!result) {
      return;
    }
    if (next.Bow !== '?') {
      return;
    }
    const detectedBow = result.bow.trim();
    // Without a readable bow card, a sprint crew is known by its lane.
    const bow =
      getLabelNumbers() && detectedBow && detectedBow !== '?'
        ? selectEventForBow(detectedBow)
        : laneBowAfterAutoZoom(result);
    if (bow) {
      setVideoBow(bow, next.uuid);
    }
  }
};
