import {
  cardLengthForEvent,
  findHeadEventForBow,
  normalizeBowForEvent,
  scheduledBowEndings,
  trimToCardLength,
} from './BowNumber';

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

describe('findHeadEventForBow', () => {
  const head = (EventNum: string, bows: string[], Day = 'Sat') => ({
    EventNum,
    Day,
    RaceType: 'Head',
    eventItems: bows.map((Bow) => ({ Bow })),
  });

  test('finds the only head race scheduling the bow', () => {
    const events = [head('1', ['1', '2']), head('2', ['3', '4'])];
    expect(findHeadEventForBow('4', events, 'Sat')).toEqual({
      event: events[1],
      bow: '4',
    });
  });

  test('returns the bow as the matching event schedules it', () => {
    const events = [head('1', ['1', '2']), head('2', ['A3', 'A4'])];
    expect(findHeadEventForBow('3', events)?.bow).toBe('A3');
  });

  test('ignores sprint races, whose lane numbers repeat', () => {
    const sprint = { ...head('1', ['1', '2', '7']), RaceType: 'Sprint' };
    expect(findHeadEventForBow('7', [sprint])).toBeUndefined();
  });

  test('ignores events on other days', () => {
    const events = [head('1', ['1']), head('2', ['1'], 'Sun')];
    expect(findHeadEventForBow('1', events, 'Sat')?.event.EventNum).toBe('1');
  });

  test('returns nothing when the bow is ambiguous or unscheduled', () => {
    const events = [head('1', ['1', '2']), head('2', ['2', '3'])];
    expect(findHeadEventForBow('2', events)).toBeUndefined();
    expect(findHeadEventForBow('9', events)).toBeUndefined();
  });
});

describe('trimToCardLength', () => {
  test('keeps a two-digit reading that trims to an unscheduled bow', () => {
    expect(trimToCardLength('18', 1, ['1', '2', '3'])).toBe('18');
  });

  test('trims a spurious leading digit to a scheduled bow', () => {
    expect(trimToCardLength('165', 2, ['12', '65'])).toBe('65');
  });

  test('keeps a full reading that is itself scheduled', () => {
    expect(trimToCardLength('18', 1, ['8', '18'])).toBe('18');
  });

  test('trims without a schedule', () => {
    expect(trimToCardLength('18', 1, [])).toBe('8');
    expect(trimToCardLength('18', 1)).toBe('8');
  });

  test('leaves auto and short readings alone', () => {
    expect(trimToCardLength('165', 'auto', ['65'])).toBe('165');
    expect(trimToCardLength('8', 2, ['8'])).toBe('8');
  });
});

describe('scheduledBowEndings', () => {
  test('returns numeric endings of scheduled bows', () => {
    const event = { eventItems: [{ Bow: 'A12' }, { Bow: '7' }, { Bow: 'X' }] };
    expect(scheduledBowEndings(event)).toEqual(['12', '7']);
  });
});
