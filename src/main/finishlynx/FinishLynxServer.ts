import net, { Socket } from 'net';
import uuidgen from 'short-uuid';
import { Lap } from 'crewtimer-common';
import Log from '../../renderer/util/Log';
import {
  getBowToEvent,
  getDebugLevel,
  getFLStartWaypoint,
  getFLStartWaypointEnable,
  getLynxPort,
  getMobileConfig,
  getWaypoint,
  setLynxState,
} from '../main-settings';
import { getLaps, storeLap } from '../lapstorage/LapStorage';
import { userMessage } from '../util/util-handlers';
import {
  gateFromWaypoint,
  milliToString,
  timeToMilli,
} from '../../renderer/util/Util';

interface FLResult {
  l: string; /// lane/bow
  t: string; /// timestamp either elapsed or TOD
  id: string; /// 'event-bow'
  p: string; /// place
}

interface FLPub {
  v: number;
  event: string;
  eventNum: string;
  round: string;
  heat: string;
  start?: string; /// Start time if Manual Start/RadioLynx used.  Results will be elapsed
  results: FLResult[];
}

const HOST = '127.0.0.1';
// On a mac, 5000 is used by the 'airplay receiver'.  To allow use of 5000,
// go to System Preferences, search for airplay, and turn off Airplay Receiver.
const penalties = ['DNS', 'DNF', 'Scratch', 'DQ'];

const sockets = new Set<Socket>();

let inputQueue = '';
const server = net.createServer((sock: Socket) => {
  inputQueue = '';
  setLynxState({
    connected: true,
    remoteAddress: sock.remoteAddress || '',
    error: '',
  });
  Log.info('FL', `CONNECTED: ${sock.remoteAddress}:${sock.remotePort}`);
  sockets.add(sock);

  // Add a 'close' event handler to this instance of socket
  sock.on('close', (had_error: boolean) => {
    inputQueue = '';
    setLynxState({ connected: false, remoteAddress: '', error: '' });
    sockets.delete(sock);
    Log.info(
      'FL',
      `CLOSED: ${sock.remoteAddress} ${sock.remotePort} error: ${had_error}`
    );
  });

  sock.on('data', (data: Buffer) => {
    const debugLevel = getDebugLevel();
    const msgraw = data.toString().replace('\n', '');
    inputQueue += msgraw;
    if (debugLevel) {
      userMessage.info(`FL packet rx bytes=${msgraw.length}`);
    }
    const eom = inputQueue.indexOf('],"eof":"1"}');
    if (eom < 0) {
      return;
    }

    if (debugLevel) {
      userMessage.info(`FL pkt len=${inputQueue.length}, end=${eom + 12}`);
    }
    const msg = inputQueue;
    if (debugLevel > 2) {
      userMessage.info(`FL msg=${msg}`);
    }

    inputQueue = '';
    // Log.info('FL', `Rx ${msg}`);
    let ok = true;
    try {
      const pub = JSON.parse(msg) as FLPub;
      if (debugLevel > 1) {
        userMessage.info(`FL ${JSON.stringify(pub, null, 2)}`);
      }
      const { v: version, eventNum, event, results, start } = pub;
      // validate
      if (version !== 2) {
        userMessage.info(`FL unsupported version=#{version}`);
        return;
      }
      if (
        eventNum === undefined ||
        event === undefined ||
        results === undefined ||
        !Array.isArray(results)
      ) {
        ok = false;
        return;
      }

      const mobileSettings = getMobileConfig();
      const bowToEvent = getBowToEvent();
      const waypoint = getWaypoint();
      const flStartEnable = getFLStartWaypointEnable();
      const flStartWaypoint = getFLStartWaypoint();
      const laps = getLaps();

      results.forEach((result) => {
        const { id, l: lane, t: time } = result;
        let { p: place } = result;
        let [EventNum, Bow] = [eventNum, lane];
        if (place === 'SCR') {
          place = 'Scratch';
        }

        // If lane is 12-3 interpret as eventNum-lane
        // Else if id as 12-3 interpret as eventNum-lane
        const idParts = (id || '').split('-'); // id added in later version
        const laneParts = lane.split('-');
        if (laneParts.length === 2) {
          [EventNum, Bow] = laneParts;
        } else if (idParts.length === 2) {
          [EventNum, Bow] = idParts;
        }
        if (EventNum === 'TimeTrial') {
          // Search events looking for a lane match
          EventNum = bowToEvent.get(Bow) ?? '?';
        }
        const eventInfo = mobileSettings?.eventList.find(
          (ev) => ev.EventNum === EventNum
        );
        if (!eventInfo) {
          EventNum = bowToEvent.get(Bow) ?? '?';
        }

        const isSprint =
          (eventInfo?.RaceType
            ? eventInfo.RaceType
            : mobileSettings?.info.RaceType) === 'Sprint';
        const isSprintStart =
          eventInfo && waypoint.toLowerCase().includes('start') && isSprint;

        let timestamp = time.trim();
        const timeMilli = timeToMilli(timestamp);
        // If we have a start time and the timestamp doens't look like a wall clock time, calc it.
        if (start && !timestamp.match(/^.*:.*:.*/)) {
          // timestamp is elapsed relative to start
          timestamp = milliToString(timeToMilli(start) + timeMilli, true);
        }

        const now = new Date();
        let milliNow = now.getHours() * 3600 * 1000;
        milliNow += now.getMinutes() * 60 * 1000;
        milliNow += now.getSeconds() * 1000;
        milliNow += now.getMilliseconds();

        const gate = gateFromWaypoint(waypoint);
        const keyid = `${gate}-${EventNum}-${Bow}`;
        const penid = `Pen-${EventNum}-${Bow}`;
        const hasPenalty = penalties.includes(place);
        const existing = laps.find((lap) => lap.keyid === keyid);
        // retain old uuid if we're updating
        const uuid = existing ? existing.uuid : uuidgen.generate();
        const lap: Lap = {
          keyid,
          uuid,
          Bow: isSprintStart ? '*' : Bow,
          EventNum,
          Time: timestamp,
          Crew: '',
          CrewAbbrev: '',
          Event: event,
          EventAbbrev: '',
          Gate: gate,
          AdjTime: '',
          Place: 0,
          Stroke: '',
        };

        if (isSprint && flStartEnable && start) {
          const startGate = gateFromWaypoint(flStartWaypoint);
          storeLap({
            ...lap,
            uuid: uuidgen.generate(),
            keyid: `${startGate}-${EventNum}-*`,
            Bow: '*',
            Time: start,
            Gate: startGate,
          });
        }

        const existingPen = laps.find((item) => item.keyid === penid);
        if (existingPen) {
          const newLap = { ...existingPen };
          // console.log(JSON.stringify({ hasPenalty, place }));
          if (
            place === existingPen.PenaltyCode &&
            existingPen.State !== 'Deleted'
          ) {
            // ignore - no change
          } else if (place === '' || !hasPenalty) {
            // Transition to deleted state
            newLap.State = 'Deleted';
            storeLap(newLap);
          } else {
            // Store the new or modified penalty
            delete newLap.State;
            newLap.PenaltyCode = place;
            newLap.Time = milliToString(milliNow);
            storeLap(newLap);
          }
        } else if (hasPenalty) {
          storeLap({
            ...lap,
            uuid: uuidgen.generate(),
            keyid: penid,
            Time: milliToString(milliNow),
            Bow,
            PenaltyCode: place,
            Gate: 'Pen',
          });
        }

        if (time) {
          if (existing) {
            if (timeMilli === 0) {
              lap.State = 'Deleted';
            } else {
              delete lap.State; // it might have been deleted
            }
          }
          storeLap(lap);
        }
      });
    } catch (e) {
      Log.error('FL', `${e} Input=${msg}`);
      ok = false;
    }

    if (!ok) {
      userMessage.info(
        'Malformed FinishLynx packet. Turn on Scoreboard results paging with Time=0.0, select CrewTimer.lss as the script'
      );
    }
  });
});

server.on('error', (err) => {
  let msg = err.message;
  if (err.message.includes('EADDRINUSE')) {
    msg = `Port ${getLynxPort()} is already in use.`;
  }
  Log.error('FL', msg);
  setLynxState({ connected: false, remoteAddress: '', error: msg });
});

export const stopLynxServer = () => {
  try {
    server.close();
    sockets.forEach((sock) => sock.end());
    sockets.clear();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Log.error('FL', msg);
    setLynxState({ connected: false, remoteAddress: '', error: msg });
  }
};

export const startLynxServer = () => {
  try {
    stopLynxServer();

    setLynxState({ connected: false, remoteAddress: '', error: '' });
    server.listen(getLynxPort());
    Log.info('FL', `Server listening on ${HOST}:${getLynxPort()}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Log.error('FL', msg);
    setLynxState({ connected: false, remoteAddress: '', error: msg });
  }
};
