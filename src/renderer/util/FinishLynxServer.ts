import { LynxState, LynxStateKey } from '../shared/FinishLynx';
import { UseMemDatum } from '../store/UseElectronDatum';

export const [useLynxState, setLynxState] = UseMemDatum<LynxState>(
  LynxStateKey,
  {
    connected: false,
    remoteAddress: '',
  }
);
