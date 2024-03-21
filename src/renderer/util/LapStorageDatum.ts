import { Lap } from 'crewtimer-common';
import { UseMemDatum } from '../store/UseElectronDatum';
import { LapDatumName, LapListInitCount } from '../shared/Constants';
import { UseKeyedDatum } from './UseKeyedDatum';

export const [useLaps, setLaps, getLaps] = UseMemDatum<Lap[]>(LapDatumName, []);
export const [useLapListInitCount] = UseMemDatum(LapListInitCount, 0);

export const [
  useEntryResult,
  _setEntryResult,
  getEntryResult,
  clearEntryResults,
  getEntryResultKeys,
  dumpEntryResults,
] = UseKeyedDatum<Lap | undefined>();

export const setEntryResult = (key: string, lap: Lap) => {
  _setEntryResult(key, lap, true);
  lap.SequenceNum = (lap.SequenceNum || 0) + 1;
  window.LapStorage.updateLap(lap);
};
