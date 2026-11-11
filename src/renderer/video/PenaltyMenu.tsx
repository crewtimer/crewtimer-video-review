import React from 'react';
import { Divider, Menu, MenuItem } from '@mui/material';
import { Lap } from 'crewtimer-common';
import uuidgen from 'short-uuid';
import { UseDatum } from 'react-usedatum';
import { setToast } from 'renderer/Toast';
import {
  getEntryResult,
  setEntryResultAndPublish,
} from 'renderer/util/LapStorageDatum';
import { milliToString } from 'renderer/util/Util';

/** Penalty codes CrewTimer accepts, as sent by CrewTimer FL Connect. */
export const PENALTY_CODES = ['DNS', 'DNF', 'DQ', 'Scratch'] as const;

export const [usePenaltyMenuAnchor, setPenaltyMenuAnchor] = UseDatum<{
  element: Element;
  eventNum: string;
  bow: string;
} | null>(null);

/** Key of the crew's penalty lap, alongside its gate keys such as F_12_3. */
export const penaltyKey = (eventNum: string, bow: string) =>
  `Pen_${eventNum}_${bow}`;

/** The crew's current penalty code, or '' when none is set. */
export const getPenaltyCode = (eventNum: string, bow: string) => {
  const lap = getEntryResult(penaltyKey(eventNum, bow));
  return lap && lap.State !== 'Deleted' ? lap.PenaltyCode || '' : '';
};

const timeOfDay = () => {
  const now = new Date();
  return milliToString(
    ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 +
      now.getMilliseconds(),
  );
};

/**
 * Sets or clears (code '') the crew's penalty. Like CrewTimer FL Connect,
 * the penalty is a lap at gate 'Pen' with a PenaltyCode, timed when set.
 */
export const setPenalty = (eventNum: string, bow: string, code: string) => {
  const key = penaltyKey(eventNum, bow);
  const prior = getEntryResult(key);
  if (!code) {
    if (prior && prior.State !== 'Deleted') {
      setEntryResultAndPublish(key, { ...prior, State: 'Deleted' });
    }
    return;
  }
  const lap: Lap = {
    keyid: key,
    uuid: prior?.uuid || uuidgen.generate(),
    SequenceNum: prior?.SequenceNum || 0,
    Bow: bow,
    Time: timeOfDay(),
    EventNum: eventNum,
    Gate: 'Pen',
    PenaltyCode: code,
    Crew: '',
    CrewAbbrev: '',
    Event: '',
    EventAbbrev: '',
    AdjTime: '',
    Place: 0,
    Stroke: '',
  };
  setEntryResultAndPublish(key, lap);
};

/** Menu opened by shift-clicking a bow to set or clear its penalty. */
const PenaltyMenu: React.FC = () => {
  const [anchor] = usePenaltyMenuAnchor();
  const close = () => setPenaltyMenuAnchor(null);
  if (!anchor) {
    return null;
  }
  const { eventNum, bow } = anchor;
  const current = getPenaltyCode(eventNum, bow);

  const choose = (code: string) => {
    close();
    if (code === current) {
      return;
    }
    setPenalty(eventNum, bow, code);
    setToast({
      severity: 'info',
      msg: code
        ? `E${eventNum}/${bow} = ${code}`
        : `E${eventNum}/${bow} ${current} cleared`,
    });
  };

  return (
    <Menu
      id="penalty-menu"
      anchorEl={anchor.element}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open
      onClose={close}
    >
      {PENALTY_CODES.map((code) => (
        <MenuItem
          key={code}
          selected={code === current}
          onClick={() => choose(code)}
        >
          {code} {bow}
        </MenuItem>
      ))}
      {current && <Divider />}
      {current && (
        <MenuItem onClick={() => choose('')}>
          Clear {current} for {bow}
        </MenuItem>
      )}
    </Menu>
  );
};

export default PenaltyMenu;
