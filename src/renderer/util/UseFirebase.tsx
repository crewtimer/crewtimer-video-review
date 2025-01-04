import { KeyMap } from 'crewtimer-common';
import {
  DataSnapshot,
  equalTo,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database';
import { useEffect, useReducer, useRef } from 'react';
import firebasedb from '../shared/FirebaseConfig';
import { getMobileID } from './UseSettings';

type ValueTypes = string | number | boolean | null;

/**
 * Interface for defining options for watching Firebase data.
 * @template T Type of the original data from Firebase.
 * @template P Type of the transformed data to be used in the application.
 */
interface WatchFirebaseOpts<T, P> {
  filter?: { key: string; value: ValueTypes };
  dataTransformer?: (data: T | undefined) => P;
  changeKey?: string;
}

const callbackHandlers: KeyMap<(() => void)[]> = {};
const dataValues: KeyMap<any> = {};
const unsubscribers: KeyMap<() => void> = {};

/**
 * Subscribes to a Firebase database path and listens for data changes.
 * @template T The expected data type from Firebase.
 * @template P The data type after transformation, if any.
 * @param {string} path The database path to subscribe to.
 * @param {(data: T | undefined) => void} onDataRx Callback function to receive the data.
 * @param {WatchFirebaseOpts<T, P>} [opts] Optional parameters for filtering and transforming data.
 * @returns {() => void} Unsubscribe function to stop listening for data changes.
 */
export function firebaseSubscribe<T, P>(
  path: string,
  onDataRx: (data: T | undefined) => void,
  opts?: WatchFirebaseOpts<T, P>,
) {
  const mobileID = getMobileID();
  const database = firebasedb(mobileID);
  const rxResults = (snapshot: DataSnapshot) => {
    const val = snapshot.val();
    onDataRx(val === null ? undefined : val);
  };

  const dataRef = ref(database, path);
  const filteredRef = opts?.filter
    ? query(dataRef, orderByChild(opts.filter.key), equalTo(opts.filter.value))
    : dataRef;
  const unsubscribe = onValue(filteredRef, rxResults);
  return unsubscribe;
}

/**
 * React hook for subscribing to a Firebase data path and managing its state.
 * @template T The expected data type from Firebase.
 * @template P The data type after transformation, if any.
 * @param {string} path The Firebase database path to subscribe to.
 * @param {WatchFirebaseOpts<T, P>} [opts] Optional parameters for filtering and transforming data.
 * @returns {P | undefined} The current state of the data.
 */
export function useFirebaseDatum<T, P = T>(
  path: string,
  opts?: WatchFirebaseOpts<T, P>,
) {
  const key = `${path}_${opts?.filter?.key}_${opts?.filter?.value}_${opts?.changeKey}`;
  const [, forceUpdate] = useReducer((s) => s + 1, 0);
  const optsRef = useRef(opts);
  const val = dataValues[key];
  optsRef.current = opts;
  useEffect(() => {
    const setValueCallback = () => {
      forceUpdate();
    };
    if (!callbackHandlers[key]) {
      callbackHandlers[key] = [];
      dataValues[key] = undefined;
      forceUpdate();

      const unsubscribe = firebaseSubscribe(
        path,
        (data: T | undefined) => {
          const xformData = optsRef.current?.dataTransformer
            ? optsRef.current.dataTransformer(data)
            : data;
          dataValues[key] = xformData;
          callbackHandlers[key].forEach((callback) => {
            callback();
          });
        },
        optsRef.current,
      );
      unsubscribers[key] = unsubscribe;
    }
    const callbacks = callbackHandlers[key];
    callbacks.push(setValueCallback);

    return () => {
      callbacks.splice(callbacks.indexOf(setValueCallback), 1);
      if (callbacks.length === 0) {
        delete callbackHandlers[key];
        const unsubscribe = unsubscribers[key];
        delete unsubscribers[key];
        unsubscribe?.();
      }
    };
  }, [key, path]);

  return val;
}
