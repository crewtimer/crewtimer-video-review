import { UseDatum } from 'react-usedatum';
import { MobileSettings } from 'crewtimer-common';
import { UseMemDatum, UseStoredDatum } from '../store/UseElectronDatum';
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
} from '../shared/Constants';

const { LapStorage } = window;
export const AUTH_OK = 'OK';

export const [useMobilePin, setMobilePin, getMobilePin] = UseStoredDatum(
  'MobileKey',
  ''
);
export const [useMobileID, setMobileID, getMobileID] = UseStoredDatum(
  N_MOBILE_ID,
  '',
  (current, prior) => {
    if (prior !== '' && current !== prior) {
      LapStorage.truncateLapTable();
    }
  }
);

export const [useWaypoint, setWaypoint, getWaypoint] = UseStoredDatum(
  N_WAYPOINT,
  'Finish'
);
export const [useFLStartWaypoint, setFLStartWaypoint, getFLStartWaypoint] =
  UseStoredDatum(N_FL_START_WAYPOINT, 'Start');
export const [
  useFLStartWaypointEnable,
  setFLStartWaypointEnable,
  getFLStartWaypointEnable,
] = UseStoredDatum(N_FL_START_WAYPOINT_ENABLE, false);
export const [useDay, setDay, getDay] = UseStoredDatum('Day', 'Day');

export const [useMobileConfig, setMobileConfig, getMobileConfig] =
  UseStoredDatum<MobileSettings | undefined>(MobileConfigKey, undefined);

export const [useAuthStatus, setAuthStatus, getAuthStatus] =
  UseStoredDatum<string>('authStatus', '');

export const [useSingleEvent, setSingleEvent, getSingleEvent] =
  UseStoredDatum<boolean>('singleEvent', false);

export const useAuthOK = () => {
  const [authStatus] = useAuthStatus();
  return authStatus === 'OK';
};

export const [useDebugLevel, setDebugLevel, getDebugLevel] =
  UseMemDatum<number>(N_DEBUG_LEVEL, 0);

// Tab position of the CenteredTabs component
export const [useTabPosition, setTabPosition, getTabPosition] = UseStoredDatum(
  'systemTabPosition',
  'System Config'
);

export const [useFirebaseConnected, setFirebaseConnected] = UseMemDatum(
  FirebaseConnectedKey,
  false
);

export const [
  useMobileConfigCount,
  setMobileConfigCount,
  getMobileConfigCount,
] = UseMemDatum<number>(MobileConfigCountKey, 0);

export const [useMobileConfigDate] = UseMemDatum<string>(
  MobileConfigDateKey,
  ''
);
export const [useInitializing, setInitializing] = UseDatum(true);
