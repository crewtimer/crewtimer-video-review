import { useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import './App.global.css';
import CenteredTabs from './CenteredTabs';
import InitProgress, { useInitProgress } from './InitProgress';
import Nav from './Nav';
import StatusMonitor from './StatusMonitor';
import { ConfirmDialog } from './util/ConfirmDialog';
import { setInitializing } from './util/UseSettings';
import VideoDataMonitor from './video/VideoDataMonitor';
import FileMonitor from './video/VideoFileUtils';
import { triggerFileSplit } from './video/VideoUtils';

const { startLapStorage } = window.LapStorage;
const { stopLapStorage } = window.LapStorage;
export default function App() {
  const [, setInitProgress] = useInitProgress();
  useEffect(() => {
    setInitializing(true);
    const doInit = async () => {
      setInitProgress(10);

      window.Firebase.startFirebase();
      setInitProgress(25);

      await startLapStorage();
      setInitProgress(50);

      window.FinishLynx.startLynxServer();
      setInitProgress(75);

      setInitProgress(100);

      // Wait for stored data to be loaded
      setTimeout(() => setInitializing(false), 200);
    };
    doInit();
    return () => {
      window.FinishLynx.stopLynxServer();
      stopLapStorage();
      window.Firebase.stopFirebase();
    };
  }, [setInitProgress]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        triggerFileSplit();
      }
    };

    // Add event listener to window
    window.addEventListener('keydown', handleKeyDown);

    // Remove event listener on cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // Empty dependency array means this effect runs only on mount and unmount

  return (
    <Router>
      <div style={{ height: '100vh', display: 'flex', flexFlow: 'column' }}>
        <Nav />
        <InitProgress />
        <CenteredTabs />
      </div>

      <ConfirmDialog />
      <StatusMonitor />

      <FileMonitor />
      <VideoDataMonitor />
    </Router>
  );
}
