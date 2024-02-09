import Log from './Log';
import {
  getMobileID,
  getMobilePin,
  setAuthStatus,
  setMobileConfig,
  setMobileID,
  setMobilePin,
} from './UseSettings';
import { getConnectionProps } from './Util';

interface Credentials {
  mobileID: string;
  mobilePin: string;
}
export async function validateCredentials({
  mobilePin,
  mobileID,
}: Credentials) {
  if (!mobilePin || !mobileID) {
    setAuthStatus('');
    return '';
  }
  if (mobileID === 'test' && mobilePin === 'xyzzy') {
    setAuthStatus('OK');
    setMobilePin(mobilePin);
    setMobileID(mobileID);
    return 'OK';
  }

  try {
    const mobileIDTrim = mobileID.trim();
    // eslint-disable-next-line prefer-const
    let { url, regattaID } = getConnectionProps(mobileIDTrim);
    url = `${url}?regatta=${regattaID}&password=${mobilePin}&ts=${new Date().getTime()}`;
    const ping = {
      op: 'ping',
      responseOp: 'pingResult',
      uuid: 'system-ping',
    };
    const op = JSON.stringify([ping]);
    url = `${url}&list=${op}`;

    const response = await fetch(url);
    const results = await response.json();
    const { list } = results;
    if (list.error) {
      Log.info('Config', `Regatta ${regattaID}: ${list.error}`);
      setAuthStatus(list.error);
      return 'Invalid credentials';
    }
    const result = list[0];
    const { code } = result;
    if (code === 'OK') {
      Log.info('Config', `Regatta ${regattaID} validated`);
      setAuthStatus(code);
      setMobilePin(mobilePin);
      setMobileID(mobileIDTrim);
    }
    return code;
  } catch (err) {
    Log.info('Config', err.message);
    setAuthStatus(err.message);
    return err.message;
  }
}

export async function refreshAuthStatus() {
  await validateCredentials({
    mobileID: getMobileID(),
    mobilePin: getMobilePin(),
  })
    .then((result) => {
      setAuthStatus(result);
      return result;
    })
    .catch(() => {
      setAuthStatus('Error validating credentials');
      /* ignore */
    });
}

export function clearCredentials() {
  setAuthStatus('');
  setMobilePin('');
  setMobileID('');
  setMobileConfig(undefined);
}
