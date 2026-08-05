import { compareVersions } from './Version';

describe('compareVersions', () => {
  it('does not treat 1.0.39 as newer than 1.1.1', () => {
    expect(compareVersions('1.0.39', '1.1.1')).toBeLessThan(0);
  });

  it('compares multi-digit components numerically', () => {
    expect(compareVersions('1.10.0', '1.9.99')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats omitted trailing zero components as equal', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
  });

  it('does not advertise an update for malformed server data', () => {
    expect(compareVersions('not-a-version', '1.1.1')).toBe(0);
  });
});
