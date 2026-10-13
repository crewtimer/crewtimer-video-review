import { Lap } from 'crewtimer-common';
import { getEntryResult, useEntryResult } from 'renderer/util/LapStorageDatum';
import { getWaypoint, useWaypoint } from 'renderer/util/UseSettings';
import { gateFromWaypoint } from 'renderer/util/Util';
import {
  getAnalyzeTimes,
  getVideoSettings,
  useAnalyzeTimes,
  useVideoSettings,
  VideoSettings,
} from './VideoSettings';
import { timeAnalysisColor } from './TimeAnalysis';

const validTime = (lap: Lap | undefined) =>
  lap && lap.State !== 'Deleted' && lap.Time ? lap.Time : undefined;

/** Hint gates to compare against, skipping any that match the scored gate. */
const hintGates = (
  scoredGate: string,
  videoSettings: VideoSettings | undefined,
) => {
  const hintGate = (hintWaypoint: string | undefined) => {
    const gate = hintWaypoint ? gateFromWaypoint(hintWaypoint) : '';
    return gate && gate !== scoredGate ? gate : '';
  };
  return {
    primaryGate: hintGate(videoSettings?.timingHintSource),
    secondaryGate: hintGate(videoSettings?.secondaryTimingHintSource),
  };
};

/**
 * Finds the hint time for an entry: the primary hint, falling back to the
 * secondary hint.
 *
 * @returns The hint time, or undefined when analysis is disabled or no hint
 * exists.
 */
export const getAnalysisHintTime = (eventNum: string, bow: string) => {
  if (!getAnalyzeTimes() || !bow) {
    return undefined;
  }
  const { primaryGate, secondaryGate } = hintGates(
    gateFromWaypoint(getWaypoint()),
    getVideoSettings(),
  );
  return (
    (primaryGate &&
      validTime(getEntryResult(`${primaryGate}_${eventNum}_${bow}`))) ||
    (secondaryGate &&
      validTime(getEntryResult(`${secondaryGate}_${eventNum}_${bow}`))) ||
    undefined
  );
};

/**
 * Compares an entry's scored time with its primary timing hint, falling back
 * to the secondary hint.
 *
 * @returns A background color, or undefined when analysis is disabled or
 * there is nothing to compare.
 */
export const useTimeAnalysisColor = (eventNum: string, bow: string) => {
  const [analyzeTimes] = useAnalyzeTimes();
  const [waypoint] = useWaypoint();
  const [videoSettings] = useVideoSettings();
  const scoredGate = gateFromWaypoint(waypoint);
  const { primaryGate, secondaryGate } = hintGates(scoredGate, videoSettings);
  const [scored] = useEntryResult(`${scoredGate}_${eventNum}_${bow}`);
  const [primary] = useEntryResult(`${primaryGate}_${eventNum}_${bow}`);
  const [secondary] = useEntryResult(`${secondaryGate}_${eventNum}_${bow}`);

  if (!analyzeTimes || !bow) {
    return undefined;
  }
  const scoredTime = validTime(scored);
  const hintTime =
    (primaryGate && validTime(primary)) ||
    (secondaryGate && validTime(secondary));
  return scoredTime && hintTime
    ? timeAnalysisColor(scoredTime, hintTime)
    : undefined;
};
