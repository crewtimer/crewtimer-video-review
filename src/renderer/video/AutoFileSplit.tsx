import { FC, useEffect, useMemo, useRef, useCallback } from 'react';
import { UseDatum } from 'react-usedatum';
import { parseTimeToSeconds } from 'renderer/util/StringUtils';
import { convertTimestampToLocalMicros } from 'renderer/shared/Util';
import { useWaypoint } from 'renderer/util/UseSettings';
import { seekToNextTimePoint, triggerFileSplit } from './VideoUtils';
import {
  getVideoBow,
  getVideoTimestamp,
  useLastScoredTimestamp,
} from './VideoSettings';
import { ExtendedLap, useClickerData } from './UseClickerData';
import { useFileStatusList } from './VideoFileStatus';

export interface SplitStatus {
  openSplits: number;
  futureSplits: number;
}

export const [useAutoFileSplit, setAutoFileSplit, getAutoFileSplit] =
  UseDatum<SplitStatus>({
    openSplits: 0,
    futureSplits: 0,
  });

export const [useAutoSeekHoldoff, setAutoSeekHoldoff, getAutoSeekHoldoff] =
  UseDatum(false);

/**
 * AutoFileSplit
 *
 * Watches the `useAutoFileSplit` datum and triggers `triggerFileSplit()`
 * when certain conditions are met.
 *
 * Behavior:
 * If futureSplits transitions from 0 to >0 and openSplits is <=1 -> schedule a split in 1s.
 * If futureSplits transitions to 0 -> cancel any pending split timer.
 * If openSplits transitions to >1 -> cancel any pending split timer.
 * If openSplits transitions from >1 to <=1 and openSpilts >=1 -> schedule a split in 1s.
 * This component renders nothing (returns null).
 */
export const AutoFileSplit: FC = () => {
  // const [{ openSplits, futureSplits }] = useAutoFileSplit();
  const timerRef = useRef<number | undefined>(undefined);
  const [lastScoredTimestamp] = useLastScoredTimestamp();
  const hintLapdata = useClickerData() as ExtendedLap[];
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as ExtendedLap[];
  const [fileStatusList] = useFileStatusList();
  const [{ openSplits, futureSplits }] = useAutoFileSplit();
  const [autoSeekHoldoff] = useAutoSeekHoldoff();
  const prevOpenRef = useRef<number>(openSplits);
  const prevFutureRef = useRef<number>(futureSplits);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);
  const lastScoredSeconds = useMemo(
    () => parseTimeToSeconds(lastScoredTimestamp),
    [lastScoredTimestamp],
  );
  /**
   * Memoize lastScoredSeconds
   * Inputs: lastScoredTimestamp string from datum
   * Output: number seconds parsed from timestamp
   * Reason: parsing is cheap but stable — memoize so downstream memos depend on a stable value
   */
  const lastFileStatusSeconds = useMemo(() => {
    const lastFileStatus = fileStatusList?.[fileStatusList.length - 1];
    if (!lastFileStatus) return Infinity;
    return (
      convertTimestampToLocalMicros(
        lastFileStatus.endTime,
        lastFileStatus.tzOffset,
      ) / 1000000
    );
  }, [fileStatusList]);

  /**
   * Memoize lastFileStatusSeconds
   * Inputs: fileStatusList (array) — only the last entry matters
   * Output: numeric seconds of the last file end (or Infinity)
   * Reason: avoids re-computing timestamp conversion on every render; used when classifying hints
   */

  const { hintsSet, futureSplitsSum, firstHintSeconds } = useMemo(() => {
    let future = 0;
    let first: ExtendedLap | undefined;
    const hints = new Set<string>();
    for (const lap of hintLapdata) {
      if (lap.seconds > lastFileStatusSeconds) {
        future += 1;
      } else if (lap.seconds > lastScoredSeconds) {
        if (!first) {
          first = lap;
        }
        hints.add(`${lap.EventNum}-${lap.Bow}`);
      }
    }
    const firstSeconds = parseTimeToSeconds(first?.Time);
    return {
      hintsSet: hints,
      futureSplitsSum: future,
      firstHintSeconds: firstSeconds,
    };
  }, [hintLapdata, lastFileStatusSeconds, lastScoredSeconds]);

  /**
   * Compute hintsSet and futureSplitsSum
   * Inputs: hintLapdata array, lastFileStatusSeconds, lastScoredSeconds
   * Outputs: hintsSet (Set of lap keys that are hints since last scored but before file end),
   *          futureSplitsSum (count of hints after last file end)
   * Reason: Single pass over hintLapdata to classify entries; memoized because hintLapdata is large
   */

  const scoredSet = useMemo(() => {
    const scored = new Set<string>();
    for (const lap of scoredLapdata) {
      if (lap.seconds > lastScoredSeconds) {
        scored.add(`${lap.EventNum}-${lap.Bow}`);
      }
    }
    return scored;
  }, [scoredLapdata, lastScoredSeconds]);

  /**
   * Compute scoredSet
   * Inputs: scoredLapdata, lastScoredSeconds
   * Output: Set of lap keys that are scored after lastScoredSeconds
   * Reason: memoized to avoid re-scanning scoredLapdata on unrelated renders
   */

  const hintsNotInScoredCount = useMemo(() => {
    let c = 0;
    for (const k of hintsSet) if (!scoredSet.has(k)) c += 1;
    return c;
  }, [hintsSet, scoredSet]);

  /**
   * Push derived counts into the shared datum
   * Inputs: futureSplitsSum, hintsNotInScoredCount
   * Effect: writes computed counts to the `useAutoFileSplit` datum. react-usedatum will
   *         deep-compare and avoid notifying subscribers if nothing changed.
   * Reason: keep the shared datum in sync with computed values from lap arrays.
   */
  useEffect(() => {
    setAutoFileSplit((prev) => ({
      ...prev,
      futureSplits: futureSplitsSum,
      openSplits: hintsNotInScoredCount,
    }));
  }, [futureSplitsSum, hintsNotInScoredCount]);

  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    const prevFuture = prevFutureRef.current;

    // If futureSplits transitioned to 0, cancel any pending timer
    if (futureSplits === 0 && prevFuture !== 0) {
      clearPendingTimer();
    }

    // If openSplits transitioned to >1, cancel any pending timer
    if (openSplits > 1 && prevOpen <= 1) {
      clearPendingTimer();
    }

    const scheduleIfNeeded = () => {
      if (timerRef.current === undefined) {
        // schedule a file split in 1 second
        timerRef.current = window.setTimeout(() => {
          timerRef.current = undefined;
          triggerFileSplit();
        }, 1000);
      }
    };

    // If futureSplits transitioned from 0 to >0 and openSplits is <= 1 -> schedule
    if (prevFuture === 0 && futureSplits > 0 && openSplits <= 1) {
      scheduleIfNeeded();
    }

    // If openSplits transitioned from >1 to <=1 and there is at least one open split, schedule
    if (
      prevOpen > 1 &&
      openSplits <= 1 &&
      openSplits >= 1 &&
      futureSplits > 0
    ) {
      scheduleIfNeeded();
    }

    // Update previous values for next transition
    prevOpenRef.current = openSplits;
    prevFutureRef.current = futureSplits;
  }, [openSplits, futureSplits, clearPendingTimer]);

  useEffect(() => {
    if (openSplits >= 1 && !autoSeekHoldoff) {
      // If current timestamp is before the first hint and after or at lastScored, seek to the next time point
      const ts = getVideoTimestamp();
      const tsSecs = parseTimeToSeconds(ts);
      if (tsSecs >= lastScoredSeconds - 0.1 && tsSecs < firstHintSeconds) {
        const bow = getVideoBow();
        setAutoSeekHoldoff(true); // no more auto seeks until an add split is done
        seekToNextTimePoint({ time: ts, bow });
      }
    }
  }, [autoSeekHoldoff, openSplits, firstHintSeconds, lastScoredSeconds]);

  /**
   * Scheduling effect for automatic file-splitting
   * Inputs (read from datum): openSplits, futureSplits
   * Behavior: schedule or cancel a 1s timer to call triggerFileSplit() based on
   *           transitions between previous and current open/future counts.
   * Reason: run on transitions only; uses refs to detect previous values and to
   *         store the timer id. No heavy computation here.
   */

  // Ensure any pending timer is cleared on unmount
  useEffect(() => {
    return clearPendingTimer;
  }, [clearPendingTimer]);

  return null;
};
