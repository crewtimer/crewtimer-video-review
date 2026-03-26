import { setToast } from 'renderer/Toast';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { getWaypoint } from 'renderer/util/UseSettings';
import { gateFromWaypoint } from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import {
  seekToTimestamp,
  seekToTimestampWithInterpolation,
} from './RequestVideoFrame';
import { getClickerData } from './UseClickerData';
import {
  getVideoScaling,
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

    // if we have a time for this entry, try and seek there
    const key = `${gateFromWaypoint(getWaypoint())}_${
      entry?.EventNum
    }_${entry?.Bow}`;
    let lap = getEntryResult(key);
    if (!lap?.Time || lap?.State === 'Deleted') {
      // fall back to the hint time if available
      const hintClickerData = getClickerData();
      lap = hintClickerData.find(
        (l) =>
          l.Time &&
          l.EventNum === entry.EventNum &&
          l.Bow === entry.Bow &&
          l.State !== 'Deleted',
      );
    }
    if (lap?.Time && lap?.State !== 'Deleted') {
      const seekTime = lap.Time;
      setTimeout(async () => {
        const interpolation = await loadInterpolationRecordForLap(lap);
        if (!interpolation && getVideoScaling().zoomY !== 1) {
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
