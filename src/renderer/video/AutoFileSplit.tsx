import { FC, useEffect, useMemo, useRef, useCallback, useState } from 'react';
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
import { seekToTimePoint, triggerFileSplit } from './VideoUtils';
import {
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

const isScored = (lap: ExtendedLap, scoredGate: string) =>
  getEntryResult(`${scoredGate}_${lap.EventNum}_${lap.Bow}`) !== undefined;

/**
 * AutoFileSplit
 *
 * Watches the `useAutoFileSplit` datum and triggers `triggerFileSplit()`
 * when certain conditions are met.
 *
 * Behavior:
 * If futureSplits is >0 and openSplits is <=1, request one file split.
 * Do not request another automatic split until a new timing hint arrives.
 * Manual split requests do not alter the automatic request latch.
 * This component renders nothing (returns null).
 */
export const AutoFileSplit: FC = () => {
  // const [{ openSplits, futureSplits }] = useAutoFileSplit();
  const timerRef = useRef<number | undefined>(undefined);
  const splitRequestedRef = useRef(false);
  const observedHintIdsRef = useRef<Set<string>>(new Set());
  const hintsInitializedRef = useRef(false);
  const [countsReady, setCountsReady] = useState(false);
  const [lastScoredTimestamp] = useLastScoredTimestamp();
  const [scoredWaypoint] = useWaypoint();

  const [videoSettings] = useVideoSettings();
  const hintWaypoint = videoSettings?.timingHintSource || '';
  const [fileStatusList] = useFileStatusList();
  const [{ openSplits, futureSplits }] = useAutoFileSplit();
  const [entryResultsChanged] = useEntryResultsChanged();
  const [autoSeekHoldoff] = useAutoSeekHoldoff();

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      console.log('[AutoFileSplit] clearing pending request timer');
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const shouldRequestSplit = useCallback(() => {
    const { futureSplits: currentFutureSplits, openSplits: currentOpenSplits } =
      getAutoFileSplit();
    return currentFutureSplits > 0 && currentOpenSplits <= 1;
  }, []);

  const scheduleSplitIfNeeded = useCallback(() => {
    if (timerRef.current !== undefined || splitRequestedRef.current) {
      console.log('[AutoFileSplit] automatic request suppressed', {
        timerPending: timerRef.current !== undefined,
        splitRequested: splitRequestedRef.current,
        counts: getAutoFileSplit(),
      });
      return;
    }
    console.log('[AutoFileSplit] scheduling automatic request', {
      delayMilli: 1200,
      counts: getAutoFileSplit(),
    });
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      const shouldRequest = shouldRequestSplit();
      if (!shouldRequest || splitRequestedRef.current) {
        console.log('[AutoFileSplit] timer completed without requesting', {
          shouldRequest,
          splitRequested: splitRequestedRef.current,
          counts: getAutoFileSplit(),
        });
        return;
      }
      console.log('[AutoFileSplit] requesting automatic recorder split', {
        counts: getAutoFileSplit(),
      });
      triggerFileSplit('automatic');
      splitRequestedRef.current = true;
    }, 1200);
  }, [shouldRequestSplit]);

  const lastScoredSeconds = useMemo(
    () => parseTimeToSeconds(lastScoredTimestamp),
    [lastScoredTimestamp],
  );

  /**
   * Memoize lastFileStatusSeconds
   * Inputs: fileStatusList (array) — only the last entry matters
   * Output: numeric seconds of the last file end (or zero when no files exist)
   * Reason: avoids re-computing timestamp conversion on every render; used when classifying hints
   */
  const lastFileStatusSeconds = useMemo(() => {
    const lastFileStatus = fileStatusList?.[fileStatusList.length - 1];
    if (!lastFileStatus) return 0;
    return (
      convertTimestampToLocalMicros(
        lastFileStatus.endTime,
        lastFileStatus.tzOffset,
      ) / 1000000
    );
  }, [fileStatusList]);

  const lastFileIdentity = useMemo(() => {
    const lastFileStatus = fileStatusList?.[fileStatusList.length - 1];
    return lastFileStatus
      ? `${lastFileStatus.filename}:${lastFileStatus.endTime}`
      : '';
  }, [fileStatusList]);

  useEffect(() => {
    const scoredGate = gateFromWaypoint(scoredWaypoint);
    const hintGate = gateFromWaypoint(hintWaypoint);
    const lapList = getEntryResultsList() as ExtendedLap[];

    let futureCount = entryResultsChanged - entryResultsChanged; // to use the variable and avoid lint warning
    let first: ExtendedLap | undefined;
    let hintsNotScoredCount = 0;
    const hintIds = new Set<string>();
    let newHintObserved = false;
    const hintDecisions: {
      id: string;
      time: string | undefined;
      seconds: number;
      bow: string;
      event: string;
      decision: 'scored' | 'future' | 'open' | 'old';
    }[] = [];
    lapList.forEach((lap) => {
      if (lap.Gate === hintGate) {
        const hintId =
          lap.uuid ||
          lap.keyid ||
          `${lap.Gate}_${lap.EventNum}_${lap.Bow}_${lap.Time}_${lap.Timestamp}`;
        hintIds.add(hintId);
        if (!observedHintIdsRef.current.has(hintId)) {
          newHintObserved = true;
        }
        const scoredAlready = isScored(lap, scoredGate);
        if (scoredAlready) {
          hintDecisions.push({
            id: hintId,
            time: lap.Time,
            seconds: lap.seconds,
            bow: lap.Bow,
            event: lap.EventNum,
            decision: 'scored',
          });
          return;
        }
        if (lap.seconds > lastFileStatusSeconds) {
          futureCount += 1;
          hintDecisions.push({
            id: hintId,
            time: lap.Time,
            seconds: lap.seconds,
            bow: lap.Bow,
            event: lap.EventNum,
            decision: 'future',
          });
        } else if (lap.seconds > lastScoredSeconds) {
          hintsNotScoredCount += 1;
          hintDecisions.push({
            id: hintId,
            time: lap.Time,
            seconds: lap.seconds,
            bow: lap.Bow,
            event: lap.EventNum,
            decision: 'open',
          });
          if (!first || lap.seconds < first.seconds) {
            first = lap;
          }
        } else {
          hintDecisions.push({
            id: hintId,
            time: lap.Time,
            seconds: lap.seconds,
            bow: lap.Bow,
            event: lap.EventNum,
            decision: 'old',
          });
        }
      }
    });
    // Only a newly observed timing split may re-arm automatic file splitting.
    if (hintsInitializedRef.current && newHintObserved) {
      console.log(
        '[AutoFileSplit] new timing hint re-armed automatic requests',
      );
      splitRequestedRef.current = false;
    }
    observedHintIdsRef.current = hintIds;
    hintsInitializedRef.current = true;
    const firstSeconds = first?.seconds || 0;

    console.log('[AutoFileSplit] classified timing hints', {
      fileCount: fileStatusList?.length || 0,
      lastFileIdentity,
      lastFileStatusSeconds,
      lastScoredTimestamp,
      lastScoredSeconds,
      scoredGate,
      hintGate,
      hintsInitialized: hintsInitializedRef.current,
      newHintObserved,
      splitRequested: splitRequestedRef.current,
      futureSplits: futureCount,
      openSplits: hintsNotScoredCount,
      hints: hintDecisions,
    });

    // Update counts
    setAutoFileSplit((prev) => ({
      ...prev,
      futureSplits: futureCount,
      openSplits: hintsNotScoredCount,
      firstHintSeconds: firstSeconds,
    }));
    setCountsReady(true);
  }, [
    entryResultsChanged,
    fileStatusList,
    hintWaypoint,
    lastFileIdentity,
    lastFileStatusSeconds,
    lastScoredTimestamp,
    lastScoredSeconds,
    scoredWaypoint,
  ]);

  useEffect(() => {
    console.log('[AutoFileSplit] evaluating automatic request', {
      countsReady,
      futureSplits,
      openSplits,
      splitRequested: splitRequestedRef.current,
      timerPending: timerRef.current !== undefined,
      lastFileIdentity,
    });
    if (!countsReady) {
      clearPendingTimer();
      return;
    }

    if (futureSplits === 0 || openSplits > 1) {
      clearPendingTimer();
      return;
    }
    if (futureSplits > 0 && openSplits <= 1) {
      scheduleSplitIfNeeded();
    }
  }, [
    openSplits,
    futureSplits,
    countsReady,
    lastFileIdentity,
    clearPendingTimer,
    scheduleSplitIfNeeded,
  ]);

  useEffect(() => {
    if (openSplits >= 1 && !autoSeekHoldoff) {
      const ts = getVideoTimestamp();
      const tsSecs = parseTimeToSeconds(ts);
      if (tsSecs >= lastScoredSeconds - 0.1) {
        const scoredGate = gateFromWaypoint(scoredWaypoint);
        const hintGate = gateFromWaypoint(hintWaypoint);
        const nextHint = (getEntryResultsList() as ExtendedLap[])
          .filter((lap) => {
            return (
              lap.Gate === hintGate &&
              !isScored(lap, scoredGate) &&
              lap.seconds > lastScoredSeconds &&
              lap.seconds >= tsSecs &&
              lap.seconds <= lastFileStatusSeconds
            );
          })
          .sort((a, b) => a.seconds - b.seconds)[0];

        if (nextHint && seekToTimePoint(nextHint)) {
          // Do not seek again until this click has been scored.
          setAutoSeekHoldoff(true);
        }
      }
    }
  }, [
    autoSeekHoldoff,
    openSplits,
    lastScoredSeconds,
    lastFileStatusSeconds,
    lastFileIdentity,
    scoredWaypoint,
    hintWaypoint,
    entryResultsChanged,
  ]);

  // Ensure any pending timer is cleared on unmount
  useEffect(() => {
    return clearPendingTimer;
  }, [clearPendingTimer]);

  return null;
};
