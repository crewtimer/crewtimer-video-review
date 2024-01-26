import makeStyles from '@mui/styles/makeStyles';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { UseDatum } from 'react-usedatum';

const useStyles = makeStyles({
  root: {
    width: '100%',
    margin: 32,
  },
});
export const [useInitProgress] = UseDatum(0);
export default function InitProgress() {
  const classes = useStyles();
  const [initProgress] = useInitProgress();
  if (initProgress >= 100) {
    return <></>;
  }

  return (
    <div className={classes.root}>
      <Box display="flex" alignItems="left">
        <Typography variant="h6">Loading...</Typography>
      </Box>
      <Box display="flex" alignItems="center">
        <Box width="80%" mr={1}>
          <LinearProgress variant="determinate" value={initProgress} />
        </Box>
        <Box minWidth={35}>
          <Typography variant="body2" color="textSecondary">{`${Math.round(
            initProgress
          )}%`}</Typography>
        </Box>
      </Box>
    </div>
  );
}
