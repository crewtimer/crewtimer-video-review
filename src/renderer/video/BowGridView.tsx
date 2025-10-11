import React, { useMemo } from 'react';
import { Tooltip, Button, Box, Typography, Stack } from '@mui/material';

import { Event } from 'crewtimer-common';
import { useEntryResult, getEntryResult } from 'renderer/util/LapStorageDatum';
import { useWaypoint } from 'renderer/util/UseSettings';
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

// Bow Grid view: render prior, current and next event (header + bows)
export const BowGridView: React.FC<{
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
