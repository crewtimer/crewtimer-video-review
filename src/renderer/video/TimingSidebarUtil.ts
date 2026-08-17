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

export const seekToBow = (entry: { EventNum: string; Bow: string }) => {
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
      const requestId = bowSeekRequest + 1;
      bowSeekRequest = requestId;
      clearAutoZoomInterpolation();
      clearAutoZoomDetectionCache();
      setBowSeekPending(true);
      setTimeout(async () => {
        try {
          if (getVideoScaling().zoomY !== 1) {
            await resetVideoZoom();
          }
          const found = await seekToTimestampAndWait({
            time: seekTime,
            bow: lap.Bow,
            interpolate: true,
          });
          if (!found) {
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
    }
  }
};
