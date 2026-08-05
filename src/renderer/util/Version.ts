const numericVersionParts = (version: string): number[] | undefined => {
  const normalized = version.trim().replace(/^v/i, '').split('-', 1)[0];
  const parts = normalized.split('.');
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }
  return parts.map(Number);
};

/**
 * Compare dotted numeric versions without assuming a fixed number of digits
 * in any component. Pre-release suffixes are ignored for update notifications.
 */
export const compareVersions = (left: string, right: string): number => {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  if (!leftParts || !rightParts) {
    return 0;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
};
