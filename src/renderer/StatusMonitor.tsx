import { Lap } from 'crewtimer-common';
import { useEffect } from 'react';
import { UseStoredDatum } from './store/UseElectronDatum';
import { setToast } from './Toast';
import {
  clearEntryResults,
  getLaps,
  setEntryResult,
  useLapListInitCount,
} from './util/LapStorageDatum';
import {
  useEnableVideo,
  useInitializing,
  useLynxFolder,
  useLynxFolderOK,
  useMobileConfig,
  useMobileConfigCount,
  useWaypoint,
} from './util/UseSettings';
import { useClickerData } from './video/UseClickerData';
import { notifiyGuideChanged } from './video/VideoUtils';
const { LapStorage } = window;

const [, setLastClearTS, getLastClearTS] = UseStoredDatum('LastClearTS', 0);

const timeSort = (a: Lap, b: Lap) => {
  let t1 = a.Timestamp || 0;
  let t2 = b.Timestamp || 0;
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
  const [mcChangeCount] = useMobileConfigCount();
  const [lynxFolderOK] = useLynxFolderOK();
  const [lynxFolder] = useLynxFolder();
  const [lapListInitCount] = useLapListInitCount();
  const [initializing] = useInitializing();
  const [enableVideo] = useEnableVideo();
  const [timingWaypoint] = useWaypoint();
  const timingLapdata = useClickerData(timingWaypoint) as Lap[];

  useEffect(() => {
    if (lynxFolderOK && mc) {
      window.FinishLynx.generateEvtFiles();
    }
  }, [lynxFolder, lynxFolderOK, mc, mcChangeCount]);

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
  }, [mc?.info.ClearTS || 0]);

  useEffect(() => {
    const laps = getLaps();
    clearEntryResults(undefined);
    for (const lap of laps) {
      const key = `${lap.Gate}_${lap.EventNum}_${lap.Bow}`;
      lap.keyid = key;
      setEntryResult(key, lap);
    }
  }, [lapListInitCount]);

  useEffect(() => {
    timingLapdata.sort(timeSort);
    for (const lap of timingLapdata) {
      if (lap.State === 'Deleted') {
        continue;
      }
      const key = `${lap.Gate}_${lap.EventNum}_${lap.Bow}`;
      lap.keyid = key;
      setEntryResult(key, lap);
    }
  }, [timingLapdata]);

  useEffect(() => {
    // Let recorder know the current guide settings periodically
    // It's also notified if it changes
    if (initializing || !enableVideo) {
      return;
    }
    notifiyGuideChanged();
    const timer = setInterval(() => {
      notifiyGuideChanged();
    }, 60000);
    return () => clearInterval(timer);
  }, [enableVideo, initializing]);
  return <></>;
}
