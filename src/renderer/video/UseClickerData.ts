import { Lap, KeyMap, Event } from 'crewtimer-common';
import { useFirebaseDatum } from 'renderer/util/UseFirebase';
import { UseKeyedDatum } from 'renderer/util/UseKeyedDatum';
import {
  getDay,
  getMobileConfig,
  getMobileID,
  useDay,
} from 'renderer/util/UseSettings';
import { gateFromWaypoint, getConnectionProps } from 'renderer/util/Util';
import {
  getVideoBow,
  getVideoBowUuid,
  getVideoSettings,
  setVideoBow,
  setVideoEvent,
  useVideoSettings,
} from './VideoSettings';
import { parseTimeToSeconds } from '../util/StringUtils';
import {
  getEntryResult,
  setEntryResult,
  setEntryResultsChanged,
} from 'renderer/util/LapStorageDatum';
import { deepCompare } from 'renderer/util/Compare';

export interface ExtendedLap extends Lap {
  seconds: number;
}

const timestampSort = (a: Lap, b: Lap) => {
  const t1 = a.Timestamp || 0;
  const t2 = b.Timestamp || 0;
  if (t1 < t2) {
    return -1;
  }
  if (t1 > t2) {
    return 1;
  }
  return 0;
};

/**
 * This function transforms data received by firebase into a more easily usable format.
 * @param lapdata
 * @returns Lap[]
 */
const onDataRxTransformer = (
  lapdataMap: KeyMap<Lap> | undefined,
): ExtendedLap[] => {
  if (lapdataMap) {
    let filteredEvents = (getMobileConfig()?.eventList || []) as Event[];

    const day = getDay();
    if (day) {
      filteredEvents = filteredEvents.filter((event) => event.Day === day);
    }

    let lapList = Object.values(lapdataMap) as ExtendedLap[];
    lapList.sort(timestampSort); // sort by server timestamp so newer timestamps override older ones

    const eventSet = new Set<string>();
    filteredEvents.forEach((event) => {
      eventSet.add(event.EventNum);
    });

    const videoBow = getVideoBow();
    const videoUuid = getVideoBowUuid();
    const keyedLaps = new Map<string, ExtendedLap>();
    const keysToDelete = new Set<string>();

    // Remove entries that are deleted or have no matching day value if day is set
    lapList.forEach((lapraw) => {
      const lap = { ...lapraw };
      // If our current videoBow is '?' (not set) and this lap matches the videoUuid, set the videoBow to this lap's bow
      if (videoBow === '?' && lap.EventNum !== '?' && lap.uuid === videoUuid) {
        setVideoBow(lap.Bow, lap.uuid);
        setVideoEvent(lap.EventNum);
      }
      // omit deleted, "?" event, and non-matching day
      const keep =
        lap.State !== 'Deleted' &&
        ((lap.EventNum === '?' && (!day || lap.Day === day)) ||
          eventSet.has(lap.EventNum));

      // Update caches
      const key = `${lap.Gate}_${lap.EventNum}_${lap.Bow}`;
      lap.keyid = key;
      if (keep) {
        keyedLaps.set(key, lap);
        keysToDelete.delete(key); // have value, clear any accumulated delete
      } else {
        if (lap.State === 'Deleted') {
          keysToDelete.add(key);
        }
        keyedLaps.delete(key);
      }
    });

    // Apply deletes last to ensure they take trigger any needed updates
    keysToDelete.forEach((key) => {
      setEntryResult(key, undefined);
    });

    lapList = Array.from(keyedLaps.values());
    // trigger updates
    lapList.forEach((lap) => {
      lap.seconds = parseTimeToSeconds(lap.Time || '00:00:00.000');
      const prior = getEntryResult(lap.keyid);
      if (!deepCompare('', prior, lap)) {
        setEntryResultsChanged((n) => n + 1);
      }
      setEntryResult(lap.keyid, lap);
    });

    // Final sort by lap time instead of server time for presentation ease
    lapList.sort((a, b) => a.seconds - b.seconds);
    return lapList;
  }
  return [];
};

const clickerDataCache: KeyMap<ExtendedLap[]> = {};

export const getClickerData = (waypoint?: string): ExtendedLap[] => {
  const gate = gateFromWaypoint(
    waypoint || getVideoSettings().timingHintSource,
  );
  return clickerDataCache[gate] || [];
};

export const useClickerData = (waypoint?: string) => {
  const mobileID = getMobileID();
  const [day] = useDay();
  const [videoSettings] = useVideoSettings();

  const { regattaID } = getConnectionProps(mobileID);
  const path = `regatta/${regattaID}/lapdata`;
  const gate = gateFromWaypoint(waypoint || videoSettings.timingHintSource);

  const lapdata = useFirebaseDatum<KeyMap<Lap>, ExtendedLap[]>(path, {
    filter: { key: 'Gate', value: gate },
    dataTransformer: onDataRxTransformer,
    changeKey: day,
  });
  const result = lapdata || [];
  clickerDataCache[gate] = result;

  return result;
};

export const useResultData = () => {
  const mobileID = getMobileID();

  const { regattaID } = getConnectionProps(mobileID);
  const path = `results/${regattaID}/results/entries`;

  const entries = useFirebaseDatum<KeyMap[]>(path);
  return entries || [];
};

/**
 * React hook for subscribing to entry exception state - DNS, DNF, SCR.
 * @param {string} path A key computed as `1-${entry?.EventNum}-${entry?.Bow}`.
 * @returns {string | undefined} The current exception state.
 */
export const [useEntryException, setEntryException, , clearEntryExceptions] =
  UseKeyedDatum<string | undefined>(undefined);
