import { Lap } from 'crewtimer-common';
import { UseMemDatum } from '../store/UseElectronDatum';
import { LapDatumName, LapListInitCount } from '../shared/Constants';
import { UseKeyedDatum } from './UseKeyedDatum';
import {
  getVideoSettings,
  getVideoFile,
  setVideoSettings,
} from '../video/VideoSettings';
import { showErrorDialog } from './ErrorDialog';
import { saveVideoSidecar } from '../video/VideoFileUtils';

export const [useLaps, setLaps, getLaps] = UseMemDatum<Lap[]>(LapDatumName, []);
export const [useLapListInitCount] = UseMemDatum(LapListInitCount, 0);

export const [
  useEntryResult,
  setEntryResult,
  getEntryResult,
  clearEntryResults,
  getEntryResultKeys,
  dumpEntryResults,
] = UseKeyedDatum<Lap | undefined>(undefined);

export const setEntryResultAndPublish = (key: string, lap: Lap) => {
  setEntryResult(key, lap, true);
  lap.SequenceNum = (lap.SequenceNum || 0) + 1;
  window.LapStorage.updateLap(lap);
  if (getVideoSettings().sidecarSource !== getVideoFile()) {
    setVideoSettings({ ...getVideoSettings(), sidecarSource: getVideoFile() });
    saveVideoSidecar().catch(showErrorDialog);
  }
};
