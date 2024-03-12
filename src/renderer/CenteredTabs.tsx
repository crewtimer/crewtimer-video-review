import makeStyles from '@mui/styles/makeStyles';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Setup from './Setup';
import Status from './Status';
import {
  useEnableLynx,
  useEnableVideo,
  useEnableVideoTiming,
  useInitializing,
  useTabPosition,
} from './util/UseSettings';
import FinishLynxHelp from './FinishLynxHelp';
import { Toast } from './Toast';
import Video from './video/Video';
import FLSetup from './FLSetup';
import SystemConfig from './SystemConfig';

const useStyles = makeStyles({
  root: {
    flexGrow: 1,
    flexFlow: 'column',
    display: 'flex',
  },
});

export default function CenteredTabs() {
  const classes = useStyles();
  const [tabPosition, setTabPosition] = useTabPosition();
  const [enableVideo] = useEnableVideo();
  const [enableLynx] = useEnableLynx();
  const [enableVideoTiming] = useEnableVideoTiming();
  const [initializing] = useInitializing();

  const handleChange = (_event: unknown, newValue: string) => {
    setTabPosition(newValue);
  };

  if (initializing) {
    return <></>;
  }
  return (
    <Paper className={classes.root} square>
      {/* Keeep Tabs from scrolling by surround with fixed */}
      <div>
        <Tabs
          value={tabPosition}
          onChange={handleChange}
          indicatorColor="primary"
          textColor="primary"
          centered
          style={{
            width: '100%',
            position: 'fixed',
            zIndex: 1000,
            backgroundColor: '#fff',
            marginBottom: '1em',
          }}
        >
          {(enableLynx || (enableVideo && enableVideoTiming)) && (
            <Tab label="Timing History" value="Timing History" />
          )}
          {(enableLynx || (enableVideo && enableVideoTiming)) && (
            <Tab label="CrewTimer" value="CrewTimer" />
          )}
          {enableLynx && <Tab label="Lynx" value="Lynx" />}
          {enableLynx && <Tab label="Lynx Help" value="Help" />}
          {enableVideo && <Tab label="Video" value="Video" />}
          <Tab label="Configuration" value="Config" />
        </Tabs>
      </div>
      <Tabs style={{ zIndex: 0 }} />
      {tabPosition === 'Config' && <SystemConfig />}
      {tabPosition === 'Timing History' && <Status />}
      {tabPosition === 'CrewTimer' && <Setup />}
      {tabPosition === 'Lynx' && <FLSetup />}
      {tabPosition === 'Video' && <Video />}
      {tabPosition === 'Help' && <FinishLynxHelp />}
      <Toast />
    </Paper>
    // </div>
  );
}
