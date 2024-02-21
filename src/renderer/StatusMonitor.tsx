import { useEffect } from 'react';
import {
  clearEntryResults,
  getLaps,
  setEntryResult,
  useLapListInitCount,
} from './util/LapStorageDatum';
import {
  useLynxFolder,
  useLynxFolderOK,
  useMobileConfig,
  useMobileConfigCount,
} from './util/UseSettings';

export default function StatusMonitor() {
  const [mc] = useMobileConfig();
  const [mcChangeCount] = useMobileConfigCount();
  const [lynxFolderOK] = useLynxFolderOK();
  const [lynxFolder] = useLynxFolder();
  const [lapListInitCount] = useLapListInitCount();

  useEffect(() => {
    if (lynxFolderOK && mc) {
      window.FinishLynx.generateEvtFiles();
    }
  }, [lynxFolder, lynxFolderOK, mc, mcChangeCount]);

  useEffect(() => {
    const laps = getLaps();
    clearEntryResults(undefined);
    for (const lap of laps) {
      const key = `${lap.Gate}_${lap.EventNum}_${lap.Bow}`;
      lap.keyid = key;
      setEntryResult(key, lap);
    }
  }, [lapListInitCount]);
  return <></>;
}
