/**
 * Convert a timestamp in milliseconds to a string formatted as HH:MM:SS.MMM
 * @param timestamp UTC timestamp in milliseconds
 * @param tzOffsetMinutes Offset added to timestamp to get desired local time
 * @returns string formmatted as HH:MM:SS.MMM
 */
export function convertTimestampToString(
  utcMillis: number,
  tzOffsetMinutes?: number
): string {
  // Use the provided tzOffsetMinutes directly if defined, otherwise, use the local timezone offset
  // Note: getTimezoneOffset() returns the offset in minutes as the difference between UTC and local time,
  // which means we add it directly to adjust the UTC time to the desired timezone.
  const offset =
    tzOffsetMinutes !== undefined
      ? tzOffsetMinutes
      : -new Date().getTimezoneOffset();
  const adjustedTime = new Date(utcMillis + offset * 60000);

  // Extract hours, minutes, seconds, and milliseconds
  const hours = adjustedTime.getUTCHours();
  const minutes = adjustedTime.getUTCMinutes();
  const seconds = adjustedTime.getUTCSeconds();
  const milliseconds = adjustedTime.getUTCMilliseconds();

  // Format the time components to ensure correct digit lengths
  const formatTimeComponent = (num: number, length: number = 2) =>
    num.toString().padStart(length, '0');

  // Construct formatted time string including milliseconds
  return `${formatTimeComponent(hours)}:${formatTimeComponent(
    minutes
  )}:${formatTimeComponent(seconds)}.${formatTimeComponent(milliseconds, 3)}`;
}

/**
 * Convert a timestamp in microseconds UTC to a local 24 hour number of microseconds
 * @param timestamp UTC timestamp in microseconds
 * @param tzOffsetMinutes Offset added to timestamp to get desired local time
 * @returns string formmatted as HH:MM:SS.MMM
 */
export function convertTimestampToLocalMicros(
  utcMicros: number,
  tzOffsetMinutes?: number
): number {
  // Use the provided tzOffsetMinutes directly if defined, otherwise, use the local timezone offset
  // Note: getTimezoneOffset() returns the offset in minutes as the difference between UTC and local time,
  // which means we add it directly to adjust the UTC time to the desired timezone.
  const offset =
    tzOffsetMinutes !== undefined
      ? tzOffsetMinutes
      : -new Date().getTimezoneOffset();
  return (utcMicros + offset * 60000000) % (1000000 * 60 * 60 * 24);
}
