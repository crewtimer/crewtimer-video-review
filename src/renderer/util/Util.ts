import { KeyMap } from 'crewtimer-common';

export function gateFromWaypoint(waypoint: string) {
  let gate = waypoint.replace(/^Start$/, 'S').replace(/^Finish$/, 'F');
  if (gate !== 'S' && gate !== 'F') {
    gate = `G_${gate}`;
  }
  return gate;
}

function get3digitString(i: number | string) {
  let s = String(i);
  while (s.length < 3) s = `0${s}`;
  return s;
}

function get2digitString(i: number | string) {
  let s = String(i);
  if (s.length < 2) s = `0${s}`;
  return s;
}
export function milliToString(elapsed: number, includeHours = true) {
  let value = elapsed;
  const negative = value < 0;
  if (negative) value = -value;
  value %= 1000 * 60 * 60 * 24;
  const h = Math.trunc(value / (60000 * 60));
  value -= 60000 * 60 * h;
  const m = Math.trunc(value / 60000);
  value -= 60000 * m;
  const s = Math.trunc(value / 1000);
  value -= 1000 * s;
  const frac = value;

  // Otter Island has times greater than 60 minutes
  let result = `${get2digitString(m)}:${get2digitString(s)}.${get3digitString(
    frac
  )}`;
  if (includeHours) result = `${get2digitString(h)}:${result}`;
  if (negative) result = `-${result}`;
  return result;
}
/**
 * Convert a time formatted as [[HH:]MM:]SS.MMM] to milliseconds.
 *
 * The algorithm starts from the right and multiplies the first set of
 * numbers by 1000, the 2nd set from right by 60000 and the the third by
 * 3600000. Any of the fields can be missing on the left.
 *
 * @param t
 * @return
 */
export function timeToMilli(time: string | undefined) {
  if (!time) {
    return 0;
  }
  let sign = 1;
  let t = time.trim();
  if (t.startsWith('-')) {
    sign = -1;
    t = t.substring(1);
  }
  if (t === null || t.length === 0) {
    return 0;
  }
  const times = t.split(':');
  let factor = 1000;
  let v = 0.0;
  for (let i = times.length - 1; i >= 0; i -= 1) {
    try {
      let num = Number.parseFloat(times[i]);
      if (Number.isNaN(num)) {
        num = 0;
      }
      v += factor * num;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`Bad time format: '${t}'`);
    }
    factor *= 60;
  }
  v += 0.01; // round before trunc
  return Math.trunc(v * sign);
}

export function formatTime(date: Date, milliDigits = 3) {
  const milli =
    date.getHours() * 3600000 +
    date.getMinutes() * 60000 +
    date.getSeconds() * 1000 +
    date.getMilliseconds();
  let startTimeFormatted = milliToString(milli, true);
  if (milliDigits === 0) {
    startTimeFormatted = startTimeFormatted.substring(
      0,
      startTimeFormatted.length - 4 + milliDigits
    );
  } else if (milliDigits < 3) {
    startTimeFormatted = startTimeFormatted.substring(
      0,
      startTimeFormatted.length - 3 + milliDigits
    );
  }
  return startTimeFormatted;
}
export function getConnectionProps(mobileID: string) {
  let firebaseurl = 'https://results.crewtimer.com';
  let resultbase = 'https://crewtimer.com';
  let id = mobileID;
  if (!id) {
    id = '';
  }
  if (id.indexOf('t.') === 0) {
    firebaseurl = 'https://crewtimer-results-dev.firebaseapp.com';
    id = id.substring(2);
    resultbase = 'https://dev.crewtimer.com';
  }
  const regattaID = id.replace('.', '');
  return {
    regattaID,
    url: `${firebaseurl}/util`,
    resulturl: `${resultbase}/regatta/${regattaID}`,
  };
}
export function cloneObject(obj: unknown): unknown {
  // Handle the 3 simple types, and null or undefined
  if (obj == null || typeof obj !== 'object') return obj;

  // Handle Date
  if (obj instanceof Date) {
    const copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array) {
    const copy = [];
    for (let i = 0, len = obj.length; i < len; i += 1) {
      copy[i] = cloneObject(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    const copy: KeyMap = {};
    Object.keys(obj).forEach((attr) => {
      copy[attr] = cloneObject((obj as KeyMap)[attr]);
    });
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
}

export function replaceAt(s: string, index: number, replacement: string) {
  if (s.length <= index || index < 0) {
    return s;
  }
  return (
    s.substr(0, index) + replacement + s.substr(index + replacement.length)
  );
}

export function charAt(s: string, index: number) {
  if (s.length <= index || index < 0) {
    return '';
  }
  return s.substr(index, 1);
}

export function removeCharAt(s: string, index: number) {
  if (s.length <= index || index < 0) {
    return s;
  }
  return s.substr(0, index) + s.substr(index + 1);
}

export type OnDatumChangeHandler = (name: string) => void;

const changeHandlers = new Map<string, OnDatumChangeHandler>();
export function notifyChange(name: string) {
  const handler = changeHandlers.get(name);
  if (handler) {
    handler(name);
  }
}

export const onPropertyChange = (
  name: string,
  handler: OnDatumChangeHandler
) => {
  changeHandlers.set(name, handler);
};
