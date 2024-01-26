import makeStyles from '@mui/styles/makeStyles';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Setup from './Setup';
import Status from './Status';
import { useInitializing, useTabPosition } from './util/UseSettings';
import FinishLynxHelp from './FinishLynxHelp';
import { Toast } from './Toast';
import Video from './video/Video';

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

  const handleChange = (_event: unknown, newValue: number) => {
    setTabPosition(newValue);
  };

  if (initializing) {
    return <></>;
  }
  return (
    // <div style={{ display: 'flex', flexFlow: 'column' }}>
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
          <Tab label="Status" />
          <Tab label="Settings" />
          <Tab label="Video" />
          <Tab label="Help" />
        </Tabs>
      </div>
      <Tabs style={{ zIndex: 0 }} />
      {tabPosition === 0 && <Status />}
      {tabPosition === 1 && <Setup />}
      {tabPosition === 2 && <Video />}
      {tabPosition === 3 && <FinishLynxHelp />}
      <Toast />
    </Paper>
    // </div>
  );
}
