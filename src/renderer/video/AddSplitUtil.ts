import { Entry, Lap } from 'crewtimer-common';
import type { AppImage } from 'renderer/shared/AppTypes';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import {
  setEntryResultAndPublish,
  getEntryResult,
} from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import uuidgen from 'short-uuid';
import { setToast } from 'renderer/Toast';
import {
  getAutoZoomToFinish,
  getMobileConfig,
  getWaypoint,
} from 'renderer/util/UseSettings';
import {
  getAutoNextTimestamp,
  getAnnotatedBow,
  getVideoBow,
  getVideoBowUuid,
  getVideoEvent,
  getVideoTimestamp,
  setLastScoredTimestamp,
  resetVideoZoom,
  setVideoBow,
} from './VideoSettings';
import { seekToNextTimePoint } from './VideoUtils';
import { setAutoSeekHoldoff } from './AutoFileSplit';
import { saveInterpolationRecordForLap } from './InterpolationStore';
import { autoZoomToFinishNearFinish } from './AutoZoomToFinish';

let lastAddSplit = 0;

const autoZoomAfterNextTimestamp = async (
  next: { Bow?: string; uuid?: string },
  image: AppImage,
) => {
  if (getAutoZoomToFinish()) {
    const result = await autoZoomToFinishNearFinish(
      next.Bow || '',
      Number.POSITIVE_INFINITY,
      image,
    );
    if (!result) {
      return;
    }
    const detectedBow = result.bow.trim();
    if (next.Bow === '?' && detectedBow && detectedBow !== '?') {
      setVideoBow(detectedBow, next.uuid);
    }
  }
};

const persistLap = (key: string, lap: Lap) => {
  setEntryResultAndPublish(key, lap);
  saveInterpolationRecordForLap(lap).catch((error) => {
    console.warn(
      'Failed to save interpolation metadata',
      error instanceof Error ? error.message : String(error),
    );
  });
};

const addSplitForBow = (videoBow: string) => {
  // A split must be associated with a known bow.
  if (videoBow === '?' || !videoBow) {
    setToast({
      severity: 'info',
      msg: `Bow must be set to add a split.  Current bow is '${videoBow}'`,
    });
    return;
  }
  const selectedEvent = getVideoEvent();
  const videoBowUuid = getVideoBowUuid();
  const mobileConfig = getMobileConfig();
  const waypoint = getWaypoint();
  const gate = gateFromWaypoint(waypoint);
  const videoTimestamp = getVideoTimestamp();
  const autoNextTimestamp = getAutoNextTimestamp();
  const disabled = !videoTimestamp || !selectedEvent;
  const activeEvent = mobileConfig?.eventList?.find(
    (event) => event.EventNum === selectedEvent,
  );

  const now = Date.now();
  const deltaT = now - lastAddSplit;
  if (deltaT < 500) {
    return; // probable double click
  }
  lastAddSplit = now;
  if (!mobileConfig || !activeEvent || disabled) {
    setToast({
      severity: 'error',
      msg: `Event ${selectedEvent} not found`,
    });
    return;
  }
  const entry: Entry | undefined = activeEvent.eventItems.find(
    (item) => item.Bow === videoBow,
  );

  const key = `${gate}_${entry?.EventNum || '?'}_${videoBow}`;
  const priorLap = getEntryResult(key);
  const lap: Lap = {
    keyid: key,
    uuid: priorLap?.uuid || uuidgen.generate(),
    SequenceNum: priorLap?.SequenceNum || 0,
    Bow: videoBow,
    Time: videoTimestamp,
    EventNum: entry?.EventNum || '?',
    Gate: gate,
    Crew: '',
    CrewAbbrev: '',
    Event: '',
    EventAbbrev: '',
    AdjTime: '',
    Place: 0,
    Stroke: '',
  };

  if (!entry) {
    setDialogConfig({
      title: `Not in schedule`,
      message: `Entry '${videoBow}' is not in schedule for event '${selectedEvent}'.  Add anyway??`,
      button: 'Add',
      showCancel: true,
      handleConfirm: () => {
        delete lap.State;
        setAutoSeekHoldoff(false);
        persistLap(key, lap);
        if (lap.Time) {
          setLastScoredTimestamp(lap.Time);
        }
      },
    });
    return;
  }

  if (priorLap && priorLap.State !== 'Deleted') {
    setDialogConfig({
      title: `Time Already Recorded`,
      message: `A time has already been recorded for bow ${videoBow}.  OK to replace?`,
      button: 'Replace',
      showCancel: true,
      handleConfirm: () => {
        delete lap.State;
        setAutoSeekHoldoff(false);
        persistLap(key, lap);
        if (lap.Time) {
          setLastScoredTimestamp(lap.Time);
        }
        setToast({
          severity: 'info',
          msg: `E${selectedEvent}/${videoBow} = ${videoTimestamp}`,
        });
        seekToNextTimePoint(
          { time: lap.Time, bow: lap.Bow, uuid: videoBowUuid },
          autoNextTimestamp ? autoZoomAfterNextTimestamp : undefined,
        );
      },
    });
    return;
  }

  setAutoSeekHoldoff(false);
  persistLap(key, lap);
  if (lap.Time) {
    setLastScoredTimestamp(lap.Time);
  }
  setToast({
    severity: 'info',
    msg: `E${selectedEvent}/${videoBow} = ${videoTimestamp}`,
  });
  if (autoNextTimestamp) {
    seekToNextTimePoint(
      { time: lap.Time, bow: lap.Bow, uuid: videoBowUuid },
      autoZoomAfterNextTimestamp,
    );
  } else {
    resetVideoZoom();
  }
};

export const performAddSplit = () => {
  const videoBow = getVideoBow();
  const annotatedBow = getAnnotatedBow();
  if (
    videoBow &&
    videoBow !== '?' &&
    annotatedBow &&
    annotatedBow !== '?' &&
    videoBow !== annotatedBow
  ) {
    setDialogConfig({
      title: 'Bow Number Mismatch',
      message: `The current bow number (${videoBow}) does not match the detected bow number (${annotatedBow}).`,
      secondaryButton: `Use ${videoBow}`,
      secondaryColor: 'primary',
      button: `Use ${annotatedBow}`,
      showCancel: true,
      handleSecondary: () => {
        addSplitForBow(videoBow);
      },
      handleConfirm: () => {
        setVideoBow(annotatedBow);
        addSplitForBow(annotatedBow);
      },
    });
    return;
  }
  addSplitForBow(videoBow);
};
