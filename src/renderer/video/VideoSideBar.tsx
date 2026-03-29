import React, { useMemo } from 'react';
import {
  Box,
  Button,
  IconButton,
  Stack,
  SxProps,
  Theme,
  Tooltip,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import makeStyles from '@mui/styles/makeStyles';
import {
  getEntryResult,
  useEntryResultsChanged,
} from 'renderer/util/LapStorageDatum';
import {
  getClickOffset,
  getWaypoint,
  useScoredGate,
} from 'renderer/util/UseSettings';
import { gateFromWaypoint, timeToMilli } from '../util/Util';
import FileList from '../FileList';
import { seekToTimestamp } from './RequestVideoFrame';
import { useClickerData } from './UseClickerData';
import {
  setVideoBow,
  setVideoEvent,
  useDirList,
  useVideoBow,
  useVideoBowUuid,
  useVideoDir,
  useVideoEvent,
  useVideoTimestamp,
} from './VideoSettings';

const { openDirDialog, openFileExplorer } = window.Util;
const UNKNOWN_HINT_WINDOW_MILLI = 15 * 60 * 1000;
const UNKNOWN_HINT_BUTTONS = 3;
const UNKNOWN_HINT_ROW_HEIGHT = 38;

const useStyles = makeStyles((_theme) => ({
  button: { margin: '0.5em', fontSize: 10 },
}));

type UnknownHintButtonProps = {
  active: boolean;
  label: string;
  selected: boolean;
  time?: string;
  eventNum?: string;
  onClick: () => void;
};

const UnknownHintButton: React.FC<UnknownHintButtonProps> = ({
  active,
  label,
  selected,
  time,
  eventNum,
  onClick,
}) => {
  const sx: any = {
    minWidth: 0,
    width: 38,
    maxWidth: 38,
    overflow: 'hidden',
    position: 'relative',
    textOverflow: 'clip',
    whiteSpace: 'nowrap',
    padding: 0,
  };
  const activeColor = '#0e0';
  const inactiveColor = '#ddd';

  if (selected) {
    sx.color = 'primary.contrastText';
    sx.fontWeight = 'bold';
    sx.backgroundColor = 'primary.main';
    sx.boxShadow = undefined;
    sx['&:hover'] = {
      backgroundColor: 'primary.dark',
      color: 'white',
    };
  } else if (active) {
    sx.backgroundColor = '#ffffff';
  } else {
    sx.backgroundColor = '#ddd';
    sx.color = '#666';
    sx.opacity = 1;
    sx['&.Mui-disabled'] = {
      backgroundColor: '#ddd',
      color: '#666',
      WebkitTextFillColor: '#666',
      opacity: 1,
      borderColor: 'rgba(0, 0, 0, 0.23)',
    };
  }

  return (
    <Tooltip
      title={
        active
          ? `${time}${eventNum && eventNum !== '?' ? ` • E${eventNum}` : ''}`
          : 'No nearby ? hint'
      }
      arrow
    >
      <span>
        <Button
          size="small"
          variant={selected ? 'contained' : 'outlined'}
          sx={sx}
          disabled={!active}
          onClick={onClick}
        >
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: '3px',
              background: active
                ? `linear-gradient(to right, ${activeColor} 0%, ${activeColor} 50%, ${inactiveColor} 50%, ${inactiveColor} 100%)`
                : inactiveColor,
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
            {label}
          </span>
        </Button>
      </span>
    </Tooltip>
  );
};

// Define the types for the component's props
interface CustomTableProps {
  height: number;
  sx?: SxProps<Theme>;
}

/**
 * CustomTable displays a table of values using Material-UI with specified columns and width.
 *
 * @param props The properties passed to the component, expects a width.
 * @returns A Material-UI Table containing the rows of data.
 */
const VideoSideBar: React.FC<CustomTableProps> = ({ sx, height }) => {
  const classes = useStyles();
  const [dirList] = useDirList();
  const [videoDir, setVideoDir] = useVideoDir();
  const [videoEvent] = useVideoEvent();
  const [videoTimestamp] = useVideoTimestamp();
  const [videoBow] = useVideoBow();
  const [videoBowUuid] = useVideoBowUuid();
  const [entryResultsChanged] = useEntryResultsChanged();
  const scoredGate = useScoredGate();
  const hintData = useClickerData();

  const unknownHints = useMemo(() => {
    if (!videoTimestamp) {
      return Array.from({ length: UNKNOWN_HINT_BUTTONS }, () => undefined);
    }
    const currentMilli = timeToMilli(videoTimestamp) + entryResultsChanged * 0;
    const nearest = hintData
      .filter((lap) => {
        if (
          !lap.Time ||
          Math.abs(timeToMilli(lap.Time) - currentMilli) >
            UNKNOWN_HINT_WINDOW_MILLI
        ) {
          return false;
        }
        if (lap.Bow === '?' || lap.EventNum === '?') {
          return true;
        }
        const scoredLap = getEntryResult(
          `${scoredGate}_${lap.EventNum}_${lap.Bow}`,
        );
        return !(scoredLap?.Time && scoredLap.State !== 'Deleted');
      })
      .sort((a, b) => {
        const deltaA = Math.abs(timeToMilli(a.Time) - currentMilli);
        const deltaB = Math.abs(timeToMilli(b.Time) - currentMilli);
        if (deltaA !== deltaB) {
          return deltaA - deltaB;
        }
        return timeToMilli(a.Time) - timeToMilli(b.Time);
      })
      .slice(0, UNKNOWN_HINT_BUTTONS);

    return Array.from(
      { length: UNKNOWN_HINT_BUTTONS },
      (_value, index) => nearest[index],
    );
  }, [entryResultsChanged, hintData, scoredGate, videoTimestamp]);

  const chooseDir = () => {
    openDirDialog('Choose Video Directory', videoDir)
      .then((result) => {
        if (!result.cancelled) {
          if (result.path !== videoDir) {
            setVideoDir(result.path);
          }
        }
        return undefined;
      })
      .catch((_e) => {
        /* ignore */
      });
  };

  const jumpToHint = (hint?: (typeof hintData)[number]) => {
    if (!hint?.Time) {
      return;
    }
    if (hint.EventNum && hint.EventNum !== '?') {
      setVideoEvent(hint.EventNum);
    }
    if (hint.Bow) {
      setVideoBow(hint.Bow, hint.uuid);
    }
    seekToTimestamp({
      time: hint.Time,
      bow: hint.Bow,
      offsetMilli:
        hint.Gate && hint.Gate === gateFromWaypoint(getWaypoint())
          ? 0
          : getClickOffset().offsetMilli,
    });
  };

  return (
    <Box
      sx={{
        maxWidth: '100%',
        height: height - 8,
        paddingRight: '4px',
        ...sx,
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ px: '0.5em', pt: '0.5em' }}>
        {unknownHints.map((hint, index) => (
          <UnknownHintButton
            key={hint?.uuid || `unknown-${index}`}
            active={!!hint?.Time}
            label={hint?.Bow || '?'}
            selected={
              hint?.Bow === '?'
                ? videoBow === '?' && videoBowUuid === hint?.uuid
                : videoBow === hint?.Bow && videoEvent === hint?.EventNum
            }
            time={hint?.Time}
            eventNum={hint?.EventNum}
            onClick={() => jumpToHint(hint)}
          />
        ))}
      </Stack>
      <Stack direction="row">
        <Tooltip title={videoDir} placement="bottom">
          <Button
            size="small"
            variant="contained"
            color="secondary"
            className={classes.button}
            onClick={() => {
              chooseDir();
            }}
          >
            Folder
          </Button>
        </Tooltip>
        <Tooltip title="Explore Recording Folder">
          <IconButton
            color="primary"
            aria-label="Open Folder"
            onClick={() => openFileExplorer(videoDir)}
            size="small"
          >
            <OpenInNewIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <FileList
        files={dirList}
        height={height - 8 - 35 - UNKNOWN_HINT_ROW_HEIGHT}
      />
    </Box>
  );
};

export default VideoSideBar;
