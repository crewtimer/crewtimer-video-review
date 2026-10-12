import { setToast } from 'renderer/Toast';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { getWaypoint } from 'renderer/util/UseSettings';
import { gateFromWaypoint } from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import {
  seekToTimestampAndWait,
  seekToTimestampWithInterpolation,
} from './RequestVideoFrame';
import {
  getVideoScaling,
  getVideoSettings,
  setVideoEvent,
  setVideoBow,
  resetVideoZoom,
  ResultRowType,
  setBowSeekPending,
  setLastSeekTime,
} from './VideoSettings';
import {
  clearAutoZoomDetectionCache,
  clearAutoZoomInterpolation,
} from './AutoZoomToFinish';
import { loadInterpolationRecordForLap } from './InterpolationStore';

export const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: ResultRowType;
} | null>(null);

let bowSeekRequest = 0;
let bowSeekTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Finds the time to seek to for an entry: the scored time first, then the
 * primary and secondary timing hints.
 *
 * @returns The lap to seek to and whether it is the scored lap, or undefined.
 */
export const findSeekLap = (entry: { EventNum: string; Bow: string }) => {
  if (!entry.Bow) {
    return undefined;
  }
  const lapForWaypoint = (waypoint: string | undefined) => {
    if (!waypoint) {
      return undefined;
    }
    const lap = getEntryResult(
      `${gateFromWaypoint(waypoint)}_${entry.EventNum}_${entry.Bow}`,
    );
    return lap?.Time && lap.State !== 'Deleted' ? lap : undefined;
  };
  const scoredLap = lapForWaypoint(getWaypoint());
  if (scoredLap) {
    return { lap: scoredLap, scored: true };
  }
  const { timingHintSource, secondaryTimingHintSource } = getVideoSettings();
  const hintLap =
    lapForWaypoint(timingHintSource) ||
    lapForWaypoint(secondaryTimingHintSource);
  return hintLap ? { lap: hintLap, scored: false } : undefined;
};

/**
 * Selects an entry and seeks the video to its scored time, falling back to a
 * timing hint.
 *
 * With `zoom` true, a scored time with saved interpolation context restores
 * the zoomed view used when it was recorded. Otherwise the full frame is shown.
 */
export const seekToBow = (
  entry: { EventNum: string; Bow: string },
  { zoom = true }: { zoom?: boolean } = {},
) => {
  const requestId = bowSeekRequest + 1;
  bowSeekRequest = requestId;
  if (bowSeekTimer) {
    clearTimeout(bowSeekTimer);
    bowSeekTimer = undefined;
  }
  clearAutoZoomInterpolation();
  clearAutoZoomDetectionCache();
  setBowSeekPending(false);
  setVideoEvent(entry.EventNum);
  if (entry.Bow) {
    setVideoBow(entry.Bow);

    const lap = findSeekLap(entry)?.lap;
    if (lap?.Time) {
      const seekTime = lap.Time;
      setBowSeekPending(true);
      bowSeekTimer = setTimeout(async () => {
        bowSeekTimer = undefined;
        if (requestId !== bowSeekRequest) {
          return;
        }
        try {
          if (getVideoScaling().zoomY !== 1) {
            await resetVideoZoom();
          }
          if (requestId !== bowSeekRequest) {
            return;
          }
          const interpolation = await loadInterpolationRecordForLap(lap);
          if (requestId !== bowSeekRequest) {
            return;
          }
          let found;
          if (interpolation && zoom) {
            found = await seekToTimestampWithInterpolation({
              time: seekTime,
              bow: lap.Bow,
              interpolation,
            });
          } else {
            // Scored times include rolling-shutter correction; seek to the
            // original frame time when it was saved.
            found = await seekToTimestampAndWait({
              time: interpolation?.frameTime ?? seekTime,
              bow: lap.Bow,
              interpolate: true,
              commitGuard: () => requestId === bowSeekRequest,
            });
            if (interpolation?.frameTime && requestId === bowSeekRequest) {
              // Keep navigation anchored to the scored result time.
              setLastSeekTime({ time: seekTime, bow: lap.Bow });
            }
          }
          if (!found && requestId === bowSeekRequest) {
            setToast({
              severity: 'warning',
              msg: 'Associated video file not found',
            });
          }
        } finally {
          if (requestId === bowSeekRequest) {
            setBowSeekPending(false);
          }
        }
      }, 100);
    } else {
      setBowSeekPending(false);
    }
  }
};
