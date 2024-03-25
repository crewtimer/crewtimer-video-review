import { Lap, KeyMap } from 'crewtimer-common';
import { UseDatum } from 'react-usedatum';
import {
  closeFirebaseDatum,
  useFirebaseDatum,
} from 'renderer/util/UseFirebase';
import {
  getDay,
  getMobileConfig,
  getMobileID,
} from 'renderer/util/UseSettings';
import { gateFromWaypoint, getConnectionProps } from 'renderer/util/Util';
import { getClickerWaypoint } from './VideoSettings';

let useLapDataDatum = UseDatum<Lap[] | undefined>([]);
let activePath = '';
let activeDay = '';
let activeGate = '';
const useLapData = (regattaId: string) => {
  const path = `regatta/${regattaId}/lapdata`;
  if (
    activePath !== path ||
    activeDay !== getDay() ||
    activeGate !== getClickerWaypoint()
  ) {
    closeFirebaseDatum(activePath);
    activePath = path;
    activeDay = getDay();
    activeGate = getClickerWaypoint();
    useLapDataDatum = useFirebaseDatum<Lap[]>(path, {
      filter: { key: 'Gate', value: gateFromWaypoint(getClickerWaypoint()) },
      onDataRx: (lapdata: KeyMap<Lap> | undefined) => {
        if (lapdata) {
          let filteredEvents = getMobileConfig()?.eventList || [];
          const day = getDay();
          if (day) {
            filteredEvents = filteredEvents.filter(
              (event) => event.Day === day
            );
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
      },
    });
  }

  return useLapDataDatum[0]();
};

export const useClickerData = () => {
  const mobileID = getMobileID();
  const { regattaID } = getConnectionProps(mobileID);
  let [lapdata] = useLapData(regattaID);
  if (lapdata === undefined) {
    lapdata = [];
  }
  return lapdata;
};
