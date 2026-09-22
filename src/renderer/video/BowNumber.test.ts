import { normalizeBowForEvent } from './BowNumber';

describe('normalizeBowForEvent', () => {
  test('adds the current event prefix to a numeric bow', () => {
    const event = { eventItems: [{ Bow: 'A1' }, { Bow: 'A2' }] };
    expect(normalizeBowForEvent('2', event)).toBe('A2');
  });

  test('keeps a numeric bow when it is explicitly scheduled', () => {
    const event = { eventItems: [{ Bow: '1' }, { Bow: 'A2' }] };
    expect(normalizeBowForEvent('1', event)).toBe('1');
  });

  test('does not alter an existing prefix', () => {
    const event = { eventItems: [{ Bow: 'A1' }] };
    expect(normalizeBowForEvent('A1', event)).toBe('A1');
  });

  test('leaves a numeric bow unchanged when prefixes are ambiguous', () => {
    const event = { eventItems: [{ Bow: 'A1' }, { Bow: 'B2' }] };
    expect(normalizeBowForEvent('2', event)).toBe('2');
  });
});
