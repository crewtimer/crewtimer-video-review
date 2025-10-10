/* eslint-disable prefer-destructuring */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable react/jsx-no-useless-fragment */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  TextField,
  FormControl,
  InputLabel,
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
  ToggleButton,
  ToggleButtonGroup,
  Box,
} from '@mui/material';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SortIcon from '@mui/icons-material/Sort';
import DataGrid, {
  CellClickArgs,
  CellMouseEvent,
  Column,
  DataGridHandle,
  RenderHeaderCellProps,
} from 'react-data-grid';
import { Event, KeyMap } from 'crewtimer-common';
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
import { gateFromWaypoint, timeToMilli } from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import makeStyles from '@mui/styles/makeStyles';
import { setToast } from 'renderer/Toast';
import {
  getTimeSort,
  resetVideoZoom,
  ResultRowType,
  setBowInfo,
  setVideoBow,
  setVideoEvent,
  useShowGridView,
  useTimeSort,
  useVideoBow,
  useVideoEvent,
  useVideoTimestamp,
} from './VideoSettings';
import { seekToEvent, seekToTimestamp } from './RequestVideoFrame';
import { performAddSplit } from './AddSplitUtil';
import { useEntryException } from './UseClickerData';

const useStyles = makeStyles((/* _theme */) => ({
  row: {
    background: '#556cd6',
  },
}));
const [useRenderRequired, setRenderRequired, getRenderRequired] = UseDatum(0);
const timingFontSize = 12;
const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: ResultRowType;
} | null>(null);

export const seekToBow = (entry: { EventNum: string; Bow: string }) => {
  setVideoEvent(entry.EventNum);
  if (entry.Bow) {
    setVideoBow(entry.Bow);

    // if we have a time for this entry, try and seek there
    const key = `${gateFromWaypoint(getWaypoint())}_${
      entry?.EventNum
    }_${entry?.Bow}`;
    const lap = getEntryResult(key);
    if (lap?.Time && lap?.State !== 'Deleted') {
      resetVideoZoom();
      const seekTime = lap.Time;
      setTimeout(() => {
        const found = seekToTimestamp({ time: seekTime, bow: lap.Bow });
        if (!found) {
          setToast({
            severity: 'warning',
            msg: 'Associated video file not found',
          });
        }
      }, 100);
    }
  }
};

const TimestampCell = ({ row }: { row: ResultRowType }) => {
  const [lap] = useEntryResult(row.id);
  const time = lap?.State === 'Deleted' ? '' : lap?.Time || '';
  const timeChange = time !== row.Time;

  // Re-render the parent component if the time changes
  const sortByTime = getTimeSort();
  useEffect(() => {
    if (timeChange && sortByTime) {
      setRenderRequired(getRenderRequired() + 1);
    }
  }, [timeChange, sortByTime]);

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
const TimestampCol = ({ row }: { row: ResultRowType }) => {
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

// BowButton: small component for individual bow buttons. Shows exception text (if any)
// and supports compact wrapping when exception text exists.

export const RenderHeaderCell: React.FC<
  RenderHeaderCellProps<ResultRowType>
> = ({ column }) => {
  const [timeSort, setTimeSort] = useTimeSort();
  return (
    <Stack direction="row" onClick={() => setTimeSort(!timeSort)}>
      <Typography
        sx={{
          paddingLeft: '0.5em',
          fontSize: '14px',
          fontWeight: 'bold',
        }}
      >
        {column.name}
      </Typography>
    </Stack>
  );
};

export const RenderTimeHeaderCell: React.FC<
  RenderHeaderCellProps<ResultRowType>
> = ({ column }) => {
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

function sanitizeFirebaseKey(s: string) {
  return s.replace(/[#$/[.\]]/g, '-');
}

// BowButton: small component for individual bow buttons. Shows exception text (if any)
// and supports compact wrapping when exception text exists.
const BowButton: React.FC<{
  gate: string;
  eventNum: string;
  bow: string;
  width: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}> = ({ gate, eventNum, bow, width, buttonRef }) => {
  const [selectedEvent] = useVideoEvent();
  const [videoBow] = useVideoBow();
  // compute derived properties here
  const entryKey = `${gate}_${eventNum}_${bow}`;
  const [lap] = useEntryResult(entryKey);
  const hasTime = !!(lap && lap.State !== 'Deleted' && lap.Time);
  const tooltipTitle = hasTime
    ? `${lap.Time}${lap.Crew ? ` • ${lap.Crew}` : ''}`
    : '';
  const sanitizedKey = sanitizeFirebaseKey(`1-${eventNum}-${bow}`);
  const [exception] = useEntryException(sanitizedKey ?? '');
  const compact = !!exception;
  const isCurrent = String(eventNum) === String(selectedEvent);
  const isSelected = isCurrent && videoBow === bow;

  const sx: any = {
    minWidth: 0,
    width,
    maxWidth: width,
    overflow: 'hidden',
    textOverflow: 'clip',
    whiteSpace: compact ? 'normal' : 'nowrap',
    fontSize: compact ? 10 : undefined,
    lineHeight: compact ? '1.1rem' : undefined,
    padding: 0,
  };

  if (isSelected) {
    // show as a normal primary-colored button when selected and empty
    if (hasTime) {
      sx.backgroundColor = '#9ea6ca';
    } else {
      sx.backgroundColor = 'primary.main';
    }
    sx.color = 'primary.contrastText';
    // remove emphasized border/glow
    sx.border = undefined;
    sx.boxShadow = undefined;
    sx['&:hover'] = {
      backgroundColor: 'primary.dark',
    };
    // if there's an exception, give a light pink background
  } else if (hasTime) {
    sx.backgroundColor = '#ccc';
    sx.color = 'text.secondary';
    sx.opacity = 0.8;
  } else {
    sx.backgroundColor = '#ffffff';
    // if there's an exception, give a light pink background
    if (exception) {
      sx.backgroundColor = '#fdd8';
    }
  }

  return (
    <Tooltip title={tooltipTitle} arrow>
      <Button
        size="small"
        variant={isSelected && hasTime ? 'contained' : 'outlined'}
        sx={sx}
        onClick={() => {
          seekToBow({ Bow: bow, EventNum: eventNum });
        }}
        onContextMenu={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          if (hasTime) {
            // construct a minimal ResultRowType-like object so ContextMenu can act on it
            const row = {
              id: entryKey,
              eventName: '',
              eventNum,
              label: `${bow}`,
              Crew: lap?.Crew || '',
              Bow: bow,
              Time: hasTime ? lap?.Time || '' : '',
              event: undefined,
              entry: { Bow: bow, Crew: lap?.Crew || '', EventNum: eventNum },
            } as unknown as ResultRowType;
            setContextMenuAnchor({ element: e.currentTarget as Element, row });
          }
        }}
        ref={buttonRef}
      >
        <span
          style={{
            display: 'inline-block',
            width: '100%',
            overflow: 'hidden',
            textOverflow: 'clip',
          }}
        >
          {bow}
          {exception ? ` ${exception}` : ''}
        </span>
      </Button>
    </Tooltip>
  );
};

const columns = (width: number): readonly Column<ResultRowType>[] => {
  const col2Width = 80 + 14 + 16;
  const col1Width = width - col2Width - 20;
  const RenderCell = ({ row }: { row: ResultRowType }) => {
    const key = sanitizeFirebaseKey(
      `1-${row.entry?.EventNum}-${row.entry?.Bow}`,
    );
    const [exception] = useEntryException(key);

    return row.eventName ? (
      <Typography
        sx={{
          color: 'white',
          paddingLeft: '0.5em',
          fontSize: timingFontSize,
          lineHeight: '24px',
        }}
      >
        {row.label}
      </Typography>
    ) : (
      <Typography
        sx={{
          paddingLeft: '0.5em',
          fontSize: timingFontSize,
          lineHeight: '24px',
          backgroundColor: exception ? '#fdd' : undefined,
        }}
      >
        {exception
          ? `${row.Bow} ${exception} ${row.Crew}`
          : `${row.Bow} ${row.Crew}`}
      </Typography>
    );
  };
  return [
    {
      key: 'label',
      name: 'Entry',
      width: col1Width,
      renderHeaderCell: RenderHeaderCell,
      renderCell: ({ row }: { row: ResultRowType }) => <RenderCell row={row} />,
    },
    {
      key: 'ts',
      name: 'Time',
      width: col2Width,
      renderCell: ({ row }: { row: ResultRowType }) => (
        <TimestampCol row={row} />
      ),
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
  const [videoBow] = useVideoBow();
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

const AddSplitButton: React.FC = () => {
  const [videoBow] = useVideoBow();
  const [videoTimestamp] = useVideoTimestamp();
  const [selectedEvent] = useVideoEvent();

  return (
    <Button
      disabled={!videoBow || !videoTimestamp || !selectedEvent}
      size="small"
      variant="contained"
      color="success"
      sx={{
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={performAddSplit}
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
  const row = anchorEl?.row;
  if (!row || !row.entry) {
    return <></>;
  }
  const lap = getEntryResult(row.id);
  const onDelete = () => {
    handleClose();

    if (lap) {
      setDialogConfig({
        title: `Delete Time`,
        message: `OK to delete time ${lap.Time} for Bow ${lap.Bow}?`,
        button: `Delete Timestamp`,
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
      <MenuItem onClick={onDelete}>
        Delete {lap?.Bow} ({lap?.Time})
      </MenuItem>
    </Menu>
  );
};

// Bow Grid view: render prior, current and next event (header + bows)
const BowGridView: React.FC<{
  events: Event[]; // events to render (usually activeEvents)
  selectedEvent?: string;
  allEvents: Event[]; // full filteredEvents list for computing neighbors
  orderByTime?: boolean;
  sidebarWidth?: number;
}> = ({
  events: _events,
  selectedEvent,
  allEvents,
  orderByTime = false,
  sidebarWidth,
}) => {
  // compute a button width based on the sidebar width: try to fit 5 buttons per row
  const buttonWidth = useMemo(() => {
    let sw = 300;
    if (typeof sidebarWidth === 'number' && sidebarWidth > 0) {
      sw = sidebarWidth;
    }
    // allow 40px for padding/margins, then divide by 5, clamp minimum 48
    return Math.floor((sw - 60) / 5);
  }, [sidebarWidth]);
  const [videoBow] = useVideoBow();
  const [waypoint] = useWaypoint();
  const gate = gateFromWaypoint(waypoint);
  const sectionRefs = React.useRef<Record<string, HTMLDivElement | null>>(
    {} as Record<string, HTMLDivElement | null>,
  );
  const buttonRefs = React.useRef<Record<string, HTMLButtonElement | null>>(
    {} as Record<string, HTMLButtonElement | null>,
  );

  // Keep the selected event section and selected bow visible
  React.useEffect(() => {
    if (!selectedEvent) return;
    const sec = sectionRefs.current[String(selectedEvent)];
    if (sec && typeof sec.scrollIntoView === 'function') {
      sec.scrollIntoView({ block: 'nearest' });
    }
    if (videoBow) {
      const btn = buttonRefs.current[`${selectedEvent}_${videoBow}`];
      if (btn && typeof btn.scrollIntoView === 'function') {
        try {
          btn.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
          });
        } catch (e) {
          // fallback
          btn.scrollIntoView({ block: 'nearest' });
        }
      }
    }
  }, [selectedEvent, videoBow]);

  // Build a sliding window: include prior events until we collect >=20 prior entries (or run out), include current, and include 3 after
  const sections = useMemo(() => {
    if (!selectedEvent) return [] as (Event | undefined)[];
    const idx = allEvents.findIndex((e) => e.EventNum === selectedEvent);
    if (idx === -1) return [] as (Event | undefined)[];

    // collect prior events backwards until we have at least 20 prior 'Bow' entries
    const prior: Event[] = [];
    let priorEntries = 0;
    for (let i = idx - 1; i >= 0; i -= 1) {
      const ev = allEvents[i];
      const count = ev?.eventItems?.length || 0;
      prior.unshift(ev);
      priorEntries += count;
      if (priorEntries >= 20) break;
    }

    const afterCount = 3;
    const out: (Event | undefined)[] = [];

    // append prior events (may be 0..n)
    for (const p of prior) out.push(p);

    // add current
    out.push(allEvents[idx]);

    // append after events up to afterCount
    for (let j = 1; j <= afterCount; j += 1) {
      const ai = idx + j;
      if (ai <= allEvents.length - 1) out.push(allEvents[ai]);
    }

    return out;
  }, [allEvents, selectedEvent]);

  const renderEventSection = (ev: Event, idx: number) => {
    let bows = ev.eventItems.map((it) => it?.Bow).filter(Boolean) as string[];
    if (orderByTime) {
      // Map bows to their recorded times (empty times sort last)
      bows = bows.slice().sort((a, b) => {
        const la = getEntryResult(`${gate}_${ev.EventNum}_${a}`);
        const lb = getEntryResult(`${gate}_${ev.EventNum}_${b}`);
        const ta = la && la.State !== 'Deleted' && la.Time ? la.Time : '';
        const tb = lb && lb.State !== 'Deleted' && lb.Time ? lb.Time : '';
        if (ta && tb) {
          return timeToMilli(ta) - timeToMilli(tb);
        }
        if (ta) return -1; // a has time, b doesn't -> a first
        if (tb) return 1; // b has time, a doesn't -> b first
        return 0;
      });
    }
    const rows: string[][] = [];
    for (let i = 0; i < bows.length; i += 5) rows.push(bows.slice(i, i + 5));
    const isCurrent = String(ev.EventNum) === String(selectedEvent);
    return (
      <Box
        key={String(ev.EventNum)}
        ref={(el: HTMLDivElement | null) => {
          sectionRefs.current[String(ev.EventNum)] = el;
        }}
        sx={{
          // marginBottom: '0.75em',
          ...(idx > 0
            ? {
                borderTop: '1px solid rgba(0,0,0,0.2)',
                pt: 0,
                // backgroundColor: '#f0f0f0',
              }
            : {}),
          ...(isCurrent
            ? {
                backgroundColor: 'rgba(25,118,210,0.04)',
                // borderLeft: '4px solid rgba(25,118,210,0.18)',
                // pl: 1,
              }
            : {}),
        }}
      >
        <Typography
          sx={{
            fontWeight: 'bold',
            fontSize: 13,
            marginBottom: '0.25em',
            color: isCurrent ? 'primary.main' : 'text.primary',
            px: 0.5,
            ...(isCurrent
              ? {}
              : {
                  backgroundColor: '#f0f0f0',
                  py: '1px',
                  borderRadius: 0.5,
                }),
          }}
        >
          {ev.Event}
        </Typography>
        {rows.map((r) => (
          <Stack
            key={`${ev.EventNum}-${r[0] ?? ''}-${r[r.length - 1] ?? ''}`}
            direction="row"
            spacing={1}
            sx={{ marginBottom: '0.25em', flexWrap: 'wrap', pl: 1 }}
          >
            {r.map((bow) => {
              return (
                <BowButton
                  eventNum={String(ev.EventNum)}
                  key={bow}
                  gate={gate}
                  bow={bow}
                  width={buttonWidth}
                  buttonRef={(el: HTMLButtonElement | null) => {
                    buttonRefs.current[`${ev.EventNum}_${bow}`] = el;
                  }}
                />
              );
            })}
          </Stack>
        ))}
      </Box>
    );
  };

  return (
    <Box sx={{ border: '1px solid rgba(0,0,0,0.2)' }}>
      {sections.map((s, i) => (s ? renderEventSection(s, i) : null))}
    </Box>
  );
};

const generateEventRows = (
  gate: string,
  event: Event | undefined,
  includeEventName: boolean,
  includeEntries: boolean,
) => {
  const rows: ResultRowType[] = [];
  if (!event) {
    return rows;
  }
  if (includeEventName) {
    rows.push({
      id: event.EventNum,
      eventName: event.Event,
      eventNum: event.EventNum,
      label: `E${event.Event}`,
      Crew: '',
      Bow: '',
      Time: '',
      event,
    });
  }
  if (includeEntries) {
    event.eventItems.forEach((entry) => {
      const key = `${gate}_${event.EventNum}_${entry?.Bow}`;
      const lap = getEntryResult(key);
      const Time = lap?.State === 'Deleted' ? '' : lap?.Time || '';

      rows.push({
        id: `${key}`,
        eventName: '',
        eventNum: event.EventNum,
        label: `${entry.Bow} ${entry.Crew}`,
        Crew: entry.Crew,
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
  const [selectedEvent, setSelectedEvent] = useVideoEvent();
  const datagridRef = useRef<DataGridHandle | null>(null);
  const [, setTabPosition] = useTabPosition();
  useRenderRequired();
  const [gridView, setGridView] = useShowGridView();
  const [orderByTime, setOrderByTime] = useTimeSort();

  const gate = gateFromWaypoint(waypoint);
  const { rows, filteredEvents } = useMemo(() => {
    let events = (mobileConfig?.eventList || []).filter(
      (evt) => evt.RaceType !== 'Info',
    );
    if (day) {
      events = events.filter((event) => event.Day === day);
    }

    const filteredRows: ResultRowType[] = [];
    events.forEach((event) => {
      generateEventRows(gate, event, true, false).forEach((row) => {
        filteredRows.push(row);
      });
    });
    return { rows: filteredRows, filteredEvents: events };
  }, [mobileConfig?.eventList, day, gate]);

  // Find the active event from selection, or pick the last event that has a recorded time
  let activeEvent = filteredEvents.find(
    (event) => event.EventNum === selectedEvent,
  );
  const findLastEventWithTime = (events: Event[]) => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      // Check if any entry for this event has a recorded time
      for (const entry of ev.eventItems) {
        const key = `${gateFromWaypoint(waypoint)}_${ev.EventNum}_${entry?.Bow}`;
        const lap = getEntryResult(key);
        if (lap && lap.State !== 'Deleted' && lap.Time) {
          return ev;
        }
      }
    }
    return undefined as Event | undefined;
  };

  if (!activeEvent && filteredEvents.length > 0) {
    // Prefer the last event that has a recorded time, otherwise default to first
    const lastWithTime = findLastEventWithTime(filteredEvents);
    activeEvent = lastWithTime || filteredEvents[0];
    if (activeEvent) {
      const newSelectedEvent = activeEvent;
      setTimeout(() => setSelectedEvent(newSelectedEvent.EventNum), 10);
    }
  }

  const combined = mobileConfig?.info?.CombinedRaces || '{}';
  const combinedRaces = JSON.parse(combined) as KeyMap<string[]>;
  const combinedList = combinedRaces[selectedEvent] || [selectedEvent];
  const columnConfig = useMemo(() => columns(width), [width]);
  const activeEvents: Event[] = [];
  combinedList.forEach((eventNum) => {
    const event = filteredEvents.find((evt) => evt.EventNum === eventNum);
    if (event) {
      activeEvents.push(event);
    }
  });

  const activeEventRows = activeEvents
    .map((event) => generateEventRows(gate, event, false, true))
    .flat();
  if (orderByTime) {
    // console.log(JSON.stringify(activeEventRows, null, 2));
    activeEventRows.sort((a, b) => {
      const ta = a?.Time?.match(/[0-9]/) ? timeToMilli(a.Time) : Infinity;
      const tb = b?.Time?.match(/[0-9]/) ? timeToMilli(b.Time) : Infinity;
      return ta - tb;
    });
  }
  const bowInfo: { [lane: string]: ResultRowType } = {};
  activeEventRows.forEach((evtRow) => {
    bowInfo[evtRow.Bow.replace(/^[a-zA-Z]*/, '')] = evtRow;
    bowInfo[evtRow.Bow] = evtRow;
  });
  setBowInfo(bowInfo); // stash for use by guide lane clicks (Video.tsx)

  const onRowClick = (
    args: CellClickArgs<ResultRowType, unknown>,
    _event: CellMouseEvent,
  ) => {
    seekToBow({ Bow: args.row.Bow, EventNum: args.row.eventNum });
  };

  const scrollToEvent = useCallback(
    (eventNum: string) => {
      let eventRow = rows.findIndex((row) => row.eventNum === eventNum);
      if (eventRow < 0 && rows.length > 0) {
        eventRow = 0;
      }
      if (eventRow >= 0) {
        setSelectedEvent(eventNum);
        datagridRef.current?.scrollToCell({
          rowIdx: Math.min(
            rows.length - 1,
            eventRow, // + Math.min(rows[eventRow].event.eventItems.length, 10)
          ),
          idx: 0,
        });
      }
    },
    [rows, setSelectedEvent],
  );

  useEffect(() => scrollToEvent(selectedEvent), [scrollToEvent, selectedEvent]);

  const onEventChange = (event: SelectChangeEvent<string>) => {
    setSelectedEvent(event.target.value);
    // Search lapdata for the first time in this event and jump to that timestamp
    seekToEvent(event.target.value);
  };

  const prevEvent = () => {
    const index = filteredEvents.findIndex(
      (event) => event.EventNum === selectedEvent,
    );
    if (index > 0) {
      setSelectedEvent(filteredEvents[index - 1].EventNum);
    }
  };

  const nextEvent = () => {
    const index = filteredEvents.findIndex(
      (event) => event.EventNum === selectedEvent,
    );
    if (index !== -1 && index < filteredEvents.length - 1) {
      setSelectedEvent(filteredEvents[index + 1].EventNum);
    }
  };

  const activeEventIndex = filteredEvents.findIndex(
    (event) => event.EventNum === selectedEvent,
  );

  if (!mobileConfig) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          paddingLeft: '8px',
          paddingRight: '8px',
          maxWidth: '100%',
          ...sx,
        }}
      >
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
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: '8px',
        paddingRight: '8px',
        maxWidth: '100%',
        ...sx,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          mb: '1em',
          mt: '0.25em',
          height: 28,
          flexWrap: 'nowrap',
          width: '100%',
        }}
      >
        {/* Fixed area */}
        <Box sx={{ flex: '0 0 96px' }}>
          <AddSplitButton />
        </Box>

        {/* Group 1 shares leftover */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ToggleButtonGroup
            value={gridView ? 'grid' : 'list'}
            exclusive
            onChange={() => setGridView((v) => !v)}
            sx={{
              width: '100%',
              height: 28,
              minWidth: 0,
              '& .MuiToggleButton-root': {
                flex: 1,
                minWidth: 0, // override the default 48px
                px: 0.5,
                py: 0,
                '&.Mui-selected': {
                  backgroundColor: 'transparent', // no gray background
                  color: 'primary.main', // uses theme primary color
                  borderColor: 'primary.main', // primary border
                  '&:hover': {
                    backgroundColor: 'action.hover', // optional subtle hover
                  },
                },
              },
            }}
          >
            <Tooltip title="Show entries as a grid" arrow>
              <ToggleButton value="grid" aria-label="Grid view">
                <GridViewIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Show entries as a list" arrow>
              <ToggleButton value="list" aria-label="List view">
                <ViewListIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {/* Group 2 shares leftover */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ToggleButtonGroup
            value={orderByTime ? 'time' : 'natural'}
            exclusive
            onChange={() => setOrderByTime((v) => !v)}
            sx={{
              width: '100%',
              height: 28,
              minWidth: 0,
              '& .MuiToggleButton-root': {
                flex: 1,
                minWidth: 0,
                px: 0.5,
                py: 0,
                '&.Mui-selected': {
                  backgroundColor: 'transparent', // no gray background
                  color: 'primary.main', // uses theme primary color
                  borderColor: 'primary.main', // primary border
                  '&:hover': {
                    backgroundColor: 'action.hover', // optional subtle hover
                  },
                },
              },
            }}
          >
            <Tooltip title="Sort by time (if recorded)" arrow>
              <ToggleButton value="time" aria-label="Sort by time">
                <AccessTimeIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Sort by schedule order" arrow>
              <ToggleButton value="natural" aria-label="Sort by schedule order">
                <SortIcon sx={{ fontSize: 20 }} />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>
      </Stack>

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
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: '#fff',
                },
              },
              MenuListProps: {
                sx: {
                  fontSize: timingFontSize,
                },
              },
            }}
            renderValue={(selected) => {
              const event = filteredEvents.find(
                (evt) => evt.EventNum === selected,
              );
              const label = event
                ? `${event.Event}${event.Start ? ` (${event.Start})` : ''}`
                : '';
              const needsTooltip = label.length > 30;
              const valueSpan = (
                <span
                  style={{
                    display: 'inline-block',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'clip',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'bottom',
                  }}
                >
                  {label}
                </span>
              );
              return needsTooltip ? (
                <Tooltip title={label} placement="top" arrow>
                  {valueSpan}
                </Tooltip>
              ) : (
                valueSpan
              );
            }}
          >
            {filteredEvents.map((event) => (
              <MenuItem
                key={event.EventNum}
                value={event.EventNum}
                sx={{
                  fontWeight:
                    selectedEvent === event.EventNum ? 'bold' : 'normal',
                  backgroundColor:
                    selectedEvent === event.EventNum
                      ? 'rgba(25, 118, 210, 0.15)'
                      : 'inherit',
                  color: selectedEvent === event.EventNum ? '#000' : 'inherit',
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(25, 118, 210, 0.25) !important',
                  },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {`${event.Event}${event.Start ? ` (${event.Start})` : ''}`}
                </span>
                {selectedEvent === event.EventNum && (
                  <span style={{ marginLeft: 8, color: '#1976d2' }}>✔</span>
                )}
              </MenuItem>
            ))}
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
        {gridView ? (
          <Box sx={{ overflowY: 'auto', height: height - 138 }}>
            <BowGridView
              events={activeEvents}
              selectedEvent={selectedEvent}
              allEvents={filteredEvents}
              orderByTime={orderByTime}
              sidebarWidth={width - 16} // allow for padding
            />
          </Box>
        ) : (
          <DataGrid
            // Each row needs to be unique key so the virtualization doesn't reuse any UseKeyedDatum values between rows (#53)
            rowKeyGetter={(row) => `${selectedEvent}-${row.Bow}`}
            columns={columnConfig}
            rows={activeEventRows}
            onCellClick={onRowClick}
            rowHeight={24}
            rowClass={(row) => (row.eventName ? classes.row : undefined)}
            style={{ height: height - 138 }}
          />
        )}
      </div>
    </Box>
  );
};

export default TimingSidebar;
