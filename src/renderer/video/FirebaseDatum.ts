import { MobileConfig } from 'crewtimer-common';
import { UseDatum } from 'react-usedatum';
import MobileData from '../../../data/r12924-mobile.json';

export const [useMobileData] = UseDatum<MobileConfig>(
  MobileData as unknown as MobileConfig
);
