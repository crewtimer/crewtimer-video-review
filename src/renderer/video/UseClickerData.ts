import { Lap, KeyMap } from 'crewtimer-common';
import { useFirebaseDatum } from 'renderer/util/UseFirebase';
import {
  getDay,
  getMobileConfig,
  getMobileID,
  useDay,
} from 'renderer/util/UseSettings';
import { gateFromWaypoint, getConnectionProps } from 'renderer/util/Util';
import { useVideoSettings } from './VideoSettings';

const onDataRx = (lapdata: KeyMap<Lap> | undefined): Lap[] => {
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

export const useClickerData = () => {
  const mobileID = getMobileID();
  const [day] = useDay();
  const [videoSettings] = useVideoSettings();
  const timingHintSource = videoSettings.timingHintSource;

  const { regattaID } = getConnectionProps(mobileID);
  const path = `regatta/${regattaID}/lapdata`;
  const gate = gateFromWaypoint(timingHintSource);

  const lapdata = useFirebaseDatum<KeyMap<Lap>, Lap[]>(path, {
    filter: { key: 'Gate', value: gate },
    dataTransformer: onDataRx,
    changeKey: day,
  });

  return lapdata || [];
};
