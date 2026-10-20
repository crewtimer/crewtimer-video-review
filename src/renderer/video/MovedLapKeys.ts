/**
 * Find keys left behind by laps that kept their uuid but now collapse to a
 * different key, e.g. a hint improved in place from '?' to a bow number.
 * Without clearing them, the old copy lingers in the entry results as an
 * unscored hint.
 *
 * @param keyedLaps The laps of one data set, keyed as stored in entry results.
 * @param keyByUuid Each uuid's key from prior data sets.  Updated in place.
 * @returns The prior key and owning uuid for each lap whose key changed.
 */
export const findMovedLapKeys = (
  keyedLaps: Map<string, { Gate?: string; uuid?: string }>,
  keyByUuid: Map<string, string>,
): { key: string; uuid: string }[] => {
  const moved: { key: string; uuid: string }[] = [];
  keyedLaps.forEach((lap, key) => {
    if (!lap.uuid) {
      return;
    }
    const uuidKey = `${lap.Gate}_${lap.uuid}`;
    const priorKey = keyByUuid.get(uuidKey);
    if (priorKey && priorKey !== key && !keyedLaps.has(priorKey)) {
      moved.push({ key: priorKey, uuid: lap.uuid });
    }
    keyByUuid.set(uuidKey, key);
  });
  return moved;
};
