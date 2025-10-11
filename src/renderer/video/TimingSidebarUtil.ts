import { setToast } from 'renderer/Toast';
import { getEntryResult } from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import { seekToTimestamp } from './RequestVideoFrame';
import { getClickerData } from './UseClickerData';
import {
  setVideoEvent,
  setVideoBow,
  resetVideoZoom,
  ResultRowType,
} from './VideoSettings';
import { UseDatum } from 'react-usedatum';
import { getWaypoint } from 'renderer/util/UseSettings';

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
      resetVideoZoom();
      const seekTime = lap.Time;
      setTimeout(() => {
        const found = seekToTimestamp({ time: seekTime, bow: lap.Bow });
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
