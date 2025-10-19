import { Entry, Lap } from 'crewtimer-common';
import { setDialogConfig } from 'renderer/util/ConfirmDialog';
import {
  setEntryResultAndPublish,
  getEntryResult,
} from 'renderer/util/LapStorageDatum';
import { gateFromWaypoint } from 'renderer/util/Util';
import uuidgen from 'short-uuid';
import { setToast } from 'renderer/Toast';
import {
  getMobileConfig,
  getWaypoint,
  updateClickOffset,
} from 'renderer/util/UseSettings';
import {
  getAutoNextTimestamp,
  getLastSeekTime,
  getVideoBow,
  getVideoEvent,
  getVideoTimestamp,
  setLastScoredTimestamp,
  setResetZoomCounter,
} from './VideoSettings';
import { seekToNextTimePoint } from './VideoUtils';
import { setAutoSeekHoldoff } from './AutoFileSplit';

let lastAddSplit = 0;
export const performAddSplit = () => {
  const videoBow = getVideoBow();
  const selectedEvent = getVideoEvent();
  const mobileConfig = getMobileConfig();
  const waypoint = getWaypoint();
  const gate = gateFromWaypoint(waypoint);
  const videoTimestamp = getVideoTimestamp();
  const autoNextTimestamp = getAutoNextTimestamp();
  const disabled = !videoBow || !videoTimestamp || !selectedEvent;
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
        setEntryResultAndPublish(key, lap);
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
        updateClickOffset(getLastSeekTime().time, videoTimestamp);
        setAutoSeekHoldoff(false);
        setEntryResultAndPublish(key, lap);
        setResetZoomCounter((c) => c + 1);
        setToast({
          severity: 'info',
          msg: `E${selectedEvent}/${videoBow} = ${videoTimestamp}`,
        });
        seekToNextTimePoint({ time: lap.Time, bow: lap.Bow });
      },
    });
    return;
  }

  updateClickOffset(getLastSeekTime().time, videoTimestamp);

  setAutoSeekHoldoff(false);
  setEntryResultAndPublish(key, lap);
  if (lap.Time) {
    setLastScoredTimestamp(lap.Time);
  }
  setResetZoomCounter((c) => c + 1);
  setToast({
    severity: 'info',
    msg: `E${selectedEvent}/${videoBow} = ${videoTimestamp}`,
  });
  if (autoNextTimestamp) {
    seekToNextTimePoint({ time: lap.Time, bow: lap.Bow });
  }
};
