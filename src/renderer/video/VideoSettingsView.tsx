import {
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  SxProps,
  Theme,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Settings';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import { useVideoSettings } from './VideoSettings';
import { useEnableVideoTiming } from 'renderer/util/UseSettings';

const VideoSettingsDialog: React.FC = () => {
  const [videoSettings, setVideoSettings] = useVideoSettings();
  const [enableVideoTiming, setEnableVideoTiming] = useEnableVideoTiming();
  return (
    <Box>
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
        label="Video"
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
      <Typography>Course Configuration</Typography>
      <FormControlLabel
        labelPlacement="end"
        label="Lane 1 top"
        control={
          <Checkbox
            checked={videoSettings.lane1Top}
            onChange={() => {
              setVideoSettings(
                { ...videoSettings, lane1Top: !videoSettings.lane1Top },
                true
              );
            }}
          />
        }
      />
      <FormControlLabel
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
      />
      <Typography>Guide Visibility</Typography>
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

const VideoSettingsView: React.FC<VideoSettingsViewProps> = ({ sx }) => {
  const handleSettings = () => {
    setDialogConfig({
      title: `Video Settings`,
      message: ``,
      content: <VideoSettingsDialog />,
      button: 'Done',
      showCancel: false,
    });
  };
  return (
    <Box onClick={handleSettings} sx={sx}>
      <IconButton onClick={handleSettings} color="inherit" size="medium">
        <MenuIcon />
      </IconButton>
      Settings
    </Box>
  );
};

export default VideoSettingsView;
