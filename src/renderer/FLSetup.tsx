import React, { useEffect } from 'react';
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
import Checkbox from '@mui/material/Checkbox';
import path from 'path';
import { FormControlLabel, InputLabel } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import {
  useFLStartWaypoint,
  useFLStartWaypointEnable,
  useLynxFolder,
  useLynxFolderOK,
  useMobileConfig,
  useMobileConfigDate,
  useMobileID,
  useWaypoint,
} from './util/UseSettings';
import { setToast } from './Toast';

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

export default function FLSetup() {
  const classes = useStyles();
  const [mobileIDStored] = useMobileID();
  const [timingWaypoint] = useWaypoint();
  const [flStartWaypoint, setFLStartWaypoint] = useFLStartWaypoint();
  const [flStartWaypointEnable, setFLStartWaypointEnable] =
    useFLStartWaypointEnable();

  const [lynxFolder] = useLynxFolder();
  const [lynxFolderOK] = useLynxFolderOK();
  const [mc] = useMobileConfig();
  const [configUpdatedDate] = useMobileConfigDate();

  let waypointList = ['Start'];
  const waypoints = mc?.info.Waypoints || '';
  if (waypoints.length > 0) {
    waypointList = waypointList.concat(waypoints.split(','));
  }
  waypointList = waypointList.concat(['Finish']);
  waypointList = waypointList.map((waypoint) => waypoint.trim());

  const isStartWaypoint = timingWaypoint.toLowerCase().includes('start');
  const flWaypointList = waypointList.filter((waypoint) =>
    waypoint.toLowerCase().includes('start')
  );

  // Update flStart if it doesn't have a valid value
  const flStartError = !waypointList.includes(flStartWaypoint);
  const flStartFix = flStartError ? flWaypointList[0] || 'Start' : '';
  useEffect(() => {
    if (flStartFix) {
      setFLStartWaypoint(flStartFix);
    }
  }, [flStartFix, setFLStartWaypoint]);

  const onFLWaypointChange = (event: SelectChangeEvent<string>) => {
    if (!event.target.value) {
      return;
    }
    setFLStartWaypoint(String(event.target.value));
  };

  const onFlStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFLStartWaypointEnable(event.target.checked);
  };

  return (
    <Container maxWidth="sm">
      <div className={classes.paper}>
        <Card className={classes.card} variant="outlined">
          <>
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
                    <FormControl
                      variant="standard"
                      className={classes.formControl}
                    >
                      <InputLabel id="fl-start-waypoint-label">
                        FL Waypoint
                      </InputLabel>
                      <Select
                        variant="standard"
                        value={flStartWaypoint}
                        onChange={onFLWaypointChange}
                        className={classes.vertSpace}
                      >
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
            {!mc || !mobileIDStored ? (
              <Box
                className={classes.settings}
                sx={{ paddingTop: '1em', paddingBottom: '1em' }}
              >
                <Typography display="inline" className={classes.smaller}>
                  Waiting for valid CrewTimer configuration
                </Typography>
              </Box>
            ) : (
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
            )}
          </>
        </Card>
      </div>
    </Container>
  );
}
