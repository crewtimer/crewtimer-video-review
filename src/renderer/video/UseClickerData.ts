import { Lap, KeyMap } from 'crewtimer-common';
import { useFirebaseDatum } from 'renderer/util/UseFirebase';
import { UseKeyedDatum } from 'renderer/util/UseKeyedDatum';
import {
  getDay,
  getMobileConfig,
  getMobileID,
  useDay,
} from 'renderer/util/UseSettings';
import { gateFromWaypoint, getConnectionProps } from 'renderer/util/Util';
import { getVideoSettings, useVideoSettings } from './VideoSettings';
import { parseTimeToSeconds } from '../util/StringUtils';

export interface ExtendedLap extends Lap {
  seconds: number;
}
/**
 * This function transforms data received by firebase into a more easily usable format.
 * @param lapdata
 * @returns Lap[]
 */
const onDataRxTransformer = (
  lapdata: KeyMap<Lap> | undefined,
): ExtendedLap[] => {
  if (lapdata) {
    let filteredEvents = getMobileConfig()?.eventList || [];

    const day = getDay();
    if (day) {
      filteredEvents = filteredEvents.filter((event) => event.Day === day);
    }

    let sorted = Object.values(lapdata) as ExtendedLap[];
    const eventSet = new Set<string>();
    filteredEvents.forEach((event) => {
      eventSet.add(event.EventNum);
    });

    // Remove entries that are deleted or have no matching day value if day is set
    sorted = sorted.filter(
      (lap) =>
        lap.State !== 'Deleted' &&
        ((lap.EventNum === '?' && (!day || lap.Day === day)) ||
          eventSet.has(lap.EventNum)),
    );
    sorted.forEach((lap) => {
      lap.seconds = parseTimeToSeconds(lap.Time || '00:00:00.000');
    });
    sorted = sorted.sort((a, b) => a.seconds - b.seconds);
    return sorted;
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
