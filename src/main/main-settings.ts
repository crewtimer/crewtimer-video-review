import { MobileSettings } from 'crewtimer-common';

import {
  FirebaseConnectedKey,
  MobileConfigCountKey,
  MobileConfigDateKey,
  MobileConfigKey,
  N_DEBUG_LEVEL,
  N_FL_START_WAYPOINT,
  N_FL_START_WAYPOINT_ENABLE,
  N_MOBILE_ID,
  N_WAYPOINT,
} from '../renderer/shared/Constants';
import {
  getMemValue,
  getStoredValue,
  setMemValue,
  setStoredValue,
} from './store/store';

export const getWaypoint = () => getStoredValue(N_WAYPOINT, '');
export const getFLStartWaypoint = () => getStoredValue(N_FL_START_WAYPOINT, '');
export const getFLStartWaypointEnable = () =>
  getStoredValue(N_FL_START_WAYPOINT_ENABLE, '');
export const getDay = () => getStoredValue('Day', '');
export const getMobileID = () => getStoredValue(N_MOBILE_ID, '');
export const getMobilePin = () => getStoredValue('MobileKey', '');
export const setMobileConfig = (config: MobileSettings | undefined) =>
  setStoredValue(MobileConfigKey, config);

export const setMobileConfigCount = (n: number) =>
  setMemValue(MobileConfigCountKey, n);
export const setMobileConfigDate = (d: string) =>
  setMemValue(MobileConfigDateKey, d);
export const getMobileConfigCount = () => getMemValue(MobileConfigCountKey, 0);

export const getFirebaseConnected = () =>
  getMemValue(FirebaseConnectedKey, false);
export const setFirebaseConnected = (connected: boolean) =>
  setMemValue(FirebaseConnectedKey, connected);

export const getDebugLevel = () => getMemValue<number>(N_DEBUG_LEVEL, 0);

export const getMobileConfig = () =>
  getStoredValue<MobileSettings | undefined>(MobileConfigKey, undefined);

let bowToEvent = new Map<string, string>();
export const setBowToEvent = (newBowToEvent: Map<string, string>) => {
  bowToEvent = newBowToEvent;
};
export const getBowToEvent = () => bowToEvent;

export const getFlightRaces = () => getStoredValue('FlightRaces', '');

export const getVideoFile = () => getStoredValue('videoFile', 'test.mp4');
export const setVideoFile = (file: string) => setStoredValue('videoFile', file);
