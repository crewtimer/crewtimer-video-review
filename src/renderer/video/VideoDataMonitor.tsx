import { EntryProgressItem, KeyMap } from 'crewtimer-common';
import React, { useEffect } from 'react';
import { firebaseSubscribe } from 'renderer/util/UseFirebase';
import { useMobileID } from 'renderer/util/UseSettings';
import { getConnectionProps } from 'renderer/util/Util';
import {
  clearEntryExceptions,
  setEntryException,
  useClickerData,
} from './UseClickerData';

const ClickerDataKeepAlive: React.FC = () => {
  useClickerData(); // trigger firebase to read the clicker data
  // eslint-disable-next-line react/jsx-no-useless-fragment
  return <></>;
};

/**
 *
 * @returns a component that subscribes to the entry exception state and updates a KeyedDatum
 */
const ClickerProgressWatcher: React.FC = () => {
  const [mobileID] = useMobileID();
  useEffect(() => {
    if (mobileID) {
      clearEntryExceptions(undefined);
      const { regattaID } = getConnectionProps(mobileID);
      const path = `mobile/${regattaID}/P/S`;
      const onDataRx = (data: KeyMap<EntryProgressItem> | undefined): void => {
        if (data) {
          Object.keys(data).forEach(
            (key) => setEntryException(key, data[key].e), // For now, only interested in exceptions
          );
        }
      };
      const unsubscribe = firebaseSubscribe(path, onDataRx);
      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }
    return undefined;
  }, [mobileID]);

  // eslint-disable-next-line react/jsx-no-useless-fragment
  return <></>;
};
/**
 * This component monitors if the clicker data is enabled and if so, keeps it alive.
 * The component should be mounted in a top level component such as App.tsx
 * @returns a component that keeps the clicker data alive
 */
const VideoDataMonitor: React.FC = () => {
  return (
    <>
      <ClickerProgressWatcher />
      <ClickerDataKeepAlive />
    </>
  );
};

export default VideoDataMonitor;
