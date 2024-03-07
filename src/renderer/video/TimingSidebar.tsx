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
  setVideoBow,
  useVideoBow,
  useVideoEvent,
  useVideoTimestamp,
} from './VideoSettings';
import { Entry, Event, Lap } from 'crewtimer-common';
import {
  getWaypoint,
  useDay,
  useMobileConfig,
  useWaypoint,
} from 'renderer/util/UseSettings';
import {
  dumpEntryResults,
  getEntryResult,
  setEntryResult,
  useEntryResult,
} from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import uuidgen from 'short-uuid';
import { UseDatum } from 'react-usedatum';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import makeStyles from '@mui/styles/makeStyles';

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
  event: Event;
  entry?: Entry;
}

const timingFontSize = 12;

const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: RowType;
} | null>(null);

const TimestampCell = ({ row }: { row: RowType }) => {
  const key = `${gateFromWaypoint(getWaypoint())}_${row.entry?.EventNum}_${
    row.entry?.Bow
  }`;
  const [entry] = useEntryResult(key);
  const time = entry?.State === 'Deleted' ? '' : entry?.Time || '';
  const handleMenu: React.MouseEventHandler<HTMLDivElement> = (event) => {
    setContextMenuAnchor({ element: event.currentTarget, row });
  };
  return (
    <Stack direction="row" onClick={handleMenu}>
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
      )}
    </Stack>
  );
};
export const RenderHeaderCell: React.FC<RenderHeaderCellProps<RowType>> = ({
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
const columns: readonly Column<RowType>[] = [
  {
    key: 'label',
    name: 'Schedule',
    renderHeaderCell: RenderHeaderCell,
    renderCell: ({ row }) => {
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
    name: 'Timestamp',
    width: 80 + 14 + 16,
    renderCell: TimestampCell,
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
      sx={{
        marginBottom: 2,
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
        marginBottom: 2,
        fontSize: timingFontSize,
        lineHeight: timingFontSize,
      }}
    />
  );
};

const AddSplitButton: React.FC = () => {
  const [videoBow] = useVideoBow();
  const [videoTimestamp] = useVideoTimestamp();
  const [selectedEvent] = useVideoEvent();
  const [waypoint] = useWaypoint();
  const [mobileConfig] = useMobileConfig();
  const gate = gateFromWaypoint(waypoint);

  const onAddSplit = () => {
    // FIXME - convert waypoint to G_
    const key = `${gate}_${selectedEvent}_${videoBow}`;
    const bow = videoBow; // FIXME isSprintStart ? : '*' : videoBow;
    const priorLap = getEntryResult(key);
    const lap: Lap = {
      keyid: key,
      uuid: priorLap?.uuid || uuidgen.generate(),
      SequenceNum: priorLap?.SequenceNum || 0,
      Bow: bow,
      Time: videoTimestamp,
      EventNum: selectedEvent,
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
          setEntryResult(key, lap);
        },
      });
      return;
    }
    if (!mobileConfig) {
      return;
    }
    for (let i = 0; i < mobileConfig.eventList.length; i++) {
      if (mobileConfig.eventList[i].EventNum !== selectedEvent) {
        continue;
      }
      const entry = mobileConfig.eventList[i].eventItems.find(
        (item) => item.Bow === bow
      );
      if (!entry) {
        setDialogConfig({
          title: `Not in schedule`,
          message: `Entry '${bow}' is not in schedule for event '${selectedEvent}'.  Add anyway??`,
          button: 'Add',
          showCancel: true,
          handleConfirm: () => {
            delete lap.State;
            setEntryResult(key, lap);
          },
        });
        return;
      }
      break;
    }

    setEntryResult(key, lap);
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
    dumpEntryResults();
    handleClose();
    const row = anchorEl?.row;
    if (!row || !row.entry) {
      return;
    }
    const lap = getEntryResult(row.id);
    if (lap) {
      lap.State = 'Deleted';
      setEntryResult(lap.keyid, lap);
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
interface MyComponentProps {
  height: number;
  sx?: SxProps<Theme>;
}

const TimingSidebar: React.FC<MyComponentProps> = ({ sx, height }) => {
  const classes = useStyles();
  const [mobileConfig] = useMobileConfig();
  const [day] = useDay();
  const [waypoint] = useWaypoint();
  const [selectedEvent, setSelectedEvent] = useVideoEvent();
  const datagridRef = useRef<DataGridHandle | null>(null);

  const gate = gateFromWaypoint(waypoint);
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
          id: `${gate}_${event.EventNum}_${entry.Bow}`,
          eventName: '',
          eventNum: event.EventNum,
          label: `${entry.Bow} ${entry.Crew}`,
          Bow: entry.Bow,
          event,
          entry,
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
        sx={{ marginTop: 0, marginBottom: '0.5em' }}
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
          {mobileConfig?.eventList.map((event) => (
            <MenuItem key={event.EventNum} value={event.EventNum}>
              {event.Event}
            </MenuItem>
          ))}
          {/* Add more MenuItems here */}
        </Select>
      </FormControl>
      <AddSplitButton />
      <ContextMenu />
      <div style={{ flexGrow: 'auto' }}>
        <DataGrid
          ref={datagridRef}
          columns={columns}
          rows={rows}
          onCellClick={onRowClick}
          rowHeight={24}
          rowClass={(row) => (row.eventName ? classes.row : undefined)}
          style={{ height: height - 150 }}
        />
      </div>
    </Paper>
  );
};

export default TimingSidebar;
