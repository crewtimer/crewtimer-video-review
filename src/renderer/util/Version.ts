type ParsedVersion = { numbers: number[]; prerelease: string[] };

const parseVersion = (version: string): ParsedVersion | undefined => {
  const normalized = version.trim().replace(/^v/i, '').split('+', 1)[0];
  const dash = normalized.indexOf('-');
  const core = dash < 0 ? normalized : normalized.slice(0, dash);
  const parts = core.split('.');
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }
  const prerelease =
    dash < 0
      ? []
      : normalized
          .slice(dash + 1)
          .split('.')
          .filter(Boolean);
  return { numbers: parts.map(Number), prerelease };
};

/** Semver pre-release precedence: numeric ids compare numerically and sort
 * before alphanumeric ids; a longer list wins when all shared ids match. */
const comparePrerelease = (left: string[], right: string[]): number => {
  // A release outranks any pre-release of the same version.
  if (left.length === 0 || right.length === 0) {
    return Math.sign(right.length - left.length);
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) {
      return a === undefined ? -1 : 1;
    }
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) {
        return Math.sign(difference);
      }
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
};

/**
 * Compare dotted numeric versions without assuming a fixed number of digits
 * in any component. A pre-release such as 2.0.9-beta.1 is older than 2.0.9,
 * so beta installs are offered the official release once it ships.
 */
export const compareVersions = (left: string, right: string): number => {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) {
    return 0;
  }

  const leftParts = leftVersion.numbers;
  const rightParts = rightVersion.numbers;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
};
