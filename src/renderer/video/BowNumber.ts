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

/** Numeric endings of an event's scheduled bows, such as 12 for A12. */
export const scheduledBowEndings = (event: BowEvent | undefined) =>
  (event?.eventItems || [])
    .map((entry) => /\d+$/.exec(entry.Bow?.trim() || '')?.[0])
    .filter((ending): ending is string => ending !== undefined);

/**
 * Keep at most cardLength trailing digits of a numeric reading, dropping a
 * spurious leading digit such as 165 for 65. With a schedule, trim only when
 * the full reading is not a scheduled bow and the trimmed one is, so a boat
 * from another event, such as 18 in an event of bows 1-3, keeps its number.
 */
export const trimToCardLength = (
  text: string,
  cardLength: BowCardLength | undefined,
  scheduledBows?: string[],
) => {
  if (cardLength === undefined || cardLength === 'auto') return text;
  if (text.length <= cardLength) return text;
  const trimmed = text.slice(-cardLength);
  if (!scheduledBows?.length) return trimmed;
  return !scheduledBows.includes(text) && scheduledBows.includes(trimmed)
    ? trimmed
    : text;
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

export type ScheduledEvent = BowEvent & {
  EventNum: string;
  Day?: string;
  RaceType?: string;
};

/**
 * The only head race on day that schedules bow, with bow as that event
 * schedules it.  Head race bows are unique across events, so a bow alone
 * identifies its event.  Sprint lane numbers repeat and never do.
 */
export const findHeadEventForBow = <T extends ScheduledEvent>(
  bow: string,
  events: T[],
  day?: string,
): { event: T; bow: string } | undefined => {
  const matches = events.flatMap((event) => {
    if (event.RaceType !== 'Head' || (day && event.Day !== day)) {
      return [];
    }
    const scheduled = normalizeBowForEvent(bow, event).trim();
    return event.eventItems?.some((entry) => entry.Bow?.trim() === scheduled)
      ? [{ event, bow: scheduled }]
      : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
};
