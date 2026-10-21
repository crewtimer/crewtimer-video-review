import { eventLabel, parseTypedTime, sanitizeFirebaseKey } from './StringUtils';
import { waypointFromGate } from './Util';

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

describe('eventLabel', () => {
  it('prefixes the event number when the name lacks it', () => {
    expect(eventLabel('12', "Men's 8+")).toBe("E12 Men's 8+");
  });
  it('omits the event number when the name starts with it', () => {
    expect(eventLabel('12', "12 Men's 8+")).toBe("12 Men's 8+");
    expect(eventLabel('12', "12-Men's 8+")).toBe("12-Men's 8+");
    expect(eventLabel('12', '12')).toBe('12');
  });
  it('does not treat a longer number or word as the event number', () => {
    expect(eventLabel('1', "10 Men's 8+")).toBe("E1 10 Men's 8+");
    expect(eventLabel('1A', '1AB Final')).toBe('E1A 1AB Final');
  });
  it('handles a missing name', () => {
    expect(eventLabel('12')).toBe('E12');
  });
});

describe('waypointFromGate', () => {
  it('names start, finish and intermediate gates', () => {
    expect(waypointFromGate('S')).toBe('Start');
    expect(waypointFromGate('F')).toBe('Finish');
    expect(waypointFromGate('G_500m')).toBe('500m');
    expect(waypointFromGate('Pen')).toBe('Pen');
    expect(waypointFromGate(undefined)).toBe('');
  });
});

describe('parseTypedTime', () => {
  it('accepts colon separated times', () => {
    expect(parseTypedTime('14:23:22.123')).toBe('14:23:22.123');
    expect(parseTypedTime(' 9:05:07.5 ')).toBe('09:05:07.500');
    expect(parseTypedTime('14:23')).toBe('14:23:00.000');
  });

  it('accepts digits without separators', () => {
    expect(parseTypedTime('142322.123')).toBe('14:23:22.123');
    expect(parseTypedTime('142322')).toBe('14:23:22.000');
    expect(parseTypedTime('92322.1234')).toBe('09:23:22.123');
  });

  it('rejects invalid times', () => {
    expect(parseTypedTime('')).toBeUndefined();
    expect(parseTypedTime('24:00:00')).toBeUndefined();
    expect(parseTypedTime('14:60:00')).toBeUndefined();
    expect(parseTypedTime('1423')).toBeUndefined();
    expect(parseTypedTime('14:23:22.')).toBeUndefined();
    expect(parseTypedTime('abc')).toBeUndefined();
  });
});
