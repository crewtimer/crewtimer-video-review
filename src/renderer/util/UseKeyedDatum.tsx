import { useMemo, useEffect } from 'react';
import { UseDatum } from 'react-usedatum';

/**
 * Generate a hook to keep track of a keyed value (usually a uuid).
 *
 * @param getInitialValue A function to query the current value based on a key
 * @returns [useFunction, setFunction, clearFunction, getKeyListFunction]
 *
 * Usage: const [useKeyedBoolean, setKeyedBoolean, clearKeyedBoolean, getKeyList ] = UseKeyedDatum<boolean>( (key:string)=>mylookup(key))
 */
export const UseKeyedDatum = <T,>(getInitialValue: (key: string) => T) => {
  const wrapperDatum = () => UseDatum<T>(false as unknown as T); // used for typing only
  const lookupCache = new Map<string, Set<ReturnType<typeof wrapperDatum>>>();

  /**
   * Request a change hook callback when the value of the specified key changes.
   * The return value is similar to react useState().
   *
   * @param key The key to monitor
   * @returns [T, (newValue:T, force?:boolean)]
   */
  const useFunc = (key: string) => {
    const _useDatum = useMemo(() => {
      const initialValue = getInitialValue(key);
      const datum = UseDatum<T>(initialValue);
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
        datumSet?.delete(_useDatum);
        if (datumSet?.size === 0) {
          lookupCache.delete(key);
        }
      };
    }, [key, _useDatum]);
    return _useDatum[0]();
  };

  /**
   * Update the value corresponding to key.  If the value is different than the
   * previous value, UI updates are triggered to dependent hooks.
   *
   * @param key The key to use
   * @param value The new value
   * @param force
   */
  const updateFunc = (key: string, value: T, force?: boolean) => {
    const datumSet = lookupCache.get(key);
    if (datumSet) {
      for (const datum of datumSet) {
        // console.log(`Setting ${key}(${datum[2]()})=${value}`);
        datum[1](value, force);
      }
    } else {
      // console.log(`No datum to update for ${key}`);
    }
  };

  /**
   * Set all stored values to a specific value
   *
   * @param value The new value to apply
   */
  const clearFunc = (value: T): void => {
    for (const [, datumSet] of lookupCache) {
      for (const datum of datumSet) {
        datum[1](value);
      }
    }
  };

  /**
   * Produce an array of keys being actively used for callbacks
   *
   * @returns An array of keys in use
   */
  const getKeysFunc = () => {
    return lookupCache.keys();
  };

  const dumpContents = () => {
    for (const [datumKey, datumSet] of lookupCache) {
      for (const datum of datumSet) {
        console.log(`${datumKey}=${JSON.stringify(datum[2](), null, 2)}`);
      }
    }
  };

  return [useFunc, updateFunc, clearFunc, getKeysFunc, dumpContents] as [
    typeof useFunc,
    typeof updateFunc,
    typeof clearFunc,
    typeof getKeysFunc,
    typeof dumpContents
  ];
};
