import { Lap } from 'crewtimer-common';
import { UseMemDatum } from '../store/UseElectronDatum';
import { LapDatumName } from '../shared/Constants';
import { UseKeyedDatum } from './UseKeyedDatum';
import { UseDatum } from 'react-usedatum';

/**
 * Hooks and accessors for the in-memory list of laps.
 *
 * - `useLaps()` returns the current array of `Lap` objects and subscribes the
 *   component to changes.
 * - `setLaps(value)` replaces the stored laps array.
 * - `getLaps()` reads the current value synchronously.
 */
export const [useLaps, setLaps, getLaps] = UseMemDatum<Lap[]>(LapDatumName, []);

/**
 * Keyed entry-result storage for individual lap entries.
 *
 * This tuple provides keyed accessors for Lap entries stored by a string key
 * (usually a synthesized key like `${gate}_${event}_${bow}`).
 *
 * - `useEntryResult(key)` is a hook that returns the Lap (or undefined) for
 *   the given key and subscribes the component to changes for that key.
 * - `setEntryResult(key, lap, publish?)` stores/updates the lap for `key`.
 * - `getEntryResult(key)` reads the stored value synchronously.
 * - `clearEntryResults()` clears all stored entry results.
 * - `getEntryResultKeys()` returns the list of keys currently stored.
 * - `dumpEntryResults()` returns a debug dump of the keyed storage.
 */
export const [
  useEntryResult,
  setEntryResult,
  getEntryResult,
  clearEntryResults,
  getEntryResultKeys,
  dumpEntryResults,
] = UseKeyedDatum<Lap | undefined>(undefined);

/**
 * A Set-based datum that tracks which Event numbers have pending updates.
 *
 * - `useEventsUpdated()` returns a `[Set<string>]` hook tuple (the Set is the
 *   collection of event keys that should be refreshed).
 * - `setEventsUpdated(newSet)` replaces the Set (used to clear processed
 *   keys or to add many keys at once).
 * - `getEventsUpdated()` reads the current Set synchronously.
 *
 * Consumers typically add an Event number to this Set when an entry changes so
 * the UI can decide to refresh only the affected Event groups.
 */
export const [useEventsUpdated, setEventsUpdated, getEventsUpdated] = UseDatum<
  Set<string>
>(new Set<string>());

/**
 * Convenience helper that marks a single event as updated.
 *
 * This creates a shallow copy of the current `eventsUpdated` Set, adds the
 * provided `eventNum`, and writes the new Set back via `setEventsUpdated` so
 * subscribers are notified.
 */
export const signalEventUpdated = (eventNum: string) => {
  const newEventsUpdated = new Set<string>(getEventsUpdated());
  newEventsUpdated.add(eventNum);
  setEventsUpdated(newEventsUpdated);
};

/**
 * Store an entry result and notify subscribers.
 *
 * This helper updates the keyed entry result, signals that the owning event
 * was updated (so UI can refresh), increments the lap's SequenceNum, and
 * delegates to the platform-specific `window.LapStorage.updateLap` to persist
 * the change.
 */
export const setEntryResultAndPublish = (key: string, lap: Lap) => {
  setEntryResult(key, lap, true);
  signalEventUpdated(lap.EventNum);
  lap.SequenceNum = (lap.SequenceNum || 0) + 1;
  window.LapStorage.updateLap(lap);
};
