import { KeyMap, Lap } from 'crewtimer-common';
import { UseMemDatum } from '../store/UseElectronDatum';
import { LapDatumName, LapListInitCount } from '../shared/Constants';
import { UseKeyedDatum } from './UseKeyedDatum';

export const [useLaps, setLaps, getLaps] = UseMemDatum<Lap[]>(LapDatumName, []);
export const [useLapListInitCount] = UseMemDatum(LapListInitCount, 0);

let entryCache: KeyMap<Lap> = {};
export const [
  useEntryResult,
  _setEntryResult,
  clearEntryResults,
  getEntryResultKeys,
  dumpEntryResults,
] = UseKeyedDatum<Lap | undefined>((key: string) => {
  return entryCache[key];
});

export const setEntryResult = (key: string, lap: Lap) => {
  _setEntryResult(key, lap, true);
  lap.SequenceNum = (lap.SequenceNum || 0) + 1;
  window.LapStorage.updateLap(lap);
  entryCache[key] = lap;
};

export const getEntryResult = (key: string) => {
  return entryCache[key];
};

export const dumpEntries = () => {
  console.log(JSON.stringify(entryCache, null, 2));
};
