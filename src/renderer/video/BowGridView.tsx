import React, {
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
} from 'react';
import { Tooltip, Button, Box, Typography, Stack } from '@mui/material';
import { GroupedVirtuoso } from 'react-virtuoso';

import { Event } from 'crewtimer-common';
import {
  useEntryResult,
  useEventsUpdated,
  getEntryResult,
} from 'renderer/util/LapStorageDatum';
import {
  useHintGate,
  useScoredGate,
  useWaypoint,
} from 'renderer/util/UseSettings';
import { useSingleAndDoubleClick } from 'renderer/util/UseSingleAndDoubleClick';
import { gateFromWaypoint, timeToMilli } from 'renderer/util/Util';
import { useEntryException } from './UseClickerData';
import {
  useVideoEvent,
  useVideoBow,
  setVideoEvent,
  setVideoBow,
  ResultRowType,
} from './VideoSettings';
import {
  sanitizeFirebaseKey,
  seekToBow,
  setContextMenuAnchor,
} from './TimingSidebarUtil';

// Compute rows (arrays of bow strings) for an event, honoring orderByTime and gate.
export function eventToRows(ev: Event, orderByTime: boolean, gate: string) {
  let bows = ev.eventItems
    .map((it: any) => it?.Bow)
    .filter(Boolean) as string[];

  if (orderByTime) {
    bows = bows.slice().sort((a, b) => {
      const la = getEntryResult(`${gate}_${ev.EventNum}_${a}`);
      const lb = getEntryResult(`${gate}_${ev.EventNum}_${b}`);
      const ta = la && la.State !== 'Deleted' && la.Time ? la.Time : '';
      const tb = lb && lb.State !== 'Deleted' && lb.Time ? lb.Time : '';
      if (ta && tb) return timeToMilli(ta) - timeToMilli(tb);
      if (ta) return -1;
      if (tb) return 1;
      return 0;
    });
  }

  const rows: string[][] = [];
  for (let i = 0; i < bows.length; i += 5) {
    rows.push(bows.slice(i, i + 5));
  }
  if (rows.length === 0) rows.push([]);
  return rows;
}

// BowButton: small component for individual bow buttons. Shows exception text (if any)
// and supports compact wrapping when exception text exists.
const BowButton: React.FC<{
  eventNum: string;
  bow: string;
  width: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}> = ({ eventNum, bow, width, buttonRef }) => {
  const [selectedEvent] = useVideoEvent();
  const [videoBow] = useVideoBow();
  const sanitizedKey = sanitizeFirebaseKey(`1-${eventNum}-${bow}`);
  const [exception] = useEntryException(sanitizedKey ?? '');
  const compact = !!exception;
  const isCurrent = String(eventNum) === String(selectedEvent);
  const isSelected = isCurrent && videoBow === bow;
  const scoredGate = useScoredGate();
  const hintGate = useHintGate();
  const entryKey = `${scoredGate}_${eventNum}_${bow}`;
  const [scoredValue] = useEntryResult(entryKey);
  const [hintValue] = useEntryResult(`${hintGate}_${eventNum}_${bow}`);
  // compute derived properties here
  const hasTime = !!(
    scoredValue &&
    scoredValue.State !== 'Deleted' &&
    scoredValue.Time
  );
  const tooltipTitle = hasTime
    ? `${scoredValue.Time}${scoredValue.Crew ? ` • ${scoredValue.Crew}` : ''}`
    : '';

  const { onSingleClick, onDoubleClick } = useSingleAndDoubleClick(
    () => {
      // single click
      setVideoEvent(eventNum);
      if (bow) {
        setVideoBow(bow);
      }
    },
    () => {
      // double click
      seekToBow({ Bow: bow, EventNum: eventNum });
    },
  );

  const sx: any = {
    minWidth: 0,
    width,
    maxWidth: width,
    overflow: 'hidden',
    position: 'relative',
    textOverflow: 'clip',
    whiteSpace: compact ? 'normal' : 'nowrap',
    fontSize: compact ? 10 : undefined,
    lineHeight: compact ? '1.1rem' : undefined,
    padding: 0,
  };

  // Compute top bar background: left half green if hint exists, right half green if scored exists
  const activeColor = '#0e0'; // '#4caf50';
  const inactiveColor = '#ddd';
  const topBarBackground =
    hintValue !== undefined && scoredValue !== undefined
      ? activeColor
      : hintValue !== undefined
        ? `linear-gradient(to right, ${activeColor} 0%, ${activeColor} 50%, ${inactiveColor} 50%, ${inactiveColor} 100%)`
        : scoredValue !== undefined
          ? `linear-gradient(to right, ${inactiveColor} 0%, ${inactiveColor} 50%, ${activeColor} 50%, ${activeColor} 100%)`
          : inactiveColor;

  if (isSelected) {
    // show as a normal primary-colored button when selected and empty
    sx.color = 'primary.contrastText';
    sx.fontWeight = 'bold';
    sx.backgroundColor = 'primary.main';
    sx.boxShadow = undefined;
    sx['&:hover'] = {
      backgroundColor: 'primary.dark',
      color: 'white',
    };
    // if there's an exception, give a light pink background
  } else if (hasTime) {
    sx.backgroundColor = '#ddd';
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
        onDoubleClick={onDoubleClick}
        onClick={onSingleClick}
        onContextMenu={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          if (hasTime) {
            // construct a minimal ResultRowType-like object so ContextMenu can act on it
            const row = {
              id: entryKey,
              eventName: '',
              eventNum,
              label: `${bow}`,
              Crew: scoredValue?.Crew || '',
              Bow: bow,
              Time: hasTime ? scoredValue?.Time || '' : '',
              event: undefined,
              entry: {
                Bow: bow,
                Crew: scoredValue?.Crew || '',
                EventNum: eventNum,
              },
            } as unknown as ResultRowType;
            setContextMenuAnchor({ element: e.currentTarget as Element, row });
          }
        }}
        ref={buttonRef}
      >
        {/* Thin status bar across the top: left half indicates hint, right half indicates scored */}
        {/* compute background above to avoid nested ternary indentation issues */}

        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '3px',
            background: topBarBackground,
            zIndex: 2,
            borderBottom: '1px solid rgba(0,0,0,0.25)',
          }}
        />
        <span
          style={{
            paddingTop: 3,
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

// Top-level renderer for group headers (memoized)
const GroupHeader = React.memo(
  ({ ev, isCurrent }: { ev: Event; isCurrent: boolean }) => (
    <Box
      sx={{
        // align left padding with row padding so the border is continuous
        pl: isCurrent ? '0.5rem' : 1,
        pr: 0.5,
        py: 0.5,
        // use a solid background so items scrolled beneath are not visible through
        backgroundColor: isCurrent ? '#f6fafb' : 'background.paper',
        // add a distinctive left border when this is the current event
        borderLeft: isCurrent ? '4px solid #6572ab' : undefined,
        zIndex: 1,
      }}
      onClick={() => {
        // Handle group header click
        setVideoEvent(ev.EventNum);
      }}
    >
      <Typography
        sx={{
          fontWeight: 'bold',
          fontSize: 13,
          marginBottom: 0,
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
        {ev.Start ? ` (${ev.Start})` : ''}
      </Typography>
    </Box>
  ),
  (prev, next) =>
    prev.ev.EventNum === next.ev.EventNum && prev.isCurrent === next.isCurrent,
);

const BowRowComponent: React.FC<{
  ev: Event;
  row: string[];
  buttonWidth: number;
  buttonRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
}> = ({ ev, row, buttonWidth, buttonRefs }) => {
  const [selectedEvent] = useVideoEvent();
  const isCurrent = String(ev.EventNum) === String(selectedEvent);
  return (
    <Stack
      key={`${ev.EventNum}-${row[0] ?? ''}-${row[row.length - 1] ?? ''}`}
      direction="row"
      spacing={1}
      sx={{
        // remove bottom margin so the border is continuous between header and rows
        marginBottom: 0,
        flexWrap: 'wrap',
        pt: 0.5,
        pl: 1,
        // highlight current event rows with a left border to match the header
        borderLeft: isCurrent ? '4px solid #6572ab' : undefined,
        // slightly offset the content so the border doesn't overlap
        paddingLeft: isCurrent ? '0.5rem' : undefined,
      }}
    >
      {row.map((bow: string) => (
        <BowButton
          eventNum={String(ev.EventNum)}
          key={bow}
          bow={bow}
          width={buttonWidth}
          buttonRef={(el: HTMLButtonElement | null) => {
            buttonRefs.current[`${ev.EventNum}_${bow}`] = el;
          }}
        />
      ))}
    </Stack>
  );
};

const BowRow = React.memo(
  BowRowComponent,
  (prev, next) =>
    prev.ev.EventNum === next.ev.EventNum &&
    prev.buttonWidth === next.buttonWidth &&
    prev.row.join('|') === next.row.join('|'),
);

// Bow Grid view: render prior, current and next event (header + bows)
export const BowGridView: React.FC<{
  events: Event[]; // events to render (usually activeEvents)
  selectedEvent?: string;
  // _allEvents intentionally unused in this view
  orderByTime?: boolean;
  sidebarWidth?: number;
}> = ({ events, selectedEvent, orderByTime = false, sidebarWidth }) => {
  // compute a button width based on the sidebar width: try to fit 5 buttons per row
  const buttonWidth = useMemo(() => {
    let sw = 300;
    if (typeof sidebarWidth === 'number' && sidebarWidth > 0) {
      sw = sidebarWidth;
    }
    // allow space padding/margins/active border etc, then divide by 5
    return Math.floor((sw - 60) / 5);
  }, [sidebarWidth]);
  const [videoBow] = useVideoBow();
  const [waypoint] = useWaypoint();
  const gate = gateFromWaypoint(waypoint);
  // button refs remain so individual buttons can be focused/inspected if needed
  const buttonRefs = React.useRef<Record<string, HTMLButtonElement | null>>(
    {} as Record<string, HTMLButtonElement | null>,
  );
  // Build groups for virtualization: for each event produce rows (groups of up to 5 bows)
  const buildGroups = useCallback(
    (eventsParam: Event[]) => {
      return eventsParam.map((ev: Event) => {
        // compute rows using shared helper

        const rows = eventToRows(ev, orderByTime, gate);
        return { event: ev, rows };
      });
    },
    [orderByTime, gate],
  );

  const [groups, setGroups] = useState(() => buildGroups(events));
  useEffect(() => {
    setGroups(buildGroups(events));
  }, [events, buildGroups]);

  const updateGroupRows = useCallback(
    (groupIndex: number, newRows: string[][]) => {
      setGroups((prev) => {
        if (groupIndex < 0 || groupIndex >= prev.length) return prev;
        const next = prev.slice();
        next[groupIndex] = { ...next[groupIndex], rows: newRows };
        return next;
      });
    },
    [],
  );

  // When external storage signals that specific events were updated, rebuild only those groups.
  const [eventsUpdated] = useEventsUpdated();
  useEffect(() => {
    if (!eventsUpdated || eventsUpdated.size === 0) return;

    eventsUpdated.forEach((key) => {
      // keys are expected to be event numbers (string)
      const groupIndex = groups.findIndex(
        (g) => String(g.event.EventNum) === String(key),
      );
      if (groupIndex === -1) return;

      const ev = groups[groupIndex].event;
      const rows = eventToRows(ev, orderByTime, gate);
      updateGroupRows(groupIndex, rows);
    });

    eventsUpdated.clear(); // Clear as processed.  A direct mutation of the set to avoid re-renders
  }, [eventsUpdated, groups, orderByTime, gate, updateGroupRows]);

  // groupCounts for GroupVirtuoso: number of rows per event
  const groupCounts: number[] = groups.map((g) => g.rows.length);
  const virtuosoRef = useRef<any>(null);

  // prefix sums: start index for each group in the flattened items list
  const groupStarts = useMemo(() => {
    const starts: number[] = [];
    let acc = 0;
    for (let i = 0; i < groupCounts.length; i += 1) {
      starts.push(acc);
      acc += groupCounts[i];
    }
    return starts;
  }, [groupCounts]);

  // when the selected event changes, scroll the virtuoso to the start of that group
  useEffect(() => {
    if (!selectedEvent) return;
    const groupIndex = events.findIndex(
      (e) => String(e.EventNum) === String(selectedEvent),
    );
    if (groupIndex === -1) return;
    // find the row index that contains the currently selected bow (if any)
    let targetIndex: number | null = null;
    let scrolledToHeader = false;
    if (videoBow) {
      const { rows } = groups[groupIndex];
      const rowIndex = rows.findIndex((r) => r.includes(String(videoBow)));
      if (rowIndex !== -1) {
        // If the selected row is within the first 10 rows, prefer scrolling to the header
        if (rowIndex < 10) {
          targetIndex = groupStarts[groupIndex];
          scrolledToHeader = true;
        } else {
          // absolute index = sum of counts before this group + rowIndex
          targetIndex = groupStarts[groupIndex] + rowIndex;
        }
      }
    }

    // fallback to group start if we couldn't find a specific row to target
    if (targetIndex === null) {
      const absIndex = groupCounts
        .slice(0, groupIndex)
        .reduce((s: number, n: number) => s + n, 0);
      targetIndex = absIndex;
      scrolledToHeader = true;
    }

    // try multiple possible API names for scroll
    try {
      if (virtuosoRef.current?.scrollToIndex) {
        virtuosoRef.current.scrollToIndex(targetIndex);
      } else if (virtuosoRef.current?.scrollTo) {
        virtuosoRef.current.scrollTo(targetIndex);
      } else if (virtuosoRef.current?.scrollIntoView) {
        virtuosoRef.current.scrollIntoView();
      }
    } catch (e) {
      // ignore
    }

    // after the virtuoso scrolled, try to center the actual button within the viewport
    if (videoBow && !scrolledToHeader) {
      setTimeout(() => {
        const btn = buttonRefs.current[`${selectedEvent}_${videoBow}`];
        if (btn && typeof btn.scrollIntoView === 'function') {
          try {
            btn.scrollIntoView({
              block: 'center',
              inline: 'center',
              behavior: 'smooth',
            });
          } catch (e) {
            btn.scrollIntoView({ block: 'nearest' });
          }
        }
      }, 120);
    }
  }, [selectedEvent, groupCounts, events, videoBow, groupStarts, groups]);

  const renderGroupContent = useCallback(
    (groupIndex: number) => {
      const ev = groups[groupIndex].event;
      const isCurrent = String(ev.EventNum) === String(selectedEvent);
      return <GroupHeader ev={ev} isCurrent={isCurrent} />;
    },
    [groups, selectedEvent],
  );

  const renderItemContent = useCallback(
    (index: number) => {
      // find the group that contains this absolute index
      let groupIndex = 0;
      while (
        groupIndex < groupCounts.length - 1 &&
        index >= groupStarts[groupIndex] + groupCounts[groupIndex]
      ) {
        groupIndex += 1;
      }
      const rowIndex = index - groupStarts[groupIndex];
      const ev = groups[groupIndex].event;
      const r = groups[groupIndex].rows[rowIndex] ?? [];
      return (
        <BowRow
          ev={ev}
          row={r}
          buttonWidth={buttonWidth}
          buttonRefs={buttonRefs}
        />
      );
    },
    [groups, buttonWidth, buttonRefs, groupCounts, groupStarts],
  );

  // Render using GroupVirtuoso: groups -> event headers, items -> rows of bow buttons
  return (
    <Box sx={{ border: '1px solid rgba(0,0,0,0.2)', height: '100%' }}>
      <GroupedVirtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        groupCounts={groupCounts}
        groupContent={renderGroupContent}
        itemContent={renderItemContent}
      />
    </Box>
  );
};
