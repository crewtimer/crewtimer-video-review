import type { AppImage } from 'renderer/shared/AppTypes';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import {
  getZoomToTimingGuide,
  getLabelNumbers,
  normalizeBowForCurrentEvent,
  getWaypoint,
} from 'renderer/util/UseSettings';
import { getVideoEvent, setVideoBow } from './VideoSettings';
import { autoZoomToFinishNearFinish } from './AutoZoomToFinish';

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
    const detectedBow = result.bow.trim();
    if (
      getLabelNumbers() &&
      next.Bow === '?' &&
      detectedBow &&
      detectedBow !== '?'
    ) {
      setVideoBow(normalizeBowForCurrentEvent(detectedBow), next.uuid);
    }
  }
};
