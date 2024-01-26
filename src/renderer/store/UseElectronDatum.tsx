import { IpcRendererEvent } from 'electron';
import { UseDatum } from 'react-usedatum';
import { notifyChange } from '../util/Util';

type DatumType = ReturnType<typeof UseDatum>;
const datumMap = new Map<string, DatumType>();

window.store.onStoredDatumUpdate(
  (_event: IpcRendererEvent, key: string, value: unknown) => {
    const datum = datumMap.get(key);
    if (datum) {
      datum[1](value);
    }
  }
);

window.mem.onDatumUpdate(
  (_event: IpcRendererEvent, key: string, value: unknown) => {
    const datum = datumMap.get(key);
    if (datum) {
      datum[1](value);
    }
  }
);

export function UseStoredDatum<T>(
  key: string,
  initialValue: T,
  onChange?: (current: T, prior: T) => void
) {
  const datum = UseDatum<T>(initialValue, async (newValue, priorValue) => {
    notifyChange(key);
    if (newValue === undefined) {
      await window.store.delete(key);
    } else {
      await window.store.set(key, newValue);
    }
    if (onChange) {
      onChange(newValue, priorValue);
    }
  });

  datumMap.set(key, datum as unknown as DatumType);

  // Query initial value
  setTimeout(async () => {
    const value: T = (await window.store.get(key, initialValue)) as T;
    datum[1](value);
  }, 10);
  return datum;
}

export function UseMemDatum<T>(
  key: string,
  initialValue: T,
  onChange?: (current: T, prior: T) => void
) {
  const datum = UseDatum<T>(initialValue, async (newValue, priorValue) => {
    notifyChange(key);
    if (newValue === undefined) {
      await window.mem.delete(key);
    } else {
      await window.mem.set(key, newValue);
    }
    if (onChange) {
      onChange(newValue, priorValue);
    }
  });

  datumMap.set(key, datum as unknown as DatumType);

  // Query initial value
  setTimeout(async () => {
    const value: T = (await window.mem.get(key, initialValue)) as T;
    datum[1](value);
  }, 10);
  return datum;
}
