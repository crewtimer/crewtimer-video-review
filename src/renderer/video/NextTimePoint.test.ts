import {
  findNextTimePoint,
  isNearestHintForScore,
  preferredTimeForHint,
} from './NextTimePoint';

const point = (Bow: string, seconds: number, uuid: string) => ({
  Bow,
  seconds,
  uuid,
});

describe('findNextTimePoint', () => {
  test('selects the item after the saved hint when the corrected bow repeats', () => {
    const hints = [point('12', 10, 'first'), point('8', 11, 'second')];

    expect(
      findNextTimePoint(hints, {
        seconds: 10,
        bow: '8',
        uuid: 'first',
      }),
    ).toBe(hints[1]);
  });

  test('allows consecutive hints with the same bow', () => {
    const hints = [point('8', 10, 'first'), point('8', 11, 'second')];

    expect(
      findNextTimePoint(hints, {
        seconds: 10,
        bow: '8',
        uuid: 'first',
      }),
    ).toBe(hints[1]);
  });

  test('allows the next repeated bow when correcting cleared the hint UUID', () => {
    const hints = [point('12', 10, 'first'), point('8', 11, 'second')];

    expect(
      findNextTimePoint(hints, {
        seconds: 10,
        bow: '8',
      }),
    ).toBe(hints[1]);
  });

  test('selects the first hint after an arbitrary slider time', () => {
    const hints = [
      point('8', 10, 'first'),
      point('12', 20, 'second'),
      point('15', 30, 'third'),
    ];

    expect(
      findNextTimePoint(hints, {
        seconds: 15,
        bow: '8',
      }),
    ).toBe(hints[1]);
  });

  test('skips the current hint when a saved time precedes its hint time', () => {
    const hints = [point('8', 20, 'current'), point('12', 30, 'next')];

    expect(
      findNextTimePoint(hints, {
        seconds: 19,
        bow: '8',
        skipHintAtOrAfterTime: true,
      }),
    ).toBe(hints[1]);
  });

  test('skips the current hint when a saved time equals its hint time', () => {
    const hints = [point('8', 20, 'current'), point('12', 30, 'next')];

    expect(
      findNextTimePoint(hints, {
        seconds: 20,
        bow: '8',
        skipHintAtOrAfterTime: true,
      }),
    ).toBe(hints[1]);
  });

  test('advances from the nearest hint when a saved time follows it', () => {
    const hints = [
      point('8', 10, 'current'),
      point('12', 20, 'next'),
      point('15', 30, 'third'),
    ];

    expect(
      findNextTimePoint(hints, {
        seconds: 11,
        bow: '8',
        skipHintAtOrAfterTime: true,
      }),
    ).toBe(hints[1]);
  });

  test('advances after correcting a nearby 12 hint to the following 8', () => {
    const hints = [
      { ...point('12', 4.683, 'current'), EventNum: '1' },
      { ...point('8', 5.923, 'next'), EventNum: '1' },
    ];

    expect(
      findNextTimePoint(hints, {
        seconds: 4.81,
        bow: '8',
        event: '1',
        skipHintAtOrAfterTime: true,
      }),
    ).toBe(hints[1]);
  });

  test('skips marker items after the current hint', () => {
    const hints = [
      point('8', 10, 'first'),
      point('*', 11, 'marker'),
      point('12', 12, 'second'),
    ];

    expect(
      findNextTimePoint(hints, {
        seconds: 10,
        bow: '8',
        uuid: 'first',
      }),
    ).toBe(hints[2]);
  });
});

describe('isNearestHintForScore', () => {
  const eventPoint = (
    Bow: string,
    seconds: number,
    uuid: string,
    EventNum = '1',
  ) => ({ Bow, seconds, uuid, EventNum });

  test('rejects an earlier corrected score for a later hint', () => {
    const hints = [
      eventPoint('12', 10, 'first'),
      eventPoint('8', 20, 'second'),
    ];

    expect(isNearestHintForScore(hints, hints[1], 9.5)).toBe(false);
  });

  test('accepts a score nearest to the candidate hint', () => {
    const hints = [
      eventPoint('12', 10, 'first'),
      eventPoint('8', 20, 'second'),
    ];

    expect(isNearestHintForScore(hints, hints[1], 19.5)).toBe(true);
  });
});

describe('preferredTimeForHint', () => {
  test('prefers an associated scored timestamp', () => {
    expect(
      preferredTimeForHint('10:00:01.000', {
        Time: '10:00:01.250',
      }),
    ).toBe('10:00:01.250');
  });

  test('uses the hint timestamp when the score was deleted', () => {
    expect(
      preferredTimeForHint('10:00:01.000', {
        Time: '10:00:01.250',
        State: 'Deleted',
      }),
    ).toBe('10:00:01.000');
  });

  test('does not reuse the time that was just scored for a repeated bow', () => {
    expect(
      preferredTimeForHint(
        '10:00:02.000',
        { Time: '10:00:01.000' },
        '10:00:01.000',
      ),
    ).toBe('10:00:02.000');
  });
});
