import { UseDatum } from 'react-usedatum';
import { KeyMap, Lap } from 'crewtimer-common';
import {
  DataSnapshot,
  equalTo,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database';
import firebasedb from '../shared/FirebaseConfig';
import { getMobileID } from './UseSettings';

const datumCache: KeyMap<any> = {};
const closeDatumCache: KeyMap<() => void> = {};
type ValueTypes = string | number | boolean | null;
export function useFirebaseDatum<T = any>(
  path: string,
  opts?: {
    filter?: { key: string; value: ValueTypes };
    onDataRx?: (data: any) => T | undefined;
  }
) {
  const datum = UseDatum<T | undefined>(undefined);
  let cachedDatum = datumCache[path];
  if (!cachedDatum) {
    cachedDatum = datum;
    datumCache[path] = datum;
    const mobileID = getMobileID();
    const database = firebasedb(mobileID);
    const rxResults = (snapshot: DataSnapshot) => {
      const val = snapshot.val();
      if (val) {
        // console.log(`Rx ${path} ${JSON.stringify(val)}`);
        const cooked = opts?.onDataRx ? opts.onDataRx(val) : val;
        datumCache[path]?.[1](cooked);
      }
    };

    const dataRef = ref(database, path);
    const filteredRef = opts?.filter
      ? query(
          dataRef,
          orderByChild(opts.filter.key),
          equalTo(opts.filter.value)
        )
      : dataRef;
    const unsubscribe = onValue(filteredRef, rxResults);
    closeDatumCache[path] = unsubscribe;
  }
  return datum;
}

export const closeFirebaseDatum = (path: string) => {
  const closeFunc = closeDatumCache[path];
  if (closeFunc) {
    closeFunc();
  }
  delete datumCache[path];
};
