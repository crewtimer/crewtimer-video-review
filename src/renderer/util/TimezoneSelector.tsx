import React from 'react';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
} from '@mui/material';
import moment from 'moment-timezone';
import { useTimezone } from 'renderer/video/VideoSettings';

const TimezoneSelector: React.FC = () => {
  let [timezone, setTimezone] = useTimezone();
  if (!timezone) {
    timezone = moment.tz.guess();
  }

  const handleTimezoneChange = (event: SelectChangeEvent) => {
    setTimezone(event.target.value as string);
  };

  return (
    <FormControl
      sx={{ marginTop: '0.5em', marginBottom: '0.5em' }}
      margin="dense"
      size="small"
    >
      <InputLabel id="timezone-select-label">Timezone</InputLabel>
      <Select
        labelId="timezone-select-label"
        id="timezone-select"
        value={timezone}
        label="Timezone"
        onChange={handleTimezoneChange}
      >
        {moment.tz.names().map((tz) => (
          <MenuItem key={tz} value={tz}>
            {tz}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export default TimezoneSelector;
