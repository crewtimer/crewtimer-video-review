import React, { useEffect, useMemo, useRef } from 'react';
import {
  TextField,
  FormControl,
  InputLabel,
  Paper,
  Select,
  MenuItem,
  SxProps,
  Theme,
  Typography,
  SelectChangeEvent,
  Button,
  Stack,
} from '@mui/material';

import DataGrid, {
  CellClickArgs,
  CellMouseEvent,
  Column,
  DataGridHandle,
} from 'react-data-grid';
import {
  setVideoBow,
  useVideoBow,
  useVideoEvent,
  useVideoTimestamp,
} from './VideoSettings';
import { Event } from 'crewtimer-common';
import { useDay, useMobileConfig } from 'renderer/util/UseSettings';

interface RowType {
  id: string;
  eventName: string;
  eventNum: string;
  label: string;
  Bow: string;
  event: Event;
}
const columns: readonly Column<RowType>[] = [
  {
    key: 'label',
    name: 'Schedule',
    width: 400 - 110 - 16,
    renderCell: ({ row }) => (
      <Typography
        sx={
          row.eventName
            ? {
                background: '#556cd6', // '#2e7d32'
                color: 'white',
                paddingLeft: '0.5em',
                fontSize: 12,
                lineHeight: '24px',
              }
            : {
                paddingLeft: '0.5em',
                fontSize: 12,
                lineHeight: '24px',
              }
        }
      >
        {row.label}
      </Typography>
    ),
  },
  {
    key: 'ts',
    name: 'Timestamp',
    width: 110,
    renderCell: ({ row }) => (
      <Typography
        sx={{ paddingLeft: '0.5em', fontSize: 12, lineHeight: '24px' }}
      >
        00:00:00.000
      </Typography>
    ),
  },
];

const VideoTimestamp: React.FC = () => {
  const [videoTimestamp, setVideoTimestamp] = useVideoTimestamp();
  return (
    <TextField
      label="Time"
      variant="outlined"
      size="small"
      value={videoTimestamp}
      onChange={(event) => {
        setVideoTimestamp(event.target.value);
      }}
      sx={{ marginBottom: 2, fontSize: 12, lineHeight: 12 }}
    />
  );
};

const VideoBow: React.FC = () => {
  const [videoBow, setVideoBow] = useVideoBow();
  return (
    <TextField
      label="Bow"
      variant="outlined"
      size="small"
      value={videoBow}
      onChange={(event) => {
        setVideoBow(event.target.value);
      }}
      sx={{ marginBottom: 2, fontSize: 12, lineHeight: 12 }}
    />
  );
};
interface MyComponentProps {
  sx?: SxProps<Theme>;
}

const TimingSidebar: React.FC<MyComponentProps> = ({ sx }) => {
  const [mobileConfig] = useMobileConfig();
  const [day] = useDay();
  const [selectedEvent, setSelectedEvent] = useVideoEvent();
  const datagridRef = useRef<DataGridHandle | null>(null);

  const { rows } = useMemo(() => {
    const rows: RowType[] = [];
    mobileConfig?.eventList.forEach((event) => {
      if (day && event.Day !== day) {
        return;
      }

      rows.push({
        id: event.EventNum,
        eventName: event.Event,
        eventNum: event.EventNum,
        label: event.Event,
        Bow: '',
        event,
      });
      event.eventItems.forEach((entry) => {
        rows.push({
          id: `${event.EventNum}-${entry.Bow}`,
          eventName: '',
          eventNum: event.EventNum,
          label: `${entry.Bow} ${entry.Crew}`,
          Bow: entry.Bow,
          event,
        });
      });
    });
    return { rows };
  }, [mobileConfig?.eventList, day]);

  const onRowClick = (
    args: CellClickArgs<RowType, unknown>,
    _event: CellMouseEvent
  ) => {
    setSelectedEvent(args.row.eventNum);
    if (args.row.Bow) {
      setVideoBow(args.row.Bow);
    }
  };

  const scrollToEvent = (eventNum: string) => {
    let eventRow = rows.findIndex((row) => row.eventNum === eventNum);
    if (eventRow < 0 && rows.length > 0) {
      eventRow = 0;
    }
    if (eventRow >= 0) {
      setSelectedEvent(eventNum);
      datagridRef.current?.scrollToCell({
        rowIdx: Math.min(
          rows.length - 1,
          eventRow // + Math.min(rows[eventRow].event.eventItems.length, 10)
        ),
        idx: 0,
      });
    }
  };

  useEffect(() => scrollToEvent(selectedEvent), [selectedEvent]);

  const onEventChange = (event: SelectChangeEvent<string>) => {
    setSelectedEvent(event.target.value);
  };

  return (
    <Paper
      sx={{
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: '8px',
        paddingRight: '8px',
        maxWidth: '100%',
        ...sx,
      }}
    >
      <Stack direction="row">
        <VideoBow />
        <VideoTimestamp />
      </Stack>
      <FormControl
        fullWidth
        sx={{ marginBottom: 2 }}
        margin="dense"
        size="small"
      >
        <InputLabel id="event-select-label" sx={{ fontSize: 12 }}>
          Event
        </InputLabel>
        <Select
          labelId="event-select-label"
          id="event-select"
          label="Event"
          value={selectedEvent}
          onChange={onEventChange}
          sx={{ fontSize: 12 }}
        >
          {mobileConfig?.eventList.map((event) => (
            <MenuItem key={event.EventNum} value={event.EventNum}>
              {event.Event}
            </MenuItem>
          ))}
          {/* Add more MenuItems here */}
        </Select>
      </FormControl>
      <Button
        size="small"
        variant="contained"
        color="success"
        sx={{ margin: '0.5em' }}
      >
        Add Split
      </Button>
      <div style={{ flexGrow: 'auto' }}>
        <DataGrid
          ref={datagridRef}
          columns={columns}
          rows={rows}
          onCellClick={onRowClick}
          rowHeight={24}
        />
      </div>
    </Paper>
  );
};

export default TimingSidebar;
