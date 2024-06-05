import {
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  IconButton,
  Slider,
  Stack,
  SxProps,
  Theme,
  Toolbar,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Settings';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import { useMouseWheelFactor, useVideoSettings } from './VideoSettings';
import { useMobileConfig } from 'renderer/util/UseSettings';
import TimezoneSelector from 'renderer/util/TimezoneSelector';
import { saveVideoSidecar } from './VideoUtils';
import makeStyles from '@mui/styles/makeStyles';

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
  const [wheelFactor, setWheelFactor] = useMouseWheelFactor();

  // Handler to update the wheelFactor state
  const handleSliderChange = (_event: Event, newValue: number | number[]) => {
    setWheelFactor(newValue as number);
  };

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
      <Toolbar className={classes.header}>
        <Typography variant="h6" display="inline" className={classes.smaller}>
          Course Timezone
        </Typography>
      </Toolbar>
      <Box className={classes.settings}>
        <TimezoneSelector />
      </Box>
      <Toolbar className={classes.header}>
        <Typography variant="h6" display="inline" className={classes.smaller}>
          Mouse Wheel Factor
        </Typography>
      </Toolbar>
      <Box className={classes.settings}>
        <Box display="flex" alignItems="center">
          <Typography variant="body1" mr={2}>
            {wheelFactor}
          </Typography>
          <Slider
            min={1}
            max={200}
            value={wheelFactor}
            onChange={handleSliderChange}
            aria-labelledby="wheel-factor-slider"
          />
        </Box>
      </Box>
      <Toolbar className={classes.header}>
        <Typography variant="h6" display="inline" className={classes.smaller}>
          Course Configuration
        </Typography>
      </Toolbar>
      <Box className={classes.settings}>
        <FormControlLabel
          labelPlacement="end"
          label="Lane is below guide line"
          control={
            <Checkbox
              checked={videoSettings.laneBelowGuide}
              onChange={() => {
                setVideoSettings(
                  {
                    ...videoSettings,
                    laneBelowGuide: !videoSettings.laneBelowGuide,
                  },
                  true
                );
                saveVideoSidecar();
              }}
            />
          }
        />
      </Box>
      <Toolbar className={classes.header}>
        <Typography variant="h6" display="inline" className={classes.smaller}>
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
          <Button variant="outlined" size="small" onClick={() => resetGuides()}>
            Reset Finish
          </Button>
        </Stack>
        <Box>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((lane) => (
            <FormControlLabel
              key={lane}
              labelPlacement="end"
              label={`Lane ${lane}`}
              control={
                <Checkbox
                  checked={videoSettings.guides[lane + 1].enabled}
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
    content: <VideoSettingsDialog />,
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
