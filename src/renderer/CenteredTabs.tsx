import makeStyles from '@mui/styles/makeStyles';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Setup from './Setup';
import Status from './Status';
import { useInitializing, useTabPosition } from './util/UseSettings';
import { Toast } from './Toast';
import Video from './video/Video';
import {
  HistoryTwoTone,
  VideoSettings,
  Settings,
  OndemandVideo,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { VideoSettingsDialog } from './video/VideoSettingsView';

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
  const [initializing] = useInitializing();

  const handleChange = (_event: unknown, newValue: string) => {
    setTabPosition(newValue);
  };

  if (initializing) {
    return <></>;
  }

  let Page = Setup;
  if (tabPosition === 'Video') {
    Page = Video;
  } else if (tabPosition === 'Video Settings') {
    Page = VideoSettingsDialog;
  } else if (tabPosition === 'Timing History') {
    Page = Status;
  } else if (tabPosition === 'System Config') {
    Page = Setup;
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
          <Tab
            icon={
              <Tooltip title="Video Review">
                <OndemandVideo />
              </Tooltip>
            }
            value="Video"
          />
          <Tab
            icon={
              <Tooltip title="Video Settings">
                <VideoSettings />
              </Tooltip>
            }
            value="Video Settings"
          />
          <Tab
            icon={
              <Tooltip title="Timing History">
                <HistoryTwoTone />
              </Tooltip>
            }
            value="Timing History"
          />
          <Tab
            icon={
              <Tooltip title="CrewTimer Settings">
                <Settings />
              </Tooltip>
            }
            value="System Config"
          />
        </Tabs>
      </div>
      <Tabs style={{ zIndex: 0 }} />
      <Page />
      <Toast />
    </Paper>
    // </div>
  );
}
