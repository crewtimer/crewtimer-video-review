import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Container,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  SxProps,
  Theme,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Settings';
import { setDialogConfig } from '../util/ConfirmDialog';
import {
  useMouseWheelInverted,
  useTravelRightToLeft,
  useVideoSettings,
} from './VideoSettings';
import { useMobileConfig } from '../util/UseSettings';
import TimezoneSelector from '../util/TimezoneSelector';
import HyperZoomSelector from '../util/HyperZoomSelector';
import makeStyles from '@mui/styles/makeStyles';
import { saveVideoSidecar } from './VideoFileUtils';

declare module '@mui/styles/defaultTheme' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface (remove this line if you don't have the rule enabled)
  interface DefaultTheme extends Theme {}
}
const useStyles = makeStyles((theme) => ({
  header: {
    height: '40px',
    minHeight: '40px',
    color: '#000000',
    backgroundColor: '#e8e8e8',
    paddingLeft: theme.spacing(2),
    marginBottom: '0.5em',
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
}));

export const VideoSettingsDialog = () => {
  const classes = useStyles();
  const [videoSettings, setVideoSettings] = useVideoSettings();
  const [mc] = useMobileConfig();
  const [wheelInverted, setWheelInverted] = useMouseWheelInverted();
  const [rightToLeft, setRightToLeft] = useTravelRightToLeft();

  // Handler to update the wheelFactor state
  // const handleSliderChange = (_event: Event, newValue: number | number[]) => {
  //   setWheelFactor(newValue as number);
  // };

  let waypointList = ['Start'];
  const waypoints = mc?.info.Waypoints || '';
  if (waypoints.length > 0) {
    waypointList = waypointList.concat(waypoints.split(','));
  }
  waypointList = waypointList.concat(['Finish']);
  waypointList = waypointList.map((waypoint) => waypoint.trim());

  const resetGuides = () => {
    const newSetting = { ...videoSettings };
    const finishGuide = newSetting.guides.find((g) => g.label === 'Finish');
    if (finishGuide) {
      finishGuide.pt1 = finishGuide.pt2 = 0;
      setVideoSettings(newSetting, true);
      saveVideoSidecar();
    }
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
        paddingTop: '1em',
      }}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <Toolbar className={classes.header}>
            <Typography
              variant="h6"
              display="inline"
              className={classes.smaller}
            >
              Course Configuration
            </Typography>
          </Toolbar>
          <Box className={classes.settings}>
            <TimezoneSelector />
          </Box>
          <Box className={classes.settings}>
            <Tooltip
              title="Direction of travel when crossing the finish line"
              placement="right"
            >
              <FormControl
                sx={{
                  marginTop: '0.5em',
                  marginBottom: '0.5em',
                  minWidth: 160,
                }}
                margin="dense"
                size="medium"
              >
                <InputLabel id="travel-direction-label">
                  Travel Direction
                </InputLabel>
                <Select
                  labelId="travel-direction-label"
                  value={rightToLeft ? 1 : 0}
                  label="Hyperzoom Resolution"
                  onChange={(event: SelectChangeEvent<number | string>) => {
                    console.log(event.target.value as number);
                    setRightToLeft((event.target.value as number) === 1);
                  }}
                >
                  <MenuItem value={0}>Left to Right</MenuItem>
                  <MenuItem value={1}>Right to Left</MenuItem>
                </Select>
              </FormControl>
            </Tooltip>
          </Box>
          <Box className={classes.settings}>
            <Tooltip
              title="Lane position in relation to the lane guides"
              placement="right"
            >
              <FormControl
                sx={{
                  marginTop: '0.5em',
                  marginBottom: '0.5em',
                  minWidth: 160,
                }}
                margin="dense"
                size="medium"
              >
                <InputLabel id="lane-position-label">Lane Position</InputLabel>
                <Select
                  labelId="lane-position-label"
                  value={videoSettings.laneBelowGuide ? 1 : 0}
                  label="Lane Position"
                  onChange={(event: SelectChangeEvent<number | string>) => {
                    setVideoSettings(
                      {
                        ...videoSettings,
                        laneBelowGuide: (event.target.value as number) === 1,
                      },
                      true
                    );
                    saveVideoSidecar();
                  }}
                >
                  <MenuItem value={0}>Lane Above Guide</MenuItem>
                  <MenuItem value={1}>Lane Below Guide</MenuItem>
                </Select>
              </FormControl>
            </Tooltip>
          </Box>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Toolbar className={classes.header}>
            <Typography
              variant="h6"
              display="inline"
              className={classes.smaller}
            >
              Interface Settings
            </Typography>
          </Toolbar>
          <Box className={classes.settings}>
            <HyperZoomSelector />
          </Box>
          <Box className={classes.settings}>
            <FormControlLabel
              labelPlacement="end"
              label="Enable Auto-Zoom with shift-click"
              control={
                <Checkbox
                  checked={videoSettings.enableAutoZoom}
                  onChange={() => {
                    setVideoSettings(
                      {
                        ...videoSettings,
                        enableAutoZoom: !videoSettings.enableAutoZoom,
                      },
                      true
                    );
                  }}
                />
              }
            />
          </Box>
          <Box className={classes.settings}>
            <Tooltip title="Invert wheel direction" placement="right">
              <FormControlLabel
                labelPlacement="end"
                label="Invert wheel direction"
                control={
                  <Checkbox
                    checked={wheelInverted}
                    onChange={() => setWheelInverted(!wheelInverted)}
                  />
                }
              />
            </Tooltip>
            {/* <Typography variant="body1" mr={2}>
              Wheel Factor
            </Typography>
            <Box display="flex" alignItems="center">
              <Typography variant="body1" mr={2}>
                {wheelFactor}
              </Typography>
              <Tooltip title="Adjust wheel sensitivity">
                <Slider
                  min={1}
                  max={200}
                  value={wheelFactor}
                  onChange={handleSliderChange}
                  aria-labelledby="wheel-factor-slider"
                />
              </Tooltip>
            </Box> */}
          </Box>
        </Grid>
        <Grid item xs={12} sm={12}>
          <Toolbar className={classes.header}>
            <Typography
              variant="h6"
              display="inline"
              className={classes.smaller}
            >
              Guide Visibility
            </Typography>
          </Toolbar>
          <Box className={classes.settings}>
            <Stack direction="row">
              <FormControlLabel
                labelPlacement="end"
                label="Finish"
                control={
                  <Checkbox
                    checked={videoSettings.guides[0].enabled}
                    onChange={() => {
                      const guides = [...videoSettings.guides];
                      guides[0].enabled = !guides[0].enabled;
                      setVideoSettings({ ...videoSettings, guides }, true);
                    }}
                  />
                }
              />
              <Button
                variant="outlined"
                size="small"
                onClick={() => resetGuides()}
              >
                Reset Finish Line to Center
              </Button>
            </Stack>
            <FormControlLabel
              labelPlacement="end"
              label="Enable Lane Guides"
              control={
                <Checkbox
                  checked={videoSettings.enableLaneGuides}
                  onChange={() => {
                    setVideoSettings(
                      {
                        ...videoSettings,
                        enableLaneGuides: !videoSettings.enableLaneGuides,
                      },
                      true
                    );
                  }}
                />
              }
            />
            <Box>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((lane) => (
                <FormControlLabel
                  key={lane}
                  labelPlacement="end"
                  label={`Lane ${lane}`}
                  control={
                    <Checkbox
                      checked={videoSettings.guides[lane + 1].enabled}
                      disabled={!videoSettings.enableLaneGuides}
                      onChange={() => {
                        const guides = [...videoSettings.guides]; // force 'diff'
                        videoSettings.guides[lane + 1].enabled =
                          !videoSettings.guides[lane + 1].enabled;
                        setVideoSettings({ ...videoSettings, guides }, true);
                      }}
                    />
                  }
                />
              ))}
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Container>
  );
};

interface VideoSettingsViewProps {
  sx?: SxProps<Theme>;
}

export const showVideoSettings = () => {
  setDialogConfig({
    title: `Video Settings`,
    message: ``,
    body: <VideoSettingsDialog />,
    button: 'Done',
    showCancel: false,
  });
};

const VideoSettingsView: React.FC<VideoSettingsViewProps> = ({ sx }) => {
  return (
    <Box onClick={showVideoSettings} sx={sx}>
      <IconButton onClick={showVideoSettings} color="inherit" size="medium">
        <MenuIcon />
      </IconButton>
      Settings
    </Box>
  );
};

export default VideoSettingsView;
