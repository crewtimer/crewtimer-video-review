type OrderedTimePoint = {
  Bow?: string;
  EventNum?: string;
  seconds: number;
  uuid?: string;
};

/**
 * Find the item after the current hint. UUID identifies the current item even
 * when its detected bow was corrected to the same bow as the following hint.
 */
export const findNextTimePoint = <T extends OrderedTimePoint>(
  timePoints: T[],
  from: {
    seconds: number;
    bow: string;
    event?: string;
    uuid?: string;
    skipHintAtOrAfterTime?: boolean;
  },
): T | undefined => {
  const uuidIndex = from.uuid
    ? timePoints.findIndex(({ uuid }) => uuid === from.uuid)
    : -1;

  let nextIndex: number;
  if (uuidIndex >= 0) {
    nextIndex = uuidIndex + 1;
  } else if (from.skipHintAtOrAfterTime) {
    const candidates = timePoints
      .map((timePoint, index) => ({ timePoint, index }))
      .filter(
        ({ timePoint }) =>
          timePoint.Bow !== '*' &&
          (!from.event || timePoint.EventNum === from.event),
      );
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    candidates.forEach(({ timePoint, index }) => {
      const distance = Math.abs(timePoint.seconds - from.seconds);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    if (nearestIndex < 0) {
      return undefined;
    }
    nextIndex = nearestIndex + 1;
  } else {
    let left = 0;
    let right = timePoints.length - 1;
    let currentIndex = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const isCandidate = timePoints[mid].seconds > from.seconds;
      if (isCandidate) {
        currentIndex = mid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    if (currentIndex < 0) {
      return undefined;
    }

    nextIndex = currentIndex;
  }

  while (nextIndex < timePoints.length && timePoints[nextIndex].Bow === '*') {
    nextIndex += 1;
  }
  return timePoints[nextIndex];
};

/** Whether a score is temporally associated with this hint in its event. */
export const isNearestHintForScore = <T extends OrderedTimePoint>(
  timePoints: T[],
  target: T,
  scoreSeconds: number,
) => {
  let nearest: T | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  timePoints.forEach((timePoint) => {
    if (
      timePoint.Bow === '*' ||
      (target.EventNum && timePoint.EventNum !== target.EventNum)
    ) {
      return;
    }
    const distance = Math.abs(timePoint.seconds - scoreSeconds);
    if (distance < nearestDistance) {
      nearest = timePoint;
      nearestDistance = distance;
    }
  });
  return nearest === target;
};

export const preferredTimeForHint = (
  hintTime: string | undefined,
  scoredLap: { Time?: string; State?: string } | undefined,
  currentTime?: string,
) =>
  scoredLap?.Time &&
  scoredLap.Time !== currentTime &&
  scoredLap.State !== 'Deleted'
    ? scoredLap.Time
    : hintTime || '00:00:00.000';
