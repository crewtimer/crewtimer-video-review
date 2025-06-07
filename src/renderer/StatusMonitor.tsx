import { Lap } from 'crewtimer-common';
import { useEffect } from 'react';
import { UseStoredDatum } from './store/UseElectronDatum';
import { setToast } from './Toast';
import { clearEntryResults, setEntryResult } from './util/LapStorageDatum';
import {
  useInitializing,
  useMobileConfig,
  useWaypoint,
} from './util/UseSettings';
import { useClickerData } from './video/UseClickerData';
import { sendInfoMessage } from './video/VideoUtils';

const { LapStorage } = window;

const [, setLastClearTS, getLastClearTS] = UseStoredDatum('LastClearTS', 0);

const timeSort = (a: Lap, b: Lap) => {
  const t1 = a.Timestamp || 0;
  const t2 = b.Timestamp || 0;
  if (t1 < t2) {
    return -1;
  }
  if (t1 > t2) {
    return 1;
  }
  return 0;
};

export default function StatusMonitor() {
  const [mc] = useMobileConfig();
  const [initializing] = useInitializing();
  const [timingWaypoint] = useWaypoint();
  const timingLapdata = useClickerData(timingWaypoint) as Lap[];

  useEffect(() => {
    const clearTS = mc?.info.ClearTS || 0;
    const lastClearTS = getLastClearTS();
    if (lastClearTS && lastClearTS !== clearTS) {
      if (lastClearTS !== -1) {
        setToast({ severity: 'info', msg: 'Cloud reset of regatta data' });
      }
      LapStorage.truncateLapTable();
    }
    setLastClearTS(clearTS);
    clearEntryResults(undefined);
  }, [mc?.info.ClearTS]);

  useEffect(() => {
    for (const lap of [...timingLapdata].sort(timeSort)) {
      if (lap.State !== 'Deleted') {
        const key = `${lap.Gate}_${lap.EventNum}_${lap.Bow}`;
        lap.keyid = key;
        setEntryResult(key, lap);
      }
    }
  }, [timingLapdata]);

  useEffect(() => {
    // Let recorder know the current waypoint configuration periodically
    if (initializing) {
      return undefined;
    }
    sendInfoMessage();
    const timer = setInterval(() => {
      sendInfoMessage();
    }, 15000);
    return () => clearInterval(timer);
  }, [initializing]);
  return <></>;
}
