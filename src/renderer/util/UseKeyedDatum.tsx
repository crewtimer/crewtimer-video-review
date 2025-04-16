/* eslint-disable no-unused-vars */
import { useMemo, useEffect } from 'react';
import { UseDatum } from 'react-usedatum';

// Version 1.0.5 April 16, 2025

/**
 * Generate a hook to keep track of a keyed value (usually a uuid).
 *
 * @param initialValueProp A function to query the current value based on a key
 * @returns [useFunction, setFunction, clearFunction, getKeyListFunction]
 *
 * Usage: const [useKeyedBoolean, setKeyedBoolean, clearKeyedBoolean, getKeyList ] = UseKeyedDatum<boolean>( (key:string)=>mylookup(key))
 */
export const UseKeyedDatum = <T,>(
  // eslint-disable-next-line no-unused-vars
  initialValueProp: T | ((key: string) => T),
  // eslint-disable-next-line no-unused-vars
  onChange?: (key: string, current: T, prior: T) => void,
) => {
  const wrapperDatum = () => UseDatum<T>(false as unknown as T); // used for typing only
  const lookupCache = new Map<string, Set<ReturnType<typeof wrapperDatum>>>();
  const valueCache = new Map<string, T>();
  const getCurrentValue = (key: string) => {
    const cacheValue = valueCache.get(key);
    if (cacheValue) {
      return cacheValue;
    }
    return typeof initialValueProp === 'function'
      ? (initialValueProp as (key: string) => T)(key)
      : initialValueProp;
  };

  /**
   * Update the value corresponding to key.  If the value is different than the
   * previous value, UI updates are triggered to dependent hooks.
   *
   * @param key The key to use
   * @param value The new value
   */
  const updateFunc = (key: string, value: T, force?: boolean) => {
    if (value === undefined) {
      valueCache.delete(key);
    } else {
      valueCache.set(key, value);
    }
    const datumSet = lookupCache.get(key);
    if (datumSet) {
      datumSet.forEach((datum) => datum[1](value, true || force));
    } else {
      // console.log(`No datum to update for ${key}`);
    }
  };

  /**
   * Request a change hook callback when the value of the specified key changes.
   * The return value is similar to react useState().
   *
   * @param key The key to monitor
   * @returns [T, (newValue:T, force?:boolean)]
   */
  const useFunc = (key: string) => {
    const useDatumMemoized = useMemo(() => {
      const initialValue = getCurrentValue(key);
      const datum = UseDatum<T>(
        initialValue,
        (current, prior) => {
          onChange?.(key, current, prior);
        },
        // { trace: key },
      );
      let datumSet = lookupCache.get(key);
      if (!datumSet) {
        datumSet = new Set<ReturnType<typeof wrapperDatum>>();
        lookupCache.set(key, datumSet);
      }

      datumSet.add(datum);
      return datum;
    }, [key]);
    useEffect(() => {
      return () => {
        const datumSet = lookupCache.get(key);
        datumSet?.delete(useDatumMemoized);
        if (datumSet?.size === 0) {
          lookupCache.delete(key);
        }
      };
    }, [key, useDatumMemoized]);

    const [val /* ,_setter */] = useDatumMemoized[0]();
    const wrappedSetFunc = (value: T) => {
      updateFunc(key, value);
    };
    return [val, wrappedSetFunc] as [typeof val, typeof wrappedSetFunc];
  };

  /**
   * Set all stored values to a specific value
   *
   * @param value The new value to apply
   */
  const clearFunc = (value: T): void => {
    for (const key of valueCache.keys()) {
      valueCache.set(key, value);
    }
    lookupCache.forEach((datumSet) =>
      datumSet.forEach((datum) => datum[1](value)),
    );
  };

  /**
   * Produce an array of keys being actively used for callbacks
   *
   * @returns An array of keys in use
   */
  const getKeysFunc = () => {
    return lookupCache.keys();
  };

  const getValueByKeyFunc = (key: string) => {
    const datumSet = lookupCache.get(key);
    // All datums in a set of listeners have the same value so just use the first one.
    const first = datumSet?.values().next().value;
    const value = first?.[2]() as T;
    return value !== undefined ? value : getCurrentValue(key);
  };

  const dumpContents = () => {
    valueCache.forEach((value, key) =>
      console.log(`valueCache[${key}]=${JSON.stringify(value)}`),
    );
    lookupCache.forEach((datumSet, datumKey) =>
      datumSet.forEach((datum) =>
        // eslint-disable-next-line no-console
        console.log(`${datumKey}=${JSON.stringify(datum[2](), null, 2)}`),
      ),
    );
  };

  return [
    useFunc,
    updateFunc,
    getValueByKeyFunc,
    clearFunc,
    getKeysFunc,
    dumpContents,
  ] as [
    typeof useFunc,
    typeof updateFunc,
    typeof getValueByKeyFunc,
    typeof clearFunc,
    typeof getKeysFunc,
    typeof dumpContents,
  ];
};

export default UseKeyedDatum;
