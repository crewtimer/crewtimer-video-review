import makeStyles from '@mui/styles/makeStyles';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import {
  HistoryTwoTone,
  VideoSettings,
  OndemandVideo,
  HelpOutline,
} from '@mui/icons-material';

import { Box, Tooltip } from '@mui/material';
import CrewTimerRower from 'assets/icons/CrewTimerRower';
import Setup from './Setup';
import Status from './Status';
import { useInitializing, useTabPosition } from './util/UseSettings';
import { Toast } from './Toast';
import Video from './video/Video';
import { VideoSettingsDialog } from './video/VideoSettingsView';
import HelpMarkdown from './doc/HelpMarkdown.md';
import Markdown from './doc/Markdown';

const useStyles = makeStyles({
  root: {
    flexFlow: 'column',
    display: 'flex',
  },
});

const HelpPage = () => <Markdown md={HelpMarkdown} />;

export default function CenteredTabs() {
  const classes = useStyles();
  // eslint-disable-next-line prefer-const
  let [tabPosition, setTabPosition] = useTabPosition();
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
  } else if (tabPosition === 'Help') {
    Page = HelpPage;
  } else {
    tabPosition = 'System Config';
  }
  return (
    <Box className={classes.root} sx={{ height: '100%' }}>
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
                <CrewTimerRower />
              </Tooltip>
            }
            value="System Config"
          />
          <Tab
            icon={
              <Tooltip title="Help">
                <HelpOutline />
              </Tooltip>
            }
            value="Help"
          />
        </Tabs>
      </div>
      <Tabs style={{ zIndex: 0 }} />
      <Page />
      <Toast />
    </Box>
  );
}
