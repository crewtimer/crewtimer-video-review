import { setToast } from 'renderer/Toast';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { getWaypoint } from 'renderer/util/UseSettings';
import { gateFromWaypoint } from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import { seekToTimestampAndWait } from './RequestVideoFrame';
import {
  getVideoScaling,
  getVideoSettings,
  setVideoEvent,
  setVideoBow,
  resetVideoZoom,
  ResultRowType,
  setBowSeekPending,
} from './VideoSettings';
import {
  clearAutoZoomDetectionCache,
  clearAutoZoomInterpolation,
} from './AutoZoomToFinish';

export function sanitizeFirebaseKey(s: string) {
  return s.replace(/[#$/[.\]]/g, '-');
}

export const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: ResultRowType;
} | null>(null);

let bowSeekRequest = 0;
let bowSeekTimer: ReturnType<typeof setTimeout> | undefined;

export const seekToBow = (entry: { EventNum: string; Bow: string }) => {
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

    const key = `${gateFromWaypoint(getWaypoint())}_${entry.EventNum}_${entry.Bow}`;
    const scoredLap = getEntryResult(key);
    const useScoredLap = !!(scoredLap?.Time && scoredLap.State !== 'Deleted');
    let lap = useScoredLap ? scoredLap : undefined;
    if (!lap) {
      const hintWaypoint = getVideoSettings().timingHintSource;
      const hintKey = hintWaypoint
        ? `${gateFromWaypoint(hintWaypoint)}_${entry.EventNum}_${entry.Bow}`
        : '';
      const hintLap = hintKey ? getEntryResult(hintKey) : undefined;
      if (hintLap?.Time && hintLap.State !== 'Deleted') {
        lap = hintLap;
      }
    }
    if (!lap) {
      const secondaryHintWaypoint =
        getVideoSettings().secondaryTimingHintSource;
      const secondaryHintKey = secondaryHintWaypoint
        ? `${gateFromWaypoint(secondaryHintWaypoint)}_${entry.EventNum}_${entry.Bow}`
        : '';
      const secondaryHintLap = secondaryHintKey
        ? getEntryResult(secondaryHintKey)
        : undefined;
      if (secondaryHintLap?.Time && secondaryHintLap.State !== 'Deleted') {
        lap = secondaryHintLap;
      }
    }

    if (lap?.Time && lap?.State !== 'Deleted') {
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
          const found = await seekToTimestampAndWait({
            time: seekTime,
            bow: lap.Bow,
            interpolate: true,
            commitGuard: () => requestId === bowSeekRequest,
          });
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
