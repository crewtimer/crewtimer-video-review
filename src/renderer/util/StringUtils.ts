export function extractTime(fileName: string) {
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
export const parseTimeToSeconds = (time: string): number => {
  const [hours, minutes, seconds] = time.split(':').map(parseFloat);
  const secs = hours * 3600 + minutes * 60 + seconds;
  return secs;
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
