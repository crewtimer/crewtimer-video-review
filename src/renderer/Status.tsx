import Container from '@mui/material/Container';
import { Button, Stack, Typography } from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import LapList from './LapList';
import { useDay, useMobileConfig, useWaypoint } from './util/UseSettings';
import { setDialogConfig } from './util/ConfirmDialog';
import { setToast } from './Toast';

const { LapStorage } = window;

const useStyles = makeStyles({
  title: {
    marginTop: '1em',
  },
  waypoint: {
    marginBottom: '1em',
  },
});
export default function Status() {
  const classes = useStyles();
  const [mc] = useMobileConfig();
  const [waypoint] = useWaypoint();
  const [day] = useDay();

  const title = mc?.info.Title || 'Loading...';
  const confirmClearHistory = () => {
    setDialogConfig({
      title: 'Clear Local Timing History',
      message:
        'Permanently remove all timing history stored locally on this computer?',
      button: 'Clear Local History',
      showCancel: true,
      handleConfirm: () => {
        Promise.resolve(LapStorage.truncateLapTable())
          .then(() => {
            setToast({ severity: 'info', msg: 'Local timing history cleared' });
            return undefined;
          })
          .catch((error) => {
            console.error('Unable to clear local timing history', error);
            setToast({
              severity: 'error',
              msg: 'Unable to clear local timing history',
            });
          });
      },
    });
  };

  return (
    <Container
      maxWidth="xl"
      style={{
        flexGrow: 1,
        display: 'flex',
        flexFlow: 'column',
        flex: 1,
        paddingBottom: '2em',
      }}
    >
      {mc && (
        <Typography className={classes.title} variant="h5">
          {title}
        </Typography>
      )}
      <Stack
        className={classes.waypoint}
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="h6">{`Waypoint: ${waypoint}${day ? `, Day: ${day}` : ''}`}</Typography>
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={confirmClearHistory}
        >
          Clear Local History
        </Button>
      </Stack>
      <LapList />
    </Container>
  );
}
