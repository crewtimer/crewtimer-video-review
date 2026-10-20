import { findMovedLapKeys } from './MovedLapKeys';

const laps = (entries: [string, string | undefined][]) =>
  new Map(entries.map(([key, uuid]) => [key, { Gate: 'G1', uuid }]));

describe('findMovedLapKeys', () => {
  it('reports the prior key when a hint is improved from ? to a bow', () => {
    const keyByUuid = new Map<string, string>();
    expect(findMovedLapKeys(laps([['G1_1_?', 'a']]), keyByUuid)).toEqual([]);
    expect(findMovedLapKeys(laps([['G1_1_5', 'a']]), keyByUuid)).toEqual([
      { key: 'G1_1_?', uuid: 'a' },
    ]);
  });

  it('reports nothing when the key is unchanged', () => {
    const keyByUuid = new Map<string, string>();
    findMovedLapKeys(laps([['G1_1_5', 'a']]), keyByUuid);
    expect(findMovedLapKeys(laps([['G1_1_5', 'a']]), keyByUuid)).toEqual([]);
  });

  it('keeps a prior key still used by another lap', () => {
    const keyByUuid = new Map<string, string>();
    findMovedLapKeys(laps([['G1_1_5', 'a']]), keyByUuid);
    expect(
      findMovedLapKeys(
        laps([
          ['G1_1_6', 'a'],
          ['G1_1_5', 'b'],
        ]),
        keyByUuid,
      ),
    ).toEqual([]);
  });

  it('ignores laps without a uuid', () => {
    const keyByUuid = new Map<string, string>();
    findMovedLapKeys(laps([['G1_1_?', undefined]]), keyByUuid);
    expect(findMovedLapKeys(laps([['G1_1_5', undefined]]), keyByUuid)).toEqual(
      [],
    );
  });
});
