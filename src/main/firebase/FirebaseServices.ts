import {
  ref,
  onValue,
  DatabaseReference,
  Unsubscribe,
  DataSnapshot,
} from 'firebase/database';
import firebasedb from './FirebaseConfig';
import {
  getMobileConfigCount,
  getMobileID,
  getMobilePin,
  setFirebaseConnected,
  setMobileConfig,
  setMobileConfigCount,
} from '../main-settings';
import { N_MOBILE_ID } from '../../renderer/shared/Constants';
import { getConnectionProps, onPropertyChange } from '../../renderer/util/Util';
import TestData from '../../../data/r12924-mobile.json';
import { MobileSettings } from 'crewtimer-common';

const rxFirebaseResults = (snapshot: DataSnapshot) => {
  const val = snapshot.val();
  // console.log(JSON.stringify(val));
  setMobileConfig(val);
  setMobileConfigCount(getMobileConfigCount() + 1);
};

let dbref: DatabaseReference | undefined;
let inforef: DatabaseReference | undefined;
let dbunsub: Unsubscribe | undefined;
let infounsub: Unsubscribe | undefined;

export function stopFirebase() {
  if (dbref) {
    dbunsub?.();
    dbref = undefined;
  }
  if (inforef) {
    infounsub?.();
    inforef = undefined;
    setFirebaseConnected(false);
  }
}

function onConfigChanged() {
  const mobilePin = getMobilePin();
  const mobileID = getMobileID();
  stopFirebase();
  if (!mobilePin || !mobileID) {
    return;
  }

  if (mobileID === 'test' && mobilePin === 'xyzzy') {
    setMobileConfig(TestData.settings as unknown as MobileSettings);
    setMobileConfigCount(getMobileConfigCount() + 1);
    setFirebaseConnected(true);
    return;
  }

  const { regattaID } = getConnectionProps(mobileID);
  const db = firebasedb(mobileID);
  dbref = ref(db, `mobile/${regattaID}/settings`);
  dbunsub = onValue(dbref, rxFirebaseResults);
  inforef = ref(db, '.info/connected');
  infounsub = onValue(inforef, (snap) => {
    setFirebaseConnected(snap.val() === true);
  });
}

export function startFirebase() {
  onPropertyChange(N_MOBILE_ID, onConfigChanged);
  onConfigChanged();
}
