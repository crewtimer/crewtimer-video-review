/** A recorder file name's collision suffix, as in CT_20261105_162436_2.mp4.
 * The time before it must be HHMMSS or use ':' or '-' between its fields, so
 * the seconds of a name like CT_20261105_16_24_36 are not read as a suffix. */
const COLLISION_SUFFIX = /(^|\D)(\d{6}|\d{2}([:-])\d{2}\3\d{2})_(\d{1,3})$/;

/** A file name without its path or extension. */
const baseName = (fileName: string) =>
  fileName.replace(/.*[\\/]/, '').replace(/\.[^.]*$/, '');

/**
 * Extracts a time string in HH:MM:SS format from a given file name.
 *
 * Strips the path, extension and any collision suffix (the _2 in
 * CT_20261105_162436_2.mp4), then reads the 6 digits at the end of the name
 * as HHMMSS, allowing ':', '-' or '_' between them. Returns '00:00:00' if no
 * valid time is found.
 *
 * @param fileName - The name of the file to extract the time from.
 * @returns The extracted time in HH:MM:SS format, or '00:00:00' if not found.
 */
export function extractTime(fileName: string) {
  if (!fileName) {
    return '00:00:00';
  }
  const name = baseName(fileName)
    .replace(COLLISION_SUFFIX, '$1$2')
    .replace(/[:\-_]/g, '');
  const match = name.match(/(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    return `${match[1]}:${match[2]}:${match[3]}`;
  }
  return '00:00:00';
}

/**
 * The recorder adds _2, _3, ... to a file name when a file with that name
 * already exists, which happens when it splits more than once in the same
 * second. Returns that number, or 1 for a name without one, so files with the
 * same time sort in recording order.
 */
export function extractCollisionIndex(fileName: string) {
  const match = baseName(fileName || '').match(COLLISION_SUFFIX);
  return match ? Number(match[4]) : 1;
}

/**
 * Parses a time string in HH:MM:SS.sss format to seconds.
 * @param time - A string representing time in HH:MM:SS.sss format.
 * @returns The time converted to seconds.
 */
export const parseTimeToSeconds = (time: string | undefined): number => {
  if (!time) {
    return 0;
  }
  const [hours, minutes, seconds] = time.split(':').map(parseFloat);
  const secs = hours * 3600 + minutes * 60 + seconds;
  return secs;
};

/**
 * Parses a typed time of day such as '14:23:22.123' or '142322.123' into
 * 'HH:MM:SS.sss'. Seconds and the fraction may be omitted.  Returns undefined
 * when the text is not a valid time.
 */
export const parseTypedTime = (text: string): string | undefined => {
  const match =
    text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/) ||
    text.trim().match(/^(\d{1,2})(\d{2})(\d{2})(?:\.(\d+))?$/);
  if (!match) {
    return undefined;
  }
  const [, hours, minutes, seconds = '00', fraction = ''] = match;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
    return undefined;
  }
  return `${hours.padStart(2, '0')}:${minutes}:${seconds}.${fraction
    .padEnd(3, '0')
    .slice(0, 3)}`;
};

export function formatSecondsAsTime(secondsInput: number): string {
  const hours = Math.floor(secondsInput / 3600);
  const minutes = Math.floor((secondsInput % 3600) / 60);
  const seconds = secondsInput % 60;

  const paddedHours = hours.toString().padStart(2, '0');
  const paddedMinutes = minutes.toString().padStart(2, '0');
  const paddedSeconds = seconds.toString().padStart(2, '0');

  return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
}

/** Replace Firebase key-invalid characters and path separators with hyphens. */
export function sanitizeFirebaseKey(s: string) {
  // Firebase keys cannot contain . # $ [ ] / or ASCII control characters (0-31, 127)
  // eslint-disable-next-line no-control-regex
  return s.replace(/[.#$[\]/\x00-\x1f\x7f]/g, '-');
}

/**
 * Label for an event as 'E{num} {name}', omitting the 'E{num}' prefix when the
 * name already starts with the event number (e.g. '12 Men's 8+').
 */
export function eventLabel(eventNum: string, eventName = '') {
  const name = eventName.trim();
  const rest = name.slice(eventNum.length);
  if (eventNum && name.startsWith(eventNum) && !/^[A-Za-z0-9]/.test(rest)) {
    return name;
  }
  return `E${eventNum} ${name}`.trim();
}
