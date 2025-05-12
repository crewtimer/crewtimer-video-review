/* eslint-disable no-unused-vars */
import { useMemo, useEffect } from 'react';
import { UseDatum } from 'react-usedatum';

// Version 1.0.9 May 7, 2025

/**
 * Generate a hook to keep track of a keyed value (usually a uuid).
 *
 * @param initialValueProp A constant or a function to query the current value based on a key
 * @returns [useFunction, setFunction, getFunction, clearFunction, getKeyListFunction]
 *
 * Usage: const [useKeyedBoolean, setKeyedBoolean, getKeyedBoolean, clearKeyedBoolean, getKeyList ] = UseKeyedDatum<boolean>( (key:string)=>mylookup(key))
 */
export const UseKeyedDatum = <T,>(
  // eslint-disable-next-line no-unused-vars
  initialValueProp: T | ((key: string) => T),
  // eslint-disable-next-line no-unused-vars
  onChange?: (key: string, current: T, prior: T) => void,
) => {
  const wrapperDatum = () => UseDatum<T>(false as unknown as T); // used for typing only
  const datumSetCache = new Map<string, Set<ReturnType<typeof wrapperDatum>>>();
  const valueCache = new Map<string, T>();
  const getCurrentValue = (key: string): T => {
    if (valueCache.has(key)) {
      return valueCache.get(key) as T;
    }
    return typeof initialValueProp === 'function'
      ? (initialValueProp as (k: string) => T)(key)
      : initialValueProp;
  };

  /**
   * Update the value corresponding to key.  If the value is different than the
   * previous value, UI updates are triggered to dependent hooks.
   *
   * @param key The key to use
   * @param value The new value
   */
  const setValueByKey = (key: string, value: T, force?: boolean) => {
    if (value === undefined) {
      valueCache.delete(key);
    } else {
      valueCache.set(key, value);
    }
    const datumSet = datumSetCache.get(key);
    if (datumSet) {
      datumSet.forEach((datum) => datum[1](value, force));
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
  const useKeyedDatum = (key: string) => {
    const useDatumMemoized = useMemo(() => {
      const initialValue = getCurrentValue(key);
      const datum = UseDatum<T>(
        initialValue,
        (current, prior) => {
          onChange?.(key, current, prior);
        },
        // { trace: key },
      );
      let datumSet = datumSetCache.get(key);
      if (!datumSet) {
        datumSet = new Set<ReturnType<typeof wrapperDatum>>();
        datumSetCache.set(key, datumSet);
      }

      datumSet.add(datum);
      return datum;
    }, [key]);
    useEffect(() => {
      return () => {
        const datumSet = datumSetCache.get(key);
        datumSet?.delete(useDatumMemoized);
        if (datumSet?.size === 0) {
          datumSetCache.delete(key);
        }
      };
    }, [key, useDatumMemoized]);

    const [val /* ,_setter */] = useDatumMemoized[0]();
    const wrappedSetFunc = (value: T) => {
      setValueByKey(key, value);
    };
    return [val, wrappedSetFunc] as [typeof val, typeof wrappedSetFunc];
  };

  /**
   * Set all stored values to a specific value
   *
   * @param value The new value to apply
   */
  const clear = (value: T): void => {
    Object.keys(valueCache).forEach((key) => {
      if (value === undefined) {
        valueCache.delete(key);
      } else {
        valueCache.set(key, value);
      }
    });
    datumSetCache.forEach((datumSet) =>
      datumSet.forEach((datum) => datum[1](value)),
    );
  };

  /**
   * Produce an array of keys being actively used for callbacks
   *
   * @returns An array of keys in use
   */
  const getKeys = () => {
    return datumSetCache.keys();
  };

  const getValueByKey = (key: string) => {
    const datumSet = datumSetCache.get(key);
    // All datums in a set of listeners have the same value so just use the first one.
    const first = datumSet?.values().next().value;
    const value = first?.[2]() as T;
    return value !== undefined ? value : getCurrentValue(key);
  };

  const dumpContents = () => {
    valueCache.forEach((value, key) =>
      // eslint-disable-next-line no-console
      console.log(`valueCache[${key}]=${JSON.stringify(value)}`),
    );
    datumSetCache.forEach((datumSet, datumKey) =>
      datumSet.forEach((datum) =>
        // eslint-disable-next-line no-console
        console.log(`${datumKey}=${JSON.stringify(datum[2](), null, 2)}`),
      ),
    );
  };

  return [
    useKeyedDatum,
    setValueByKey,
    getValueByKey,
    clear,
    getKeys,
    dumpContents,
  ] as [
    typeof useKeyedDatum,
    typeof setValueByKey,
    typeof getValueByKey,
    typeof clear,
    typeof getKeys,
    typeof dumpContents,
  ];
};

export default UseKeyedDatum;
