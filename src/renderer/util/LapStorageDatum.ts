import { Lap } from 'crewtimer-common';
import { UseMemDatum } from '../store/UseElectronDatum';
import { LapDatumName } from '../shared/Constants';

export const [useLaps, setLaps, getLaps] = UseMemDatum<Lap[]>(LapDatumName, []);
