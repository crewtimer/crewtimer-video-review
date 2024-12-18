import React from 'react';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
} from '@mui/material';
import moment from 'moment-timezone';
import { UseDatum } from 'react-usedatum';

export const [useTimezoneOffset, setTimezoneOffset, getTimezoneOffset] =
  UseDatum<number>(-new Date().getTimezoneOffset());
export const [useTimezone, setTimezone, getTimezone] = UseDatum<string>(
  '',
  (newValue) => {
    let currentOffsetMinutes;
    if (newValue) {
      const tzDetails = moment.tz.zone(newValue);
      // Get the current offset in minutes for the specified timezone
      currentOffsetMinutes = tzDetails?.utcOffset(moment().valueOf());
    }

    if (currentOffsetMinutes === undefined) {
      // If the timezone is not set, default to the local timezone
      currentOffsetMinutes = new Date().getTimezoneOffset();
    }

    // Store as an offset that can be added to UTC to get local time
    setTimezoneOffset(-currentOffsetMinutes);
  },
);

const TimezoneSelector: React.FC = () => {
  let [timezone] = useTimezone();
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
