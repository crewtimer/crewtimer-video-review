import React, { useEffect, useState } from 'react';
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
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import { Info } from '@mui/icons-material';
import path from 'path';
import clsx from 'clsx';
import { CircularProgress, FormControlLabel, InputLabel } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import {
  useAuthOK,
  useAuthStatus,
  useDay,
  useDebugLevel,
  useFlightRaces,
  useFLStartWaypoint,
  useFLStartWaypointEnable,
  useLynxFolder,
  useLynxFolderOK,
  useMobileConfig,
  useMobileConfigDate,
  useMobileID,
  useMobilePin,
  useWaypoint,
} from './util/UseSettings';
import { clearCredentials, validateCredentials } from './util/UseAuthState';
import { setToast } from './Toast';
import { useUserMessages } from './util/UserMessage';

const { generateEvtFiles, chooseLynxFolder } = window.FinishLynx;

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
  grow: {
    flexGrow: 1,
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
  const [flStartWaypoint, setFLStartWaypoint] = useFLStartWaypoint();
  const [flStartWaypointEnable, setFLStartWaypointEnable] =
    useFLStartWaypointEnable();
  const [timingDay, setTimingDay] = useDay();
  const [authStatus] = useAuthStatus();
  const authOK = useAuthOK();
  const [lynxFolder] = useLynxFolder();
  const [lynxFolderOK] = useLynxFolderOK();
  const [mc] = useMobileConfig();
  const [userMessages] = useUserMessages();
  const [debugLevel] = useDebugLevel();
  const [configUpdatedDate] = useMobileConfigDate();
  const [flightRaces, setFlightRaces] = useFlightRaces();

  const [mobileID, setMobileID] = useState('');
  const [mobilePin, setMobilePin] = useState('');
  const [validating, setValidating] = useState(false);
  const authError = !authOK && authStatus ? authStatus : '';

  const title = mc?.info.Title || '';

  let waypointList = ['Start'];
  const waypoints = mc?.info.Waypoints || '';
  if (waypoints.length > 0) {
    waypointList = waypointList.concat(waypoints.split(','));
  }
  waypointList = waypointList.concat(['Finish']);
  waypointList = waypointList.map((waypoint) => waypoint.trim());

  const validWaypoint = !mc || waypointList.includes(timingWaypoint);
  const isStartWaypoint = timingWaypoint.toLowerCase().includes('start');
  const flWaypointList = waypointList.filter((waypoint) =>
    waypoint.toLowerCase().includes('start')
  );

  const dayList = mc?.info.DayList || [];

  // Update flStart if it doesn't have a valid value
  const flStartError = !waypointList.includes(flStartWaypoint);
  const flStartFix = flStartError ? flWaypointList[0] || 'Start' : '';
  useEffect(() => {
    if (flStartFix) {
      setFLStartWaypoint(flStartFix);
    }
  }, [flStartFix, setFLStartWaypoint]);

  useEffect(() => {
    if (!validWaypoint) {
      setTimingWaypoint('Start');
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

  const onLoginClicked = async () => {
    setValidating(true);
    await validateCredentials({ mobileID, mobilePin });
    setValidating(false);
  };

  const onWaypointChange = (
    event: React.ChangeEvent<{ name?: string | undefined; value: unknown }>
  ) => {
    if (!event.target.value) {
      return;
    }
    setTimingWaypoint(String(event.target.value));
  };

  const onFLWaypointChange = (
    event: React.ChangeEvent<{ name?: string | undefined; value: unknown }>
  ) => {
    if (!event.target.value) {
      return;
    }
    setFLStartWaypoint(String(event.target.value));
  };

  const onDayChange = (
    event: React.ChangeEvent<{ name?: string | undefined; value: unknown }>
  ) => {
    if (!event.target.value) {
      return;
    }
    setTimingDay(String(event.target.value));
    generateEvtFiles();
  };

  const onFlStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFLStartWaypointEnable(event.target.checked);
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
                    ? 'Waypoint and Day Selection'
                    : 'Waypoint Selection'}
                </Typography>
              </Toolbar>
              <Box
                className={classes.settings}
                style={{ display: 'flex', flexDirection: 'row' }}
              >
                <TextField
                  className={classes.textfield}
                  variant="outlined"
                  margin="dense"
                  fullWidth
                  name="FlightRaces"
                  label="Flight Races EventNum Regex"
                  id="FlightRaces"
                  value={flightRaces}
                  onChange={(event) => {
                    setFlightRaces(event.target.value);
                  }}
                  style={{ display: 'inline-flex' }}
                />
                <Tooltip title="Specify regex pattern to create a flight.  e.g. 1[0-9][0-9] for events 100-199">
                  <Box
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingLeft: '1em',
                    }}
                  >
                    <Info />
                  </Box>
                </Tooltip>
              </Box>
              <Box className={classes.settings}>
                <FormControl variant="standard" className={classes.formControl}>
                  <InputLabel shrink id="waypoint-label">
                    Waypoint
                  </InputLabel>
                  <Select
                    variant="standard"
                    value={timingWaypoint}
                    onChange={onWaypointChange}
                    className={classes.vertSpace}>
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
                  <FormControl variant="standard" className={classes.formControl}>
                    <InputLabel shrink id="day-label">
                      Day
                    </InputLabel>
                    <Select
                      variant="standard"
                      value={timingDay}
                      onChange={onDayChange}
                      className={classes.vertSpace}>
                      {dayList.map((day) => (
                        <MenuItem key={day} value={day}>
                          {day}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              )}
              {!isStartWaypoint && (
                <>
                  <Box className={classes.settings}>
                    <FormControlLabel
                      className={classes.formControl}
                      labelPlacement="end"
                      label="Record FinishLynx Start Times"
                      control={
                        <Checkbox
                          checked={flStartWaypointEnable}
                          onChange={onFlStartChange}
                        />
                      }
                    />
                  </Box>
                  {flStartWaypointEnable && flWaypointList.length > 1 && (
                    <Box className={classes.indentSettings}>
                      <FormControl variant="standard" className={classes.formControl}>
                        <InputLabel id="fl-start-waypoint-label">
                          FL Waypoint
                        </InputLabel>
                        <Select
                          variant="standard"
                          value={flStartWaypoint}
                          onChange={onFLWaypointChange}
                          className={classes.vertSpace}>
                          {flWaypointList.map((waypoint) => (
                            <MenuItem key={waypoint} value={waypoint}>
                              {waypoint}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  )}
                </>
              )}
              <Toolbar className={classes.header}>
                <Typography
                  variant="h6"
                  display="inline"
                  className={classes.smaller}
                >
                  FinishLynx Configuration
                </Typography>
                {lynxFolderOK ? (
                  <CheckOK />
                ) : (
                  <Typography
                    display="inline"
                    color="error"
                    className={classes.space}
                  >
                    Folder not found
                  </Typography>
                )}
              </Toolbar>
              <Box className={classes.settings}>
                <Tooltip
                  title="Specify where FinishLynx configuration files should be placed"
                  aria-label="waypoint"
                >
                  <TextField
                    className={classes.textfield}
                    variant="outlined"
                    margin="dense"
                    fullWidth
                    disabled
                    name="inputFolder"
                    label="FinishLynx Input Folder"
                    id="inputFolder"
                    value={lynxFolder}
                    onClick={() => {
                      chooseLynxFolder();
                    }}
                  />
                </Tooltip>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  className={classes.button}
                  onClick={() => {
                    chooseLynxFolder();
                  }}
                >
                  Choose Folder
                </Button>
              </Box>
              <Toolbar className={classes.header}>
                <Typography
                  variant="h6"
                  display="inline"
                  className={classes.smaller}
                >
                  FinishLynx Configuration (autogenerated)
                </Typography>
              </Toolbar>
              <Box className={classes.settings}>
                <Typography className={classes.vertSpace}>
                  {`Last updated: ${configUpdatedDate}`}
                </Typography>
                <Typography>{path.join(lynxFolder, 'Lynx.evt')}</Typography>
                <Typography>{path.join(lynxFolder, 'Lynx.sch')}</Typography>
                <Typography>
                  {path.join(lynxFolder, 'CrewTimer.lss')}
                </Typography>
                <Typography>TCP Port: 5000</Typography>
                {lynxFolderOK && (
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    className={classes.button}
                    onClick={() => {
                      generateEvtFiles();
                      setToast({
                        severity: 'info',
                        msg: 'FinishLynx files exported',
                      });
                    }}
                  >
                    Refresh Export
                  </Button>
                )}
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
