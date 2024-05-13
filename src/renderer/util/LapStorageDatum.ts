import { Lap } from 'crewtimer-common';
import { UseMemDatum } from '../store/UseElectronDatum';
import { LapDatumName, LapListInitCount } from '../shared/Constants';
import { UseKeyedDatum } from './UseKeyedDatum';

export const [useLaps, setLaps, getLaps] = UseMemDatum<Lap[]>(LapDatumName, []);
export const [useLapListInitCount] = UseMemDatum(LapListInitCount, 0);

export const [
  useEntryResult,
  setEntryResult,
  getEntryResult,
  clearEntryResults,
  getEntryResultKeys,
  dumpEntryResults,
] = UseKeyedDatum<Lap | undefined>();

export const setEntryResultAndPublish = (key: string, lap: Lap) => {
  setEntryResult(key, lap, true);
  lap.SequenceNum = (lap.SequenceNum || 0) + 1;
  window.LapStorage.updateLap(lap);
};
