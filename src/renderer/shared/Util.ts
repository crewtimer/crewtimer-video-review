/**
 * Convert a timestamp in milliseconds to a string formatted as HH:MM:SS.MMM
 * @param timestamp UTC timestamp in milliseconds
 * @returns string formmatted as HH:MM:SS.MMM
 */
export function convertTimestampToString(timestamp: number): string {
  // Convert the timestamp to hours, minutes, seconds, and milliseconds
  const hours = Math.floor(
    (timestamp % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((timestamp % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timestamp % (1000 * 60)) / 1000);
  const milliseconds = timestamp % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;
}
