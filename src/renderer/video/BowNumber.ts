export type BowEvent = {
  eventItems?: Array<{ Bow?: string }>;
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
