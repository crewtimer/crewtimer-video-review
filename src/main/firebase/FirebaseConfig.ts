import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Initialize Firebase
const config = {
  /* ACTUAL CONFIG FROM FIREBASE CONSOLE */
  apiKey: 'AIzaSyBxl61gy473Yq7KDT_838HYPnRsfZz_Y5M',
  authDomain: 'crewtimer-results.firebaseapp.com',
  databaseURL: 'https://crewtimer-results.firebaseio.com',
  projectId: 'crewtimer-results',
  storageBucket: 'crewtimer-results.appspot.com',
  messagingSenderId: '990343924949',
};

const devconfig = {
  apiKey: 'AIzaSyC7Xrxk35RL5yHQohd-NdDZ9E_natHNpB8',
  authDomain: 'crewtimer-results-dev.firebaseapp.com',
  databaseURL: 'https://crewtimer-results-dev.firebaseio.com',
  projectId: 'crewtimer-results-dev',
  storageBucket: 'crewtimer-results-dev.appspot.com',
  messagingSenderId: '64638108902',
};

const fire = initializeApp(config, 'default');
const firedev = initializeApp(devconfig, 'dev');
const database = getDatabase(fire);
const databasedev = getDatabase(firedev);

function firebasedb(mobileID: string) {
  return mobileID.startsWith('t.') || mobileID.startsWith('9')
    ? databasedev
    : database;
}
export default firebasedb;
