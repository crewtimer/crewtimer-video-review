import { useEffect, useState } from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { UseDatum } from 'react-usedatum';
import { useVideoSettings } from './VideoSettings';

/** Status report multicast by CrewTimer Video Recorder every minute. */
export interface RecorderStatus {
  cmd: 'recorder-status';
  /** Waypoint the recorder is bound to; empty means any waypoint. */
  wp: string;
  /** Regatta whose times at wp split the recorder's files; empty when not set */
  regattaId: string;
  /** The regatta was found, so the recorder splits its files on its times */
  regattaListening: boolean;
  host: string;
  version: string;
  tsMilli: number;
  camera: string;
  protocol: string;
  connected: boolean;
  recording: boolean;
  filename: string;
  signalHealth: {
    fps: number;
    measuredFps: number;
    lowFrameRate: boolean;
    width: number;
    height: number;
    pixelRateMpx: number;
    frameBacklog: number;
    arrivalLagMs: number | null;
    clockOff: boolean;
  };
  gapCount: number;
  errorCount: number;
  disk: {
    folder: string;
    usedPercent: number;
    freeBytes: number;
    totalBytes: number;
  } | null;
}

/** Sent by a recorder as it quits. */
export interface RecorderExit {
  cmd: 'recorder-exit';
  wp: string;
  host: string;
  tsMilli: number;
}

/** Sent by a recorder as each file is finished, so the file list need not wait to poll. */
export interface RecorderFileClosed {
  cmd: 'recorder-file-closed';
  wp: string;
  host: string;
  /** Without the extension */
  filename: string;
  tsMilli: number;
}

export type RecorderMessage =
  RecorderStatus | RecorderExit | RecorderFileClosed;

interface ReceivedStatus {
  status: RecorderStatus;
  receivedAt: number;
  /** The recorder has quit since this status was sent. */
  exited: boolean;
}

// Reports arrive every minute; allow one to go missing before marking stale
const STALE_MS = 150 * 1000;
// Matches the warning level in CrewTimer Video Recorder
const DISK_WARN_PERCENT = 85;

/** Latest report from each recorder, keyed by host name. */
const [useRecorderStatusMap, setRecorderStatusMap, getRecorderStatusMap] =
  UseDatum<Record<string, ReceivedStatus>>({});

const forWaypoint = (
  statusMap: Record<string, ReceivedStatus>,
  waypoint: string,
) =>
  Object.values(statusMap).filter(
    ({ status }) => !status.wp || status.wp === waypoint,
  );

const isReporting = ({ receivedAt, exited }: ReceivedStatus, now: number) =>
  !exited && now - receivedAt <= STALE_MS;

/**
 * A CrewTimer Video Recorder bound to this app's timing hint waypoint is
 * reporting that it splits its files on the regatta's times, so needs no
 * split requests.
 */
export const useRecorderSplitsOnHints = () => {
  const [statusMap] = useRecorderStatusMap();
  const [videoSettings] = useVideoSettings();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // Re-check so a recorder that stops reporting no longer counts
    const timer = setInterval(() => setNow(Date.now()), 15 * 1000);
    return () => clearInterval(timer);
  }, []);
  return forWaypoint(statusMap, videoSettings.timingHintSource || '').some(
    (received) =>
      received.status.regattaListening && isReporting(received, now),
  );
};

const formatBytes = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(1)} TB`
    : `${Math.round(bytes / 1e9)} GB`;

const RecorderPill = ({
  status,
  inactive,
}: {
  status: RecorderStatus;
  /** Why the last status no longer applies; undefined while reporting. */
  inactive?: 'Exited' | 'No report';
}) => {
  const { signalHealth: health, disk } = status;
  const diskFull = !!disk && disk.usedPercent >= DISK_WARN_PERCENT;
  const fpsText = health.measuredFps
    ? `${health.measuredFps.toFixed(1)} fps`
    : `${health.fps.toFixed(0)} fps`;

  let stateText = status.recording ? 'Recording' : 'Stopped';
  let stateColor = status.recording ? 'success.main' : 'text.secondary';
  if (inactive) {
    stateText = inactive;
    stateColor = 'text.disabled';
  } else if (!status.connected) {
    stateText = status.recording ? 'Recording, no video' : 'No camera';
    stateColor = 'error.main';
  }

  const tooltip = (
    <Stack spacing={0.25}>
      <Typography variant="caption">{`${status.host} · v${status.version}`}</Typography>
      <Typography variant="caption">{`Waypoint: ${status.wp || 'Any'}`}</Typography>
      <Typography variant="caption">
        {status.regattaListening
          ? `Splits files on regatta ${status.regattaId} times`
          : `Not splitting files on timing hints: ${status.regattaId ? `regatta ${status.regattaId} not yet found` : 'no Regatta ID set'}. Set it on the recorder's Source tab.`}
      </Typography>
      <Typography variant="caption">{`Camera: ${status.camera} (${status.protocol})${status.connected ? '' : ', not connected'}`}</Typography>
      {status.recording && status.filename && (
        <Typography variant="caption">{`File: ${status.filename}`}</Typography>
      )}
      <Typography variant="caption">{`Frame rate: ${health.measuredFps.toFixed(2)} of ${health.fps.toFixed(2)} fps${health.lowFrameRate ? ' (low)' : ''}`}</Typography>
      <Typography variant="caption">{`Gaps: ${status.gapCount}, errors: ${status.errorCount}`}</Typography>
      {disk && (
        <Typography variant="caption">{`Disk: ${disk.usedPercent}% used, ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`}</Typography>
      )}
      <Typography variant="caption">{`Last report: ${new Date(status.tsMilli).toLocaleTimeString()}`}</Typography>
    </Stack>
  );

  return (
    <Tooltip title={tooltip}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          px: 1.25,
          py: 0.25,
          mr: 1,
          borderRadius: 999,
          bgcolor: 'background.paper',
          color: 'text.primary',
          fontSize: 13,
          whiteSpace: 'nowrap',
          opacity: inactive ? 0.7 : 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: stateColor,
            flexShrink: 0,
          }}
        />
        <Box component="span" sx={{ fontWeight: 600 }}>
          {stateText}
        </Box>
        {!inactive && (
          <>
            <Box
              component="span"
              sx={{ color: health.lowFrameRate ? 'error.main' : undefined }}
            >
              {fpsText}
            </Box>
            {!status.regattaListening && (
              <Box
                component="span"
                sx={{ color: 'warning.main', fontWeight: 700 }}
              >
                no hint splits
              </Box>
            )}
            <Box
              component="span"
              sx={{ color: status.gapCount ? 'warning.main' : undefined }}
            >
              {`${status.gapCount} gaps`}
            </Box>
            {disk && (
              <Box
                component="span"
                sx={{
                  color: diskFull ? 'error.main' : undefined,
                  fontWeight: diskFull ? 700 : undefined,
                }}
              >
                {`disk ${disk.usedPercent}%`}
              </Box>
            )}
          </>
        )}
      </Stack>
    </Tooltip>
  );
};

/**
 * Shows the recorders bound to this app's timing hint waypoint (or to any
 * waypoint), from the status reports they multicast.
 */
export const RecorderStatusBar = () => {
  const [statusMap] = useRecorderStatusMap();
  const [videoSettings] = useVideoSettings();
  const waypoint = videoSettings.timingHintSource || '';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsubscribe = window.VideoUtils.onRecorderStatus((msg) => {
      if (!msg?.host || msg.cmd === 'recorder-file-closed') return;
      const latest = getRecorderStatusMap();
      if (msg.cmd === 'recorder-exit') {
        // Keep the last status so the recorder still shows, marked as exited
        const prior = latest[msg.host];
        if (prior) {
          setRecorderStatusMap({
            ...latest,
            [msg.host]: { ...prior, exited: true },
          });
        }
        return;
      }
      setRecorderStatusMap({
        ...latest,
        [msg.host]: { status: msg, receivedAt: Date.now(), exited: false },
      });
    });
    // Re-render so a recorder that stops reporting is shown as stale
    const timer = setInterval(() => setNow(Date.now()), 15 * 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  const recorders = forWaypoint(statusMap, waypoint).sort((a, b) =>
    a.status.host.localeCompare(b.status.host),
  );

  if (recorders.length === 0) return null;
  return (
    <Stack direction="row" sx={{ alignItems: 'center' }}>
      {recorders.map(({ status, receivedAt, exited }) => {
        let inactive: 'Exited' | 'No report' | undefined;
        if (exited) inactive = 'Exited';
        else if (now - receivedAt > STALE_MS) inactive = 'No report';
        return (
          <RecorderPill key={status.host} status={status} inactive={inactive} />
        );
      })}
    </Stack>
  );
};

export default RecorderStatusBar;
