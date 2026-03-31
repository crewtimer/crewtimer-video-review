import { FC, useEffect, useMemo, useRef, useCallback } from 'react';
import { UseDatum } from 'react-usedatum';
import { parseTimeToSeconds } from 'renderer/util/StringUtils';
import { convertTimestampToLocalMicros } from 'renderer/shared/Util';
import { useWaypoint } from 'renderer/util/UseSettings';
import {
  getEntryResult,
  getEntryResultsList,
  useEntryResultsChanged,
} from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import { seekToNextTimePoint, triggerFileSplit } from './VideoUtils';
import {
  getVideoBow,
  getVideoTimestamp,
  useLastScoredTimestamp,
  useVideoSettings,
} from './VideoSettings';
import { ExtendedLap } from './UseClickerData';
import { useFileStatusList } from './VideoFileStatus';

export interface SplitStatus {
  openSplits: number;
  futureSplits: number;
  firstHintSeconds: number;
}

export const [useAutoFileSplit, setAutoFileSplit, getAutoFileSplit] =
  UseDatum<SplitStatus>({
    openSplits: 0,
    futureSplits: 0,
    firstHintSeconds: 0,
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
 * If futureSplits is >0 and openSplits is <=1 -> ensure a split timer is running.
 * While those conditions remain true, retry a split every 1.2s until a new file arrives
 * or the state changes to cancel retries.
 * If futureSplits transitions to 0 -> cancel any pending split timer.
 * If openSplits transitions to >1 -> cancel any pending split timer.
 * This component renders nothing (returns null).
 */
export const AutoFileSplit: FC = () => {
  // const [{ openSplits, futureSplits }] = useAutoFileSplit();
  const timerRef = useRef<number | undefined>(undefined);
  const [lastScoredTimestamp] = useLastScoredTimestamp();
  const [scoredWaypoint] = useWaypoint();

  const [videoSettings] = useVideoSettings();
  const hintWaypoint = videoSettings?.timingHintSource || '';
  const [fileStatusList] = useFileStatusList();
  const [{ openSplits, futureSplits, firstHintSeconds }] = useAutoFileSplit();
  const [entryResultsChanged] = useEntryResultsChanged();
  const [autoSeekHoldoff] = useAutoSeekHoldoff();
  const prevOpenRef = useRef<number>(openSplits);
  const prevFutureRef = useRef<number>(futureSplits);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const shouldRetrySplit = useCallback(() => {
    const { futureSplits: currentFutureSplits, openSplits: currentOpenSplits } =
      getAutoFileSplit();
    return currentFutureSplits > 0 && currentOpenSplits <= 1;
  }, []);

  const scheduleRetryIfNeeded = useCallback(() => {
    const armTimer = () => {
      if (timerRef.current !== undefined) {
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        if (!shouldRetrySplit()) {
          return;
        }
        triggerFileSplit();
        if (shouldRetrySplit()) {
          armTimer();
        }
      }, 1200);
    };

    armTimer();
  }, [shouldRetrySplit]);

  const lastScoredSeconds = useMemo(
    () => parseTimeToSeconds(lastScoredTimestamp),
    [lastScoredTimestamp],
  );

  /**
   * Memoize lastFileStatusSeconds
   * Inputs: fileStatusList (array) — only the last entry matters
   * Output: numeric seconds of the last file end (or Infinity)
   * Reason: avoids re-computing timestamp conversion on every render; used when classifying hints
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

  useEffect(() => {
    const scoredGate = gateFromWaypoint(scoredWaypoint);
    const hintGate = gateFromWaypoint(hintWaypoint);
    const lapList = getEntryResultsList() as ExtendedLap[];

    let futureCount = entryResultsChanged - entryResultsChanged; // to use the variable and avoid lint warning
    let first: ExtendedLap | undefined;
    let hintsNotScoredCount = 0;
    lapList.forEach((lap) => {
      if (lap.Gate === hintGate) {
        const scoredKey = `${scoredGate}_${lap.EventNum}_${lap.Bow}`;
        const scoredAlready = getEntryResult(scoredKey) !== undefined;
        if (scoredAlready) {
          return;
        }
        if (lap.seconds > lastFileStatusSeconds) {
          futureCount += 1;
        } else if (lap.seconds > lastScoredSeconds) {
          hintsNotScoredCount += 1;
          if (!first) {
            first = lap;
          }
        }
      }
    });
    const firstSeconds = first?.seconds || 0;

    // Update counts
    setAutoFileSplit((prev) => ({
      ...prev,
      futureSplits: futureCount,
      openSplits: hintsNotScoredCount,
      firstHintSeconds: firstSeconds,
    }));
  }, [
    entryResultsChanged,
    hintWaypoint,
    lastFileStatusSeconds,
    lastScoredSeconds,
    scoredWaypoint,
  ]);

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

    // If future splits are present and open splits are manageable, keep retrying until the
    // state changes or a new file arrives and clears the future count.
    if (futureSplits > 0 && openSplits <= 1) {
      scheduleRetryIfNeeded();
    }

    // Update previous values for next transition
    prevOpenRef.current = openSplits;
    prevFutureRef.current = futureSplits;
  }, [openSplits, futureSplits, clearPendingTimer, scheduleRetryIfNeeded]);

  useEffect(() => {
    if (openSplits >= 1 && !autoSeekHoldoff) {
      // If current timestamp is before the first hint and after or at lastScored, seek to the next time point
      const ts = getVideoTimestamp();
      const tsSecs = parseTimeToSeconds(ts);
      if (tsSecs >= lastScoredSeconds - 0.1 && tsSecs <= firstHintSeconds) {
        const bow = getVideoBow();
        setAutoSeekHoldoff(true); // no more auto seeks until an add split is done
        seekToNextTimePoint({ time: ts, bow });
      }
    }
  }, [autoSeekHoldoff, openSplits, firstHintSeconds, lastScoredSeconds]);

  /**
   * Scheduling effect for automatic file-splitting
   * Inputs (read from datum): openSplits, futureSplits
   * Behavior: keep a 1.2s retry timer running while futureSplits > 0 and
   *           openSplits <= 1; cancel retries when those conditions no longer hold.
   * Reason: avoid getting stuck when the system still knows about future hints
   *         after a prior split request failed or was cancelled.
   */

  // Ensure any pending timer is cleared on unmount
  useEffect(() => {
    return clearPendingTimer;
  }, [clearPendingTimer]);

  return null;
};
