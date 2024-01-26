import Container from '@mui/material/Container';
import { Typography } from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import LapList from './LapList';
import { useDay, useMobileConfig, useWaypoint } from './util/UseSettings';

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
      <Typography
        className={classes.waypoint}
        variant="h6"
      >{`Waypoint: ${waypoint}${day ? `, Day: ${day}` : ''}`}</Typography>
      <LapList />
    </Container>
  );
}
