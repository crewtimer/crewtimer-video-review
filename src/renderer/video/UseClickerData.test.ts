import { keepLap, lapKey } from './UseClickerData';

jest.mock('renderer/util/UseFirebase', () => ({ useFirebaseDatum: jest.fn() }));
jest.mock('renderer/util/UseSettings', () => ({}));
jest.mock('renderer/util/LapStorageDatum', () => ({}));
jest.mock('renderer/util/Util', () => ({}));
jest.mock('./VideoSettings', () => ({}));

// Hints from a lapdata export: two '?' bows in event 36, one '?' event.
const first = { Gate: 'F', EventNum: '36', Bow: '?', Timestamp: 1790461474986 };
const second = {
  Gate: 'F',
  EventNum: '36',
  Bow: '?',
  Timestamp: 1790461490947,
};
const noEvent = {
  Gate: 'F',
  EventNum: '?',
  Bow: '?',
  Timestamp: 1790461502399,
};

describe('lapKey', () => {
  it('keys a hint without a bow by its timestamp, whatever its event', () => {
    expect(lapKey(first)).toBe('F_1790461474986');
    expect(lapKey(second)).toBe('F_1790461490947');
    expect(lapKey(noEvent)).toBe('F_1790461502399');
  });

  it('keys a hint with a bow by event and bow', () => {
    expect(lapKey({ ...first, Bow: '4' })).toBe('F_36_4');
  });
});

describe('keepLap', () => {
  const events = new Set(['94']);

  it('keeps a ? bow hint in an event not listed, like a ? event hint', () => {
    expect(keepLap(first, events, undefined)).toBe(true);
    expect(keepLap(noEvent, events, undefined)).toBe(true);
  });

  it('applies the day to a ? bow hint as to a ? event hint', () => {
    expect(keepLap({ ...first, Day: 'Saturday' }, events, 'Saturday')).toBe(
      true,
    );
    expect(keepLap({ ...first, Day: 'Sunday' }, events, 'Saturday')).toBe(
      false,
    );
    expect(keepLap({ ...noEvent, Day: 'Sunday' }, events, 'Saturday')).toBe(
      false,
    );
  });

  it("keeps hints in the day's events and drops numbered ones elsewhere", () => {
    expect(
      keepLap({ ...first, EventNum: '94', Day: 'Sunday' }, events, 'Saturday'),
    ).toBe(true);
    expect(keepLap({ ...first, Bow: '4' }, events, undefined)).toBe(false);
    expect(
      keepLap({ ...first, EventNum: '94', Bow: '4' }, events, undefined),
    ).toBe(true);
  });

  it('drops deleted hints', () => {
    expect(keepLap({ ...first, State: 'Deleted' }, events, undefined)).toBe(
      false,
    );
  });
});
