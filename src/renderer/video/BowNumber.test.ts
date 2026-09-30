import { cardLengthForEvent, normalizeBowForEvent } from './BowNumber';

describe('cardLengthForEvent', () => {
  test('uses one digit when all numeric endings are one digit', () => {
    const event = { eventItems: [{ Bow: 'A1' }, { Bow: 'A9' }] };
    expect(cardLengthForEvent('auto', event)).toBe(1);
  });

  test('uses two digits when the event includes a two-digit ending', () => {
    const event = { eventItems: [{ Bow: 'A1' }, { Bow: 'A12' }] };
    expect(cardLengthForEvent('auto', event)).toBe(2);
  });

  test('keeps auto for three-digit or unavailable endings', () => {
    expect(cardLengthForEvent('auto', { eventItems: [{ Bow: 'A123' }] })).toBe(
      'auto',
    );
    expect(cardLengthForEvent('auto', undefined)).toBe('auto');
  });

  test('preserves an explicitly selected card length', () => {
    const event = { eventItems: [{ Bow: 'A1' }] };
    expect(cardLengthForEvent(3, event)).toBe(3);
  });
});

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
