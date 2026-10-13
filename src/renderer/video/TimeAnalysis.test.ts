import { TIME_ANALYSIS_COLORS, timeAnalysisColor } from './TimeAnalysis';

describe('timeAnalysisColor', () => {
  test('is green below 700ms', () => {
    expect(timeAnalysisColor('10:00:00.000', '10:00:00.699')).toBe(
      TIME_ANALYSIS_COLORS.good,
    );
  });

  test('is yellow from 700ms to below 1200ms', () => {
    expect(timeAnalysisColor('10:00:00.700', '10:00:00.000')).toBe(
      TIME_ANALYSIS_COLORS.warn,
    );
    expect(timeAnalysisColor('10:00:01.199', '10:00:00.000')).toBe(
      TIME_ANALYSIS_COLORS.warn,
    );
  });

  test('is red at 1200ms or more', () => {
    expect(timeAnalysisColor('10:00:00.000', '10:00:01.200')).toBe(
      TIME_ANALYSIS_COLORS.bad,
    );
  });
});
