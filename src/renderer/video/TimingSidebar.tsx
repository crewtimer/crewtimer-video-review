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
  IconButton,
  Menu,
  Tooltip,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DataGrid, {
  CellClickArgs,
  CellMouseEvent,
  Column,
  DataGridHandle,
  RenderHeaderCellProps,
} from 'react-data-grid';
import {
  getSortPlace,
  setVideoBow,
  usePlaceSort,
  useVideoBow,
  useVideoEvent,
  useVideoTimestamp,
} from './VideoSettings';
import { Entry, Event, KeyMap, Lap } from 'crewtimer-common';
import {
  getWaypoint,
  useDay,
  useMobileConfig,
  useTabPosition,
  useWaypoint,
} from 'renderer/util/UseSettings';
import {
  getEntryResult,
  setEntryResultAndPublish,
  useEntryResult,
} from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import uuidgen from 'short-uuid';
import { UseDatum } from 'react-usedatum';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import makeStyles from '@mui/styles/makeStyles';
import { seekToTimestamp } from './VideoFileUtils';

const useStyles = makeStyles((_theme) => ({
  row: {
    background: '#556cd6',
  },
}));

interface RowType {
  id: string;
  eventName: string;
  eventNum: string;
  label: string;
  Bow: string;
  Time: string;
  event: Event;
  entry?: Entry;
}

const [useRenderRequired, setRenderRequired, getRenderRequired] = UseDatum(0);

const timingFontSize = 12;

const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: RowType;
} | null>(null);

const TimestampCell = ({ row }: { row: RowType }) => {
  const [lap] = useEntryResult(row.id);
  const time = lap?.State === 'Deleted' ? '' : lap?.Time || '';
  const timeChange = time !== row.Time;

  // Re-render the parent component if the time changes
  useEffect(() => {
    if (timeChange && getSortPlace()) {
      setRenderRequired(getRenderRequired() + 1);
    }
  }, [timeChange && getSortPlace()]);

  const handleMenu: React.MouseEventHandler<HTMLDivElement> = (event) => {
    setContextMenuAnchor({ element: event.currentTarget, row });
  };

  return (
    <Stack direction="row">
      <Typography
        sx={{
          width: 80,
          paddingLeft: '0.5em',
          fontSize: timingFontSize,
          lineHeight: '24px',
        }}
      >
        {time}
      </Typography>
      {row.eventName || !time ? (
        <></>
      ) : (
        <div onClick={handleMenu}>
          <IconButton
            color="inherit"
            size="small"
            sx={{
              minWidth: 14,
              width: 14,
              padding: 0,
              margin: 0,
            }}
          >
            <MoreVertIcon
              sx={{
                fontSize: 14,
                padding: 0,
                margin: 0,
              }}
            />
          </IconButton>
        </div>
      )}
    </Stack>
  );
};
const TimestampCol = ({ row }: { row: RowType }) => {
  return row.eventName ? (
    <Typography
      sx={{
        color: 'white',
        paddingLeft: '0.5em',
        fontSize: timingFontSize,
        lineHeight: '24px',
      }}
    >
      {row.event.Start || ''}
    </Typography>
  ) : (
    <TimestampCell row={row} />
  );
};

export const RenderHeaderCell: React.FC<RenderHeaderCellProps<RowType>> = ({
  column,
}) => {
  const [placeSort, setPlaceSort] = usePlaceSort();
  return (
    <Stack direction="row" onClick={() => setPlaceSort(!placeSort)}>
      <Typography
        sx={{
          paddingLeft: '0.5em',
          fontSize: '14px',
          fontWeight: 'bold',
        }}
      >
        {column.name}
      </Typography>
      <Typography
        sx={{
          paddingLeft: '0.5em',
          fontSize: '12px',
          marginTop: '2px',
        }}
      >
        {placeSort ? 'time ▲' : '▲'}
      </Typography>
    </Stack>
  );
};

export const RenderTimeHeaderCell: React.FC<RenderHeaderCellProps<RowType>> = ({
  column,
}) => {
  return (
    <Typography
      sx={{
        paddingLeft: '0.5em',
        fontSize: '14px',
        fontWeight: 'bold',
      }}
    >
      {column.name}
    </Typography>
  );
};
const columns = (width: number): readonly Column<RowType>[] => {
  const col2Width = 80 + 14 + 16;
  const col1Width = width - col2Width - 20;
  return [
    {
      key: 'label',
      name: 'Entry',
      width: col1Width,
      renderHeaderCell: RenderHeaderCell,
      renderCell: ({ row }: { row: RowType }) => {
        return (
          <Typography
            sx={
              row.eventName
                ? {
                    color: 'white',
                    paddingLeft: '0.5em',
                    fontSize: timingFontSize,
                    lineHeight: '24px',
                  }
                : {
                    paddingLeft: '0.5em',
                    fontSize: timingFontSize,
                    lineHeight: '24px',
                  }
            }
          >
            {row.label}
          </Typography>
        );
      },
    },
    {
      key: 'ts',
      name: 'Time',
      width: col2Width,
      renderCell: TimestampCol,
      renderHeaderCell: RenderTimeHeaderCell,
    },
  ];
};

//
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
      sx={{
        fontSize: timingFontSize,
        lineHeight: timingFontSize,
      }}
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
      sx={{
        fontSize: timingFontSize,
        lineHeight: timingFontSize,
      }}
    />
  );
};

const AddSplitButton: React.FC<{ activeEvents: Event[] }> = ({
  activeEvents,
}) => {
  const [videoBow] = useVideoBow();
  const [videoTimestamp] = useVideoTimestamp();
  const [selectedEvent] = useVideoEvent();
  const [waypoint] = useWaypoint();
  const [mobileConfig] = useMobileConfig();
  const gate = gateFromWaypoint(waypoint);

  const onAddSplit = () => {
    // FIXME - convert waypoint to G_
    const bow = videoBow; // FIXME isSprintStart ? : '*' : videoBow;
    let entry: Entry | undefined;
    for (const event of activeEvents) {
      entry = event.eventItems.find((item) => item.Bow === bow);
      if (entry) {
        break;
      }
    }

    if (!entry) {
      setDialogConfig({
        title: `Not in schedule`,
        message: `Entry '${bow}' is not in schedule for event '${selectedEvent}'.  Add anyway??`,
        button: 'Add',
        showCancel: true,
        handleConfirm: () => {
          delete lap.State;
          setEntryResultAndPublish(key, lap);
        },
      });
      return;
    }

    const key = `${gate}_${entry.EventNum}_${bow}`;
    const priorLap = getEntryResult(key);
    const lap: Lap = {
      keyid: key,
      uuid: priorLap?.uuid || uuidgen.generate(),
      SequenceNum: priorLap?.SequenceNum || 0,
      Bow: bow,
      Time: videoTimestamp,
      EventNum: entry.EventNum,
      Gate: gate,
      Crew: '',
      CrewAbbrev: '',
      Event: '',
      EventAbbrev: '',
      AdjTime: '',
      Place: 0,
      Stroke: '',
    };
    if (priorLap && priorLap.State !== 'Deleted') {
      setDialogConfig({
        title: `Time Already Recorded`,
        message: `A time has already been recorded for bow ${videoBow}.  OK to replace?`,
        button: 'Replace',
        showCancel: true,
        handleConfirm: () => {
          delete lap.State;
          setEntryResultAndPublish(key, lap);
        },
      });
      return;
    }
    if (!mobileConfig) {
      return;
    }

    // if (entry.isSprintStart) {

    // }

    setEntryResultAndPublish(key, lap);
  };
  return (
    <Button
      disabled={!videoBow || !videoTimestamp || !selectedEvent}
      size="small"
      variant="contained"
      color="success"
      sx={{ margin: '0.5em', marginTop: 0, marginBottom: '1em' }}
      onClick={onAddSplit}
    >
      Add Split
    </Button>
  );
};

const ContextMenu: React.FC = () => {
  const [anchorEl] = useContextMenuAnchor();
  const handleClose = () => {
    setContextMenuAnchor(null);
  };
  const onDelete = () => {
    handleClose();
    const row = anchorEl?.row;
    if (!row || !row.entry) {
      return;
    }
    const lap = getEntryResult(row.id);
    if (lap) {
      setDialogConfig({
        title: `Delete Time`,
        message: `OK to delete time ${lap.Time} for Bow ${lap.Bow}?`,
        button: 'Delete',
        showCancel: true,
        handleConfirm: () => {
          lap.State = 'Deleted';
          setEntryResultAndPublish(lap.keyid, lap);
        },
      });
    }
  };
  return (
    <Menu
      id="row-context-menu"
      anchorEl={anchorEl?.element}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      keepMounted
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      open={anchorEl !== null}
      onClose={handleClose}
    >
      <MenuItem onClick={onDelete}>Delete</MenuItem>
    </Menu>
  );
};

const generateEventRows = (
  gate: string,
  event: Event | undefined,
  includeEventName: boolean,
  includeEntries: boolean
) => {
  const rows: RowType[] = [];
  if (!event) {
    return rows;
  }
  if (includeEventName) {
    rows.push({
      id: event.EventNum,
      eventName: event.Event,
      eventNum: event.EventNum,
      label: `E${event.Event}`,
      Bow: '',
      Time: '',
      event,
    });
  }
  if (includeEntries) {
    event.eventItems.forEach((entry) => {
      const key = `${gate}_${event.EventNum}_${entry?.Bow}`;
      const lap = getEntryResult(key);
      // console.log(
      //   `rendering timestamp cell for ${key} value=${JSON.stringify(entry)}`
      // );
      const Time = lap?.State === 'Deleted' ? '' : lap?.Time || '';

      rows.push({
        id: `${key}`,
        eventName: '',
        eventNum: event.EventNum,
        label: `${entry.Bow} ${entry.Crew}`,
        Bow: entry.Bow,
        Time,
        event,
        entry,
      });
    });
  }
  return rows;
};
interface MyComponentProps {
  width: number;
  height: number;
  sx?: SxProps<Theme>;
}

const TimingSidebar: React.FC<MyComponentProps> = ({ sx, height, width }) => {
  const classes = useStyles();
  const [mobileConfig] = useMobileConfig();
  const [day] = useDay();
  const [waypoint] = useWaypoint();
  const [placeSort] = usePlaceSort();
  let [selectedEvent, setSelectedEvent] = useVideoEvent();
  const datagridRef = useRef<DataGridHandle | null>(null);
  const [, setTabPosition] = useTabPosition();
  useRenderRequired();

  const gate = gateFromWaypoint(waypoint);
  const { rows, filteredEvents } = useMemo(() => {
    let filteredEvents = mobileConfig?.eventList || [];
    if (day) {
      filteredEvents = filteredEvents.filter((event) => event.Day === day);
    }

    const filteredRows: RowType[] = [];
    filteredEvents.forEach((event) => {
      generateEventRows(gate, event, true, false).forEach((row) => {
        filteredRows.push(row);
      });
    });
    return { rows: filteredRows, filteredEvents };
  }, [mobileConfig?.eventList, day]);

  let activeEvent = filteredEvents.find(
    (event) => event.EventNum === selectedEvent
  );
  if (activeEvent === undefined && filteredEvents.length > 0) {
    activeEvent = filteredEvents[0];
    if (activeEvent !== undefined) {
      const newSelectedEvent = activeEvent;
      setTimeout(() => setSelectedEvent(newSelectedEvent.EventNum), 10);
    }
  }

  const combined = mobileConfig?.info?.CombinedRaces || '{}';
  const combinedRaces = JSON.parse(combined) as KeyMap<string[]>;
  const combinedList = combinedRaces[selectedEvent] || [selectedEvent];
  const columnConfig = useMemo(() => columns(width), []);
  const activeEvents: Event[] = [];
  combinedList.forEach((eventNum) => {
    const event = filteredEvents.find((event) => event.EventNum === eventNum);
    if (event) {
      activeEvents.push(event);
    }
  });

  const activeEventRows = activeEvents
    .map((event) => generateEventRows(gate, event, false, true))
    .flat();
  if (placeSort) {
    activeEventRows.sort((a, b) =>
      (a.Time || '99:99:99.999').localeCompare(
        b.Time || '99:99:99.999',
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        }
      )
    );
  }

  const onRowClick = (
    args: CellClickArgs<RowType, unknown>,
    _event: CellMouseEvent
  ) => {
    setSelectedEvent(args.row.eventNum);
    if (args.row.Bow) {
      setVideoBow(args.row.Bow);

      // if we have a time for this entry, try and seek there
      const key = `${gateFromWaypoint(getWaypoint())}_${
        args.row.entry?.EventNum
      }_${args.row.entry?.Bow}`;
      const entry = getEntryResult(key);
      if (entry?.Time && entry?.State !== 'Deleted') {
        seekToTimestamp(entry.Time, true);
      }
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

  const prevEvent = () => {
    const index = filteredEvents.findIndex(
      (event) => event.EventNum === selectedEvent
    );
    if (index > 0) {
      setSelectedEvent(filteredEvents[index - 1].EventNum);
    }
  };

  const nextEvent = () => {
    const index = filteredEvents.findIndex(
      (event) => event.EventNum === selectedEvent
    );
    if (index !== -1 && index < filteredEvents.length - 1) {
      setSelectedEvent(filteredEvents[index + 1].EventNum);
    }
  };

  const activeEventIndex = filteredEvents.findIndex(
    (event) => event.EventNum === selectedEvent
  );

  if (!mobileConfig) {
    return (
      <Tooltip title="A CrewTimer regatta must be configured to use timing features.">
        <Button
          size="small"
          variant="contained"
          sx={{
            margin: '0.5em',
            marginTop: 0,
            marginBottom: '1em',
            height: '36px',
          }}
          onClick={() => setTabPosition('System Config')}
        >
          Connect CrewTimer
        </Button>
      </Tooltip>
    );
  }

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
      <AddSplitButton activeEvents={activeEvents} />
      <Stack direction="row" alignItems="center">
        <VideoBow />
        <VideoTimestamp />
      </Stack>
      <Stack direction="row" alignItems="center">
        <Button
          disabled={activeEventIndex === 0}
          variant="contained"
          onClick={prevEvent}
          size="small"
          sx={{
            height: 24,
            // m: 0,
            minWidth: 24,
          }}
        >
          &lt;
        </Button>
        <FormControl
          fullWidth
          sx={{
            marginLeft: '0.5em',
            marginRight: '0.5em',
          }}
          margin="dense"
          size="small"
        >
          <InputLabel id="event-select-label" sx={{ fontSize: timingFontSize }}>
            Event
          </InputLabel>
          <Select
            labelId="event-select-label"
            id="event-select"
            label="Event"
            value={selectedEvent}
            onChange={onEventChange}
            sx={{ fontSize: timingFontSize }}
          >
            {filteredEvents.map((event) => (
              <MenuItem key={event.EventNum} value={event.EventNum}>
                {`${event.Event}${event.Start ? ` (${event.Start})` : ''}`}
              </MenuItem>
            ))}
            {/* Add more MenuItems here */}
          </Select>
        </FormControl>
        <Button
          disabled={activeEventIndex === filteredEvents.length - 1}
          variant="contained"
          onClick={nextEvent}
          size="small"
          sx={{
            height: 24,
            m: 0,
            minWidth: 24,
          }}
        >
          &gt;
        </Button>
      </Stack>
      <ContextMenu />
      <div style={{ flexGrow: 'auto' }}>
        <DataGrid
          columns={columnConfig}
          rows={activeEventRows}
          onCellClick={onRowClick}
          rowHeight={24}
          rowClass={(row) => (row.eventName ? classes.row : undefined)}
          style={{ height: height - 138 }}
        />
      </div>
    </Paper>
  );
};

export default TimingSidebar;
