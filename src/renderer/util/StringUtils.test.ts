import { sanitizeFirebaseKey } from './StringUtils';

describe('sanitizeFirebaseKey', () => {
  it('replaces Firebase forbidden punctuation and path separators', () => {
    expect(sanitizeFirebaseKey('a.b#c$d[e]f/g')).toBe('a-b-c-d-e-f-g');
  });

  it('preserves colons and backslashes', () => {
    expect(sanitizeFirebaseKey('g:h\\i')).toBe('g:h\\i');
  });

  it('replaces all forbidden ASCII control characters', () => {
    const controls = Array.from({ length: 32 }, (_, i) =>
      String.fromCharCode(i),
    ).join('');
    expect(sanitizeFirebaseKey(`${controls}\u007f`)).toBe('-'.repeat(33));
  });

  it('preserves valid names, Unicode, and empty input', () => {
    expect(sanitizeFirebaseKey('ctvideo-boat_1 café 🚣')).toBe(
      'ctvideo-boat_1 café 🚣',
    );
    expect(sanitizeFirebaseKey('')).toBe('');
  });
});
