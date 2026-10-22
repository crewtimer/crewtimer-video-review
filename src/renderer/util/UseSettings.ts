import { UseDatum } from 'react-usedatum';
import { MobileSettings } from 'crewtimer-common';
import { LapImageStatus } from 'renderer/shared/AppTypes';
import { getVideoEvent, useVideoSettings } from 'renderer/video/VideoSettings';
import {
  cardLengthForEvent,
  normalizeBowForEvent,
} from 'renderer/video/BowNumber';
import { UseMemDatum, UseStoredDatum } from '../store/UseElectronDatum';
import {
  FirebaseConnectedKey,
  MobileConfigCountKey,
  MobileConfigDateKey,
  MobileConfigKey,
  N_DEBUG_LEVEL,
  N_LABEL_BOATS,
  N_LABEL_NUMBERS,
  N_LABEL_CARDS_WITHOUT_BOAT,
  N_ZOOM_TO_TIMING_GUIDE,
  N_UPLOAD_LAP_IMAGES,
  N_FINISH_PHOTO_MAX_BOATS,
  LapImageStatusKey,
  N_BOW_CARD_LENGTH,
  N_BOW_OCR_MODEL,
  N_FL_START_WAYPOINT,
  N_FL_START_WAYPOINT_ENABLE,
  N_MOBILE_ID,
  N_WAYPOINT,
} from '../shared/Constants';
import { gateFromWaypoint } from './Util';

const { LapStorage } = window;
export const AUTH_OK = 'OK';

export const [useProgressBar, setProgressBar, getProgressBar] = UseDatum(0);

export const [useMobilePin, setMobilePin, getMobilePin] = UseStoredDatum(
  'MobileKey',
  '',
);
export const [useMobileID, setMobileID, getMobileID] = UseStoredDatum(
  N_MOBILE_ID,
  '',
  (current, prior) => {
    if (prior !== '' && current !== prior) {
      LapStorage.truncateLapTable();
    }
  },
);

export const [useWaypoint, setWaypoint, getWaypoint] = UseStoredDatum(
  N_WAYPOINT,
  'Finish',
);

export const useScoredGate = () => {
  const [waypoint] = useWaypoint();
  return gateFromWaypoint(waypoint);
};

export const useHintGate = () => {
  const [videoSettings] = useVideoSettings();
  const hintWaypoint = videoSettings?.timingHintSource || '';
  return gateFromWaypoint(hintWaypoint);
};

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
export const [useLabelBoats, setLabelBoats, getLabelBoats] =
  UseStoredDatum<boolean>(N_LABEL_BOATS, false);
/// When false, detected bow card numbers are neither shown nor used to fill
/// in the bow number.
export const [useLabelNumbers, setLabelNumbers, getLabelNumbers] =
  UseStoredDatum<boolean>(N_LABEL_NUMBERS, true);
export const [
  useLabelCardsWithoutBoat,
  setLabelCardsWithoutBoat,
  getLabelCardsWithoutBoat,
] = UseMemDatum<boolean>(N_LABEL_CARDS_WITHOUT_BOAT, false);
/**
 * When set, a single click on the video zooms to the nearby boat's crossing of
 * the timing guide, and seeks to a timing hint auto zoom to its crossing.
 */
export const [
  useZoomToTimingGuide,
  setZoomToTimingGuide,
  getZoomToTimingGuide,
] = UseStoredDatum<boolean>(N_ZOOM_TO_TIMING_GUIDE, false);

/** When set, an image of each recorded lap is uploaded to CrewTimer. */
export const [useUploadLapImages, setUploadLapImages, getUploadLapImages] =
  UseStoredDatum<boolean>(N_UPLOAD_LAP_IMAGES, false);
/** Most boats shown in a finish photo; 0 shows every finisher. */
export const [
  useFinishPhotoMaxBoats,
  setFinishPhotoMaxBoats,
  getFinishPhotoMaxBoats,
] = UseStoredDatum<number>(N_FINISH_PHOTO_MAX_BOATS, 10);
export const [useLapImageStatus] = UseMemDatum<LapImageStatus>(
  LapImageStatusKey,
  { pending: 0 },
);
export type BowOcrModel = 'numeric' | 'alphanumeric';
export type BowCardLength = 'auto' | 1 | 2 | 3;
export const [useBowOcrModel, setBowOcrModel, getBowOcrModel] =
  UseStoredDatum<BowOcrModel>(N_BOW_OCR_MODEL, 'numeric');
export const [useBowCardLength, setBowCardLength, getBowCardLength] =
  UseStoredDatum<BowCardLength>(N_BOW_CARD_LENGTH, 'auto');

const getCurrentEvent = () => {
  const eventNum = getVideoEvent();
  return getMobileConfig()?.eventList?.find(
    (candidate) => candidate.EventNum === eventNum,
  );
};

export const getBowDetectionOptions = () => ({
  numericOnly: getBowOcrModel() === 'numeric',
  cardLength: cardLengthForEvent(getBowCardLength(), getCurrentEvent()),
});

export const normalizeBowForCurrentEvent = (bow: string) => {
  return normalizeBowForEvent(bow, getCurrentEvent());
};

// Tab position of the CenteredTabs component
export const [useTabPosition, setTabPosition, getTabPosition] = UseStoredDatum(
  'systemTabPosition',
  'System Config',
);

export const [useFirebaseConnected, setFirebaseConnected] = UseMemDatum(
  FirebaseConnectedKey,
  false,
);

export const [
  useMobileConfigCount,
  setMobileConfigCount,
  getMobileConfigCount,
] = UseMemDatum<number>(MobileConfigCountKey, 0);

export const [useMobileConfigDate] = UseMemDatum<string>(
  MobileConfigDateKey,
  '',
);

export const getWaypointList = () => {
  let waypointList = ['Start'];
  const waypoints = getMobileConfig()?.info.Waypoints || '';
  if (waypoints.length > 0) {
    waypointList = waypointList.concat(waypoints.split(','));
  }
  waypointList = waypointList.concat(['Finish']);
  waypointList = waypointList.map((waypoint) => waypoint.trim());
  return waypointList;
};
export const [useInitializing, setInitializing] = UseDatum(true);

export const [useLastInfoNag, setLastInfoNag, getLastInfoNag] = UseStoredDatum(
  'lastInfoNag',
  '',
);
