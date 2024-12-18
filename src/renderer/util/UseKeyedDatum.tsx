import { useEffect, useState, useRef, useReducer } from 'react';
/**
 * Generate a hook to keep track of a keyed value (usually a uuid).
 *
 * @param getCurrentValue A function to query the current value based on a key
 * @returns [useFunction, setFunction, clearFunction, getKeyListFunction]
 *
 * Usage: const [useKeyedBoolean, setKeyedBoolean, clearKeyedBoolean, getKeyList ] = UseKeyedDatum<boolean>( (key:string)=>mylookup(key))
 */
export const UseKeyedDatum = <T,>(
  getCurrentValue?: (key: string) => T | undefined,
) => {
  const valueCache = new Map<string, T | undefined>();
  const callbackCache = new Map<
    string,
    Map<number, (value: T | undefined, force?: boolean) => void>
  >();
  const idCounter = 0;

  /**
   * Update the value corresponding to key.  If the value is different than the
   * previous value, UI updates are triggered to dependent hooks.
   *
   * @param key The key to use
   * @param value The new value
   * @param force
   */
  const updateFunc = (key: string, value: T | undefined, force?: boolean) => {
    if (!key) {
      return;
    }
    const callbackMap = callbackCache.get(key);
    if (callbackMap) {
      for (const callback of callbackMap.values()) {
        callback(value, force);
      }
    }

    // Update valueCache even if no callbacks
    if (value === undefined) {
      valueCache.delete(key);
    } else {
      valueCache.set(key, value);
    }
  };

  /**
   * Request a change hook callback when the value of the specified key changes.
   * The return value is similar to react useState().
   *
   * @param key The key to monitor
   * @returns [T, (newValue:T, force?:boolean)=>void]
   */
  const useFunc = (key: string) => {
    if (!valueCache.has(key)) {
      // Is there a helper function to get the value?
      const currentValue = getCurrentValue?.(key);
      if (currentValue !== undefined) {
        valueCache.set(key, currentValue);
      }
    }
    const value = valueCache.get(key);
    const [, setValue] = useState<T | undefined>(value);
    const [, forceRender] = useReducer((s) => s + 1, 0);
    const id = useRef(0);
    if (id.current === 0) {
      id.current = idCounter + 1;
    }
    let callbackMap = callbackCache.get(key);
    if (!callbackMap) {
      callbackMap = new Map<
        number,
        (value: T | undefined, force?: boolean) => void
      >();
      callbackCache.set(key, callbackMap);
    }

    if (!callbackMap.has(id.current)) {
      callbackMap.set(id.current, (val: T | undefined, force?: boolean) => {
        if (val === undefined) {
          valueCache.delete(key);
        } else {
          valueCache.set(key, val);
        }
        setValue(val);
        if (force) {
          forceRender();
        }
      });
    }

    useEffect(() => {
      return () => {
        const map = callbackCache.get(key);
        map?.delete(id.current);
        // valueCache.delete(key); // do not delete, retain values
      };
    }, [key]);
    return [value, updateFunc] as [typeof value, typeof updateFunc];
  };

  /**
   * Set all stored values to a specific value
   *
   * @param clearValue The new value to apply
   */
  const clearFunc = (clearValue: T | undefined): void => {
    // Trigger update callbacks
    callbackCache.forEach((callbackMap) => {
      for (const callback of callbackMap.values()) {
        callback(clearValue);
      }
    });
    // Ensure valueCache is updated even if there are no callbacks
    valueCache.forEach((value, key) => {
      if (value === undefined) {
        valueCache.delete(key);
      } else {
        valueCache.set(key, value);
      }
    });
  };

  /**
   *
   * @param key The key to query
   * @returns The current value
   */
  const getFunc = (key: string) => {
    return valueCache.get(key);
  };

  /**
   * Produce an array of keys being actively used for callbacks
   *
   * @returns An array of keys in use
   */
  const getKeysFunc = () => {
    return callbackCache.keys();
  };

  const dumpContents = () => {
    console.log(JSON.stringify(valueCache, null, 2));
  };

  return [
    useFunc,
    updateFunc,
    getFunc,
    clearFunc,
    getKeysFunc,
    dumpContents,
  ] as [
    typeof useFunc,
    typeof updateFunc,
    typeof getFunc,
    typeof clearFunc,
    typeof getKeysFunc,
    typeof dumpContents,
  ];
};
