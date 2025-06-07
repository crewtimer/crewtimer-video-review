import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import Container from '@mui/material/Container';
import Card from '@mui/material/Card';
import CheckIcon from '@mui/icons-material/Check';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import FormControl from '@mui/material/FormControl';
import Select, { SelectChangeEvent } from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import clsx from 'clsx';
import { CircularProgress, InputLabel } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import {
  getWaypointList,
  useAuthOK,
  useAuthStatus,
  useDay,
  useDebugLevel,
  useMobileConfig,
  useMobileID,
  useMobilePin,
  useWaypoint,
} from './util/UseSettings';
import { clearCredentials, validateCredentials } from './util/UseAuthState';
import { useUserMessages } from './util/UserMessage';
import { useVideoSettings } from './video/VideoSettings';

const useStyles = makeStyles((theme) => ({
  paper: {
    marginTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  avatar: {
    margin: theme.spacing(1),
    backgroundColor: theme.palette.secondary.main,
  },
  form: {
    width: '100%', // Fix IE 11 issue.
    marginTop: theme.spacing(1),
  },
  submit: {
    margin: theme.spacing(2, 0, 0),
  },
  button: {
    margin: theme.spacing(2, 0, 0),
  },
  textfield: {
    margin: theme.spacing(2, 0, 0),
  },
  card: {
    width: '100%',
  },
  cardcontent: {
    margin: 0,
  },
  check: {
    color: 'white',
    marginLeft: theme.spacing(1),
    backgroundColor: 'green',
  },
  checkerr: {
    color: 'white',
    marginLeft: theme.spacing(1),
    backgroundColor: 'red',
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
  space: {
    marginLeft: theme.spacing(2),
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
  formControl: {
    margin: theme.spacing(1),
    minWidth: 120,
  },
  vertSpace: {
    marginTop: theme.spacing(1),
  },
}));

const CheckOK = () => {
  const classes = useStyles();
  return (
    <Box borderRadius="4px" height={16} width={16}>
      <CheckIcon className={classes.check} />
    </Box>
  );
};

export default function Setup() {
  const classes = useStyles();
  const [mobileIDStored] = useMobileID();
  const [mobilePinStored] = useMobilePin();
  const [timingWaypoint, setTimingWaypoint] = useWaypoint();
  const [timingDay, setTimingDay] = useDay();
  const [authStatus] = useAuthStatus();
  const authOK = useAuthOK();
  const [mc] = useMobileConfig();
  const [userMessages] = useUserMessages();
  const [debugLevel] = useDebugLevel();

  const [mobileID, setMobileID] = useState('');
  const [mobilePin, setMobilePin] = useState('');
  const [validating, setValidating] = useState(false);
  const [videoSettings, setVideoSettings] = useVideoSettings();
  const authError = !authOK && authStatus ? authStatus : '';

  const title = mc?.info.Title || '';

  const waypointList = getWaypointList();

  const validWaypoint = !mc || waypointList.includes(timingWaypoint);

  const dayList = mc?.info.DayList || [];

  useEffect(() => {
    if (!validWaypoint) {
      setTimingWaypoint('Finish');
    }
  }, [validWaypoint, setTimingWaypoint]);

  useEffect(() => {
    // Check for invalid day values
    const list = mc?.info.DayList || [];
    if (list.length && !list.includes(timingDay)) {
      setTimingDay(list[0]);
    } else if (list.length === 0 && timingDay.length !== 0) {
      setTimingDay('');
    }
  }, [mc?.info.DayList, setTimingDay, timingDay]);

  useEffect(() => {
    setMobileID(mobileIDStored);
    setMobilePin(mobilePinStored);
  }, [mobilePinStored, mobileIDStored]);

  const onTimingHintSourceChange = (event: SelectChangeEvent) => {
    const newValue = event.target.value === '---' ? '' : event.target.value;
    setVideoSettings({ ...videoSettings, timingHintSource: newValue }, true);
  };

  const onLoginClicked = async () => {
    setValidating(true);
    await validateCredentials({ mobileID, mobilePin });
    setValidating(false);
  };

  const onWaypointChange = (event: SelectChangeEvent<string>) => {
    if (!event.target.value) {
      return;
    }
    setTimingWaypoint(String(event.target.value));
  };

  const onDayChange = (event: SelectChangeEvent<string>) => {
    if (!event.target.value) {
      return;
    }
    setTimingDay(String(event.target.value));
  };

  return (
    <Container maxWidth="sm">
      <div className={classes.paper}>
        <Card className={classes.card} variant="outlined">
          <Toolbar className={classes.header}>
            <Typography
              variant="h6"
              display="inline"
              className={classes.smaller}
            >{`CrewTimer Race Credentials `}</Typography>
            {authError && (
              <Typography
                display="inline"
                color="error"
                className={clsx(classes.space, classes.smaller)}
              >{`[${authStatus}]`}</Typography>
            )}
            {mobileIDStored && <CheckOK />}
          </Toolbar>
          <Box className={classes.settings}>
            {mobileIDStored && (
              <Typography
                className={classes.vertSpace}
              >{`Title: ${title} (${mobileID})`}</Typography>
            )}
            {mobileIDStored && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                className={classes.submit}
                onClick={clearCredentials}
              >
                Log Out
              </Button>
            )}
            {!mobileIDStored && (
              <>
                <TextField
                  className={classes.textfield}
                  variant="outlined"
                  margin="dense"
                  required
                  fullWidth
                  id="mobileId"
                  label="Mobile ID"
                  name="mobileId"
                  autoComplete="mobileId"
                  value={mobileID}
                  onChange={(event) => {
                    setMobileID(event.target.value);
                  }}
                  autoFocus
                />
                <TextField
                  variant="outlined"
                  margin="dense"
                  required
                  fullWidth
                  name="mobilePin"
                  label="Mobile Pin"
                  type="password"
                  id="mobilePin"
                  value={mobilePin}
                  onChange={(event) => {
                    setMobilePin(event.target.value);
                  }}
                  autoComplete="current-mobilePin"
                />
                {validating ? (
                  <CircularProgress />
                ) : (
                  <Button
                    size="small"
                    fullWidth
                    variant="contained"
                    color="primary"
                    className={classes.submit}
                    onClick={onLoginClicked}
                  >
                    Sign In
                  </Button>
                )}
              </>
            )}
          </Box>
          {!mc && mobileIDStored && (
            <Box className={classes.settings}>
              <Typography>Loading Configuration</Typography>
              <CircularProgress />
            </Box>
          )}
          {mc && mobileIDStored && (
            <>
              <Toolbar className={classes.header}>
                <Typography
                  variant="h6"
                  display="inline"
                  className={classes.smaller}
                >
                  {dayList.length
                    ? 'Timing Waypoint and Day Selection'
                    : 'Timing Waypoint Selection'}
                </Typography>
              </Toolbar>
              <Box className={classes.settings}>
                <FormControl variant="standard" className={classes.formControl}>
                  <InputLabel shrink id="waypoint-label">
                    Waypoint
                  </InputLabel>
                  <Select
                    variant="standard"
                    value={timingWaypoint}
                    onChange={onWaypointChange}
                    className={classes.vertSpace}
                  >
                    {waypointList.map((waypoint) => (
                      <MenuItem key={waypoint} value={waypoint}>
                        {waypoint}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              {dayList.length !== 0 && (
                <Box className={classes.settings}>
                  <FormControl
                    variant="standard"
                    className={classes.formControl}
                  >
                    <InputLabel shrink id="day-label">
                      Day
                    </InputLabel>
                    <Select
                      variant="standard"
                      value={timingDay}
                      onChange={onDayChange}
                      className={classes.vertSpace}
                    >
                      {dayList.map((day) => (
                        <MenuItem key={day} value={day}>
                          {day}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              )}
              <Toolbar className={classes.header}>
                <Typography
                  variant="h6"
                  display="inline"
                  className={classes.smaller}
                >
                  Timing Hint Waypoint
                </Typography>
              </Toolbar>
              <Box className={classes.settings}>
                <Tooltip
                  title="Select the waypoint to use for timing hints."
                  placement="right"
                >
                  <FormControl
                    sx={{
                      marginTop: '1em',
                      marginBottom: '0.5em',
                      minWidth: 200,
                    }}
                    margin="dense"
                    size="small"
                  >
                    <InputLabel id="hint-select-label">Waypoint</InputLabel>
                    <Select
                      labelId="hint-select-label"
                      id="hint-select"
                      value={videoSettings.timingHintSource || '---'}
                      label="Waypoint"
                      onChange={onTimingHintSourceChange}
                      displayEmpty
                    >
                      <MenuItem value="---">None</MenuItem>
                      {waypointList.map((waypoint) => (
                        <MenuItem key={waypoint} value={waypoint}>
                          {waypoint}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Tooltip>
              </Box>
            </>
          )}
        </Card>
        {debugLevel > 0 && (
          <Typography>${JSON.stringify(userMessages)}</Typography>
        )}
      </div>
    </Container>
  );
}
