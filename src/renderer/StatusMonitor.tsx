import { useEffect } from 'react';
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

  useEffect(() => {
    if (lynxFolderOK && mc) {
      window.FinishLynx.generateEvtFiles();
    }
  }, [lynxFolder, lynxFolderOK, mc, mcChangeCount]);
  return <></>;
}
