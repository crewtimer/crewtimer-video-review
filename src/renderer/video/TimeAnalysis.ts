import { timeToMilli } from 'renderer/util/Util';

/** Background colors matching the admin app's adjust results thresholds. */
export const TIME_ANALYSIS_COLORS = {
  good: '#b9f6ca',
  warn: '#fff59d',
  bad: '#ffab91',
} as const;

/**
 * Color for how closely a scored time matches a hint time.
 * Green below 700ms, yellow below 1200ms, red otherwise.
 */
export const timeAnalysisColor = (scoredTime: string, hintTime: string) => {
  const delta = Math.abs(timeToMilli(scoredTime) - timeToMilli(hintTime));
  if (delta < 700) {
    return TIME_ANALYSIS_COLORS.good;
  }
  if (delta < 1200) {
    return TIME_ANALYSIS_COLORS.warn;
  }
  return TIME_ANALYSIS_COLORS.bad;
};
