/**
 * Extracts a time string in HH:MM:SS format from a given file name.
 *
 * Strips path and special characters, searches for a 6-digit sequence at the end of the file name,
 * and formats it as a time string. Returns '00:00:00' if no valid time is found.
 *
 * @param fileName - The name of the file to extract the time from.
 * @returns The extracted time in HH:MM:SS format, or '00:00:00' if not found.
 */
export function extractTime(fileName: string) {
  if (!fileName) {
    return '00:00:00';
  }
  let name = fileName.replace(/[:\-_]/g, '').replace(/.*\//, ''); // strip path
  const lastIndex = name.lastIndexOf('.');

  // If a period is found, return the substring after it
  if (lastIndex > -1) {
    name = name.substring(0, lastIndex);
  }

  // Last 6 chars should be HHMMSS
  const match = name.match(/(\d{6})$/);
  if (match) {
    // Extract the last 6 characters from the string
    const timeStr = name.slice(-6);
    // Insert colons to format as HH:MM:SS
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(
      4,
      6,
    )}`;
  }
  return '00:00:00';
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
