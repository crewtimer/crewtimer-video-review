import {
  Box,
  Card,
  Checkbox,
  Container,
  FormControlLabel,
  SxProps,
  Theme,
  Toolbar,
  Typography,
} from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import {
  useEnableLynx,
  useEnableVideo,
  useEnableVideoTiming,
} from './util/UseSettings';

const useStyles = makeStyles((theme) => ({
  paper: {
    marginTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },

  card: {
    width: '100%',
  },
  header: {
    height: '40px',
    minHeight: '40px',
    color: '#000000',
    backgroundColor: '#e8e8e8',
    paddingLeft: theme.spacing(2),
  },
  smaller: {
    transform: 'scale(0.8)',
    transformOrigin: 'left',
  },
  settings: {
    marginLeft: theme.spacing(2),
    marginBottom: theme.spacing(1),
    marginRight: theme.spacing(2),
  },
  indentSettings: {
    marginLeft: theme.spacing(8),
    marginBottom: theme.spacing(1),
    marginRight: theme.spacing(2),
  },
}));
interface SxPropsArgs {
  sx?: SxProps<Theme>;
}
const SystemConfig: React.FC<SxPropsArgs> = ({ sx }) => {
  const [enableLynx, setEnableLynx] = useEnableLynx();
  const [enableVideo, setEnableVideo] = useEnableVideo();
  const [enableVideoTiming, setEnableVideoTiming] = useEnableVideoTiming();
  const classes = useStyles();

  return (
    <Container maxWidth="sm" sx={sx}>
      <div className={classes.paper}>
        <Card className={classes.card} variant="outlined">
          <>
            <Toolbar className={classes.header}>
              <Typography
                variant="h6"
                display="inline"
                className={classes.smaller}
              >
                System Features
              </Typography>
            </Toolbar>
            <Box className={classes.settings}>
              <FormControlLabel
                labelPlacement="end"
                label="Enable FinishLynx Integration"
                control={
                  <Checkbox
                    checked={enableLynx}
                    onChange={() => {
                      setEnableLynx(!enableLynx);
                    }}
                  />
                }
              />
            </Box>
            <Box className={classes.settings}>
              <FormControlLabel
                labelPlacement="end"
                label="Enable Video Review"
                control={
                  <Checkbox
                    checked={enableVideo}
                    onChange={() => {
                      setEnableVideo(!enableVideo);
                    }}
                  />
                }
              />
            </Box>
            <Box className={classes.indentSettings}>
              <FormControlLabel
                labelPlacement="end"
                label="Integrate with CrewTimer"
                control={
                  <Checkbox
                    disabled={!enableVideo}
                    checked={enableVideoTiming}
                    onChange={() => {
                      setEnableVideoTiming(!enableVideoTiming);
                    }}
                  />
                }
              />
            </Box>
          </>
        </Card>
      </div>
    </Container>
  );
};

export default SystemConfig;
