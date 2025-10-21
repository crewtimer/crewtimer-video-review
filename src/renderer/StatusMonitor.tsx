import { useEffect } from 'react';
import { UseStoredDatum } from './store/UseElectronDatum';
import { setToast } from './Toast';
import { clearEntryResults } from './util/LapStorageDatum';
import { useInitializing, useMobileConfig } from './util/UseSettings';
import { sendInfoMessage } from './video/VideoUtils';

const { LapStorage } = window;

const [, setLastClearTS, getLastClearTS] = UseStoredDatum('LastClearTS', 0);

export default function StatusMonitor() {
  const [mc] = useMobileConfig();
  const [initializing] = useInitializing();

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
