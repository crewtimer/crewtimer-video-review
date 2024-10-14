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
import { useVideoSettings } from './VideoSettings';

/**
 * This function transforms data received by firebase into a more easily usable format.
 * @param lapdata
 * @returns Lap[]
 */
const onDataRxTransformer = (lapdata: KeyMap<Lap> | undefined): Lap[] => {
  if (lapdata) {
    let filteredEvents = getMobileConfig()?.eventList || [];

    const day = getDay();
    if (day) {
      filteredEvents = filteredEvents.filter((event) => event.Day === day);
    }

    let sorted = Object.values(lapdata);
    const eventSet = new Set<string>();
    filteredEvents.forEach((event) => {
      eventSet.add(event.EventNum);
    });

    sorted = sorted.filter(
      (lap) =>
        lap.State !== 'Deleted' &&
        (lap.EventNum === '?' || eventSet.has(lap.EventNum))
    );
    sorted = sorted.sort((a, b) =>
      (a.Time || '00:00:00.000').localeCompare(b.Time || '00:00:00.000')
    );
    return sorted;
  } else {
    return [];
  }
};

export const useClickerData = (waypoint?: string) => {
  const mobileID = getMobileID();
  const [day] = useDay();
  const [videoSettings] = useVideoSettings();

  const { regattaID } = getConnectionProps(mobileID);
  const path = `regatta/${regattaID}/lapdata`;
  const gate = gateFromWaypoint(
    waypoint ? waypoint : videoSettings.timingHintSource
  );

  const lapdata = useFirebaseDatum<KeyMap<Lap>, Lap[]>(path, {
    filter: { key: 'Gate', value: gate },
    dataTransformer: onDataRxTransformer,
    changeKey: day,
  });

  return lapdata || [];
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
  UseKeyedDatum<string>();
