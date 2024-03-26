import { useEnableVideoTiming } from 'renderer/util/UseSettings';
import { useClickerData } from './UseClickerData';

const ClickerDataKeepAlive: React.FC = () => {
  useClickerData(); // trigger firebase to read the clicker data
  return <></>;
};

/**
 * This component monitors if the clicker data is enabled and if so, keeps it alive.
 * The component should be mounted in a top level component such as App.tsx
 * @returns a component that keeps the clicker data alive
 */
const VideoDataMonitor: React.FC = () => {
  const [enableVideoTiming] = useEnableVideoTiming();
  return enableVideoTiming ? <ClickerDataKeepAlive /> : <></>;
};

export default VideoDataMonitor;
