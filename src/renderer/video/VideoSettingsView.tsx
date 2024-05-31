import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Stack,
  SxProps,
  Theme,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Settings';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import { useMouseWheelFactor, useVideoSettings } from './VideoSettings';
import {
  useEnableVideoTiming,
  useMobileConfig,
} from 'renderer/util/UseSettings';
import TimezoneSelector from 'renderer/util/TimezoneSelector';
import { saveVideoSidecar } from './VideoUtils';

const VideoSettingsDialog: React.FC = () => {
  const [videoSettings, setVideoSettings] = useVideoSettings();
  const [enableVideoTiming, setEnableVideoTiming] = useEnableVideoTiming();
  const [mc] = useMobileConfig();
  const [wheelFactor, setWheelFactor] = useMouseWheelFactor();

  // Handler to update the wheelFactor state
  const handleSliderChange = (_event: Event, newValue: number | number[]) => {
    setWheelFactor(newValue as number);
  };

  const onTimingHintSourceChange = (event: SelectChangeEvent) => {
    setVideoSettings(
      { ...videoSettings, timingHintSource: event.target.value },
      true
    );
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
    <Box>
      <Typography>Timing Hint Source</Typography>
      <FormControl
        sx={{ marginTop: '0.5em', marginBottom: '0.5em', minWidth: 200 }}
        margin="dense"
        size="small"
      >
        <InputLabel id="hint-select-label">Waypoint</InputLabel>
        <Select
          labelId="hint-select-label"
          id="hint-select"
          value={videoSettings.timingHintSource}
          label="Waypoint"
          onChange={onTimingHintSourceChange}
        >
          {waypointList.map((waypoint) => (
            <MenuItem key={waypoint} value={waypoint}>
              {waypoint}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Divider />
      <Typography>Visible Panels</Typography>

      <FormControlLabel
        labelPlacement="end"
        label="Timing"
        control={
          <Checkbox
            checked={enableVideoTiming}
            onChange={() => {
              setEnableVideoTiming((current) => !current);
            }}
          />
        }
      />
      <FormControlLabel
        labelPlacement="end"
        label="Video Files"
        control={
          <Checkbox
            checked={videoSettings.videoPanel}
            onChange={() => {
              setVideoSettings(
                { ...videoSettings, videoPanel: !videoSettings.videoPanel },
                true
              );
            }}
          />
        }
      />
      <Divider />
      <Typography>Course Timezone</Typography>
      <TimezoneSelector />
      <Divider />
      <Typography>Mouse Wheel Factor</Typography>
      <Box>
        <Box display="flex" alignItems="center">
          <Typography variant="body1" mr={2}>
            {wheelFactor}
          </Typography>
          <Slider
            min={1}
            max={20}
            value={wheelFactor}
            onChange={handleSliderChange}
            aria-labelledby="wheel-factor-slider"
          />
        </Box>
      </Box>
      <Divider />
      <Typography>Course Configuration</Typography>
      <FormControlLabel
        labelPlacement="end"
        label="Lane below guide line"
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
      {/* <FormControlLabel
        labelPlacement="end"
        label="Travel Right to Left"
        control={
          <Checkbox
            checked={videoSettings.travelRtoL}
            onChange={() => {
              setVideoSettings(
                {
                  ...videoSettings,
                  travelRtoL: !videoSettings.travelRtoL,
                },
                true
              );
            }}
          />
        }
      /> */}
      <Divider />
      <Typography>Guide Visibility</Typography>
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
