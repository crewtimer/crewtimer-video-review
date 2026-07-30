import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tooltip,
} from '@mui/material';
import { useInterpolationTechnique } from '../video/VideoSettings';

const isMac = window.platform.platform === 'darwin';

const InterpolationTechniqueSelector = () => {
  const [technique, setTechnique] = useInterpolationTechnique();

  const handleChange = (event: SelectChangeEvent<string>) => {
    setTechnique(event.target.value as 'blend' | 'rife');
  };

  return (
    <Tooltip
      title="Technique used to synthesize frames between two decoded video frames"
      placement="right"
    >
      <FormControl
        sx={{ marginTop: '0.5em', marginBottom: '0.5em', minWidth: 160 }}
        margin="dense"
        size="small"
      >
        <InputLabel id="interpolation-technique-label">
          Frame Interpolation
        </InputLabel>
        <Select
          labelId="interpolation-technique-label"
          value={technique}
          label="Frame Interpolation"
          onChange={handleChange}
        >
          <MenuItem value="blend">Classic (shift &amp; blend)</MenuItem>
          <MenuItem value="rife" disabled={!isMac}>
            RIFE (AI){!isMac ? ' – macOS only' : ''}
          </MenuItem>
        </Select>
      </FormControl>
    </Tooltip>
  );
};

export default InterpolationTechniqueSelector;
