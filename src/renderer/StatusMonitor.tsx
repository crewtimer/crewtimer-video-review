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
} from './util/UseSettings';
import { notifiyGuideChanged } from './video/VideoUtils';
const { LapStorage } = window;

const [, setLastClearTS, getLastClearTS] = UseStoredDatum('LastClearTS', 0);

export default function StatusMonitor() {
  const [mc] = useMobileConfig();
  const [mcChangeCount] = useMobileConfigCount();
  const [lynxFolderOK] = useLynxFolderOK();
  const [lynxFolder] = useLynxFolder();
  const [lapListInitCount] = useLapListInitCount();
  const [initializing] = useInitializing();
  const [enableVideo] = useEnableVideo();

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
