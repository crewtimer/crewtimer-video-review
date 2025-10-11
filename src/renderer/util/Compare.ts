export function deepCompare(
  key0: string,
  a: any,
  b: any,
  ignoreKeys: string[] = [],
  debug = false,
) {
  if (
    typeof a === 'object' &&
    a !== null &&
    a !== undefined &&
    typeof b === 'object' &&
    b !== null &&
    b !== undefined
  ) {
    for (const key in a) {
      if (ignoreKeys.includes(key)) {
        continue;
      }
      if (!(key in b)) {
        if (a[key] === '' || a[key] === null) {
          if (debug) {
            console.log(`Key ${key0}/${key} missing in b but a is empty`);
          }
          continue;
        }
        if (debug) {
          console.log(`Key ${key0}/${key} missing in b`);
        }
        return false;
      } else if (
        !deepCompare(`${key0}/${key}`, a[key], b[key], ignoreKeys, debug)
      ) {
        return false;
      }
    }

    for (const key in b) {
      if (ignoreKeys.includes(key)) {
        continue;
      }

      if (!(key in a)) {
        if (b[key] === '' || b[key] === null) {
          if (debug) {
            console.log(`Key ${key0}/${key} missing in a but b is empty`);
          }
          continue;
        }
        if (debug) {
          console.log(`${key0}/${key} in b but not a`);
        }
        return false;
      }

      if (!deepCompare(`${key0}/${key}`, b[key], a[key], ignoreKeys, debug)) {
        return false;
      }
    }
    return true;
  } else {
    // if (a!== undefined && b === undefined) return true;
    if (a === '' && b === undefined) return true;
    if (b === '' && a === undefined) return true;
    const result = a === b;
    if (debug && result === false) {
      console.log(`${key0} diff - '${a}'!=='${b}'`);
    }
    return result;
  }
}
