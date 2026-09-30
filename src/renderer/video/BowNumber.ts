export type BowEvent = {
  eventItems?: Array<{ Bow?: string }>;
};

export type BowCardLength = 'auto' | 1 | 2 | 3;

/** Resolve auto to the numeric-ending width used by a one- or two-digit event. */
export const cardLengthForEvent = (
  cardLength: BowCardLength,
  event: BowEvent | undefined,
): BowCardLength => {
  if (cardLength !== 'auto') return cardLength;

  const endingLengths = (event?.eventItems || [])
    .map((entry) => /\d+$/.exec(entry.Bow?.trim() || '')?.[0].length)
    .filter((length): length is number => length !== undefined);
  if (endingLengths.length === 0) return 'auto';

  const maxLength = Math.max(...endingLengths);
  return maxLength === 1 || maxLength === 2 ? maxLength : 'auto';
};

/** Add an event's unambiguous single-letter prefix to a digits-only bow. */
export const normalizeBowForEvent = (
  bow: string,
  event: BowEvent | undefined,
) => {
  const value = bow.trim();
  if (!/^\d+$/.test(value) || !event?.eventItems?.length) {
    return bow;
  }

  const scheduledBows = event.eventItems
    .map((entry) => entry.Bow?.trim())
    .filter((scheduled): scheduled is string => Boolean(scheduled));
  if (scheduledBows.includes(value)) {
    return value;
  }

  const prefixes = new Set(
    scheduledBows
      .map((scheduled) => /^([A-Za-z])\d+$/.exec(scheduled)?.[1])
      .filter((prefix): prefix is string => Boolean(prefix)),
  );
  return prefixes.size === 1 ? `${[...prefixes][0]}${value}` : value;
};
