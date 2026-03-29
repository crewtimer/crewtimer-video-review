import { setToast } from 'renderer/Toast';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { getWaypoint } from 'renderer/util/UseSettings';
import { gateFromWaypoint } from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import {
  seekToTimestamp,
  seekToTimestampWithInterpolation,
} from './RequestVideoFrame';
import {
  getVideoScaling,
  getVideoSettings,
  setVideoEvent,
  setVideoBow,
  resetVideoZoom,
  ResultRowType,
} from './VideoSettings';
import { loadInterpolationRecordForLap } from './InterpolationStore';

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function sanitizeFirebaseKey(s: string) {
  return s.replace(/[#$/[.\]]/g, '-');
}

export const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: ResultRowType;
} | null>(null);

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

    if (lap?.Time && lap?.State !== 'Deleted') {
      const seekTime = lap.Time;
      setTimeout(async () => {
        const interpolation = useScoredLap
          ? await loadInterpolationRecordForLap(lap)
          : undefined;
        if (useScoredLap && !interpolation && getVideoScaling().zoomY !== 1) {
          resetVideoZoom();
          await delay(150);
        }
        const found = interpolation
          ? await seekToTimestampWithInterpolation({
              time: seekTime,
              bow: lap.Bow,
              interpolation,
            })
          : seekToTimestamp({ time: seekTime, bow: lap.Bow });
        if (!found) {
          setToast({
            severity: 'warning',
            msg: 'Associated video file not found',
          });
        }
      }, 100);
    }
  }
};
