import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tooltip,
} from '@mui/material';
import { useHyperZoomFactor } from '../video/VideoSettings';

const HyperZoomSelector = () => {
  const [resolution, setResolution] = useHyperZoomFactor();

  const handleChange = (event: SelectChangeEvent<number | string>) => {
    setResolution(event.target.value as number);
  };

  return (
    <Tooltip title="Timestamp resolution when zooming video" placement="right">
      <FormControl
        sx={{ marginTop: '0.5em', marginBottom: '0.5em', minWidth: 160 }}
        margin="dense"
        size="small"
      >
        <InputLabel id="hyperzoom-resolution-label">
          Hyperzoom Resolution
        </InputLabel>
        <Select
          labelId="hyperzoom-resolution-label"
          value={resolution}
          label="Hyperzoom Resolution"
          onChange={handleChange}
        >
          <MenuItem value={0}>Native Video</MenuItem>
          <MenuItem value={8}>8ms</MenuItem>
          <MenuItem value={5}>5ms</MenuItem>
          <MenuItem value={4}>4ms</MenuItem>
          <MenuItem value={2}>2ms</MenuItem>
          <MenuItem value={1}>1ms</MenuItem>
        </Select>
      </FormControl>
    </Tooltip>
  );
};

export default HyperZoomSelector;
