/*
; This file, 'lynx.evt', contains events and who is in them.

; Format:

; event number, round number, heat number, event name, <wind>, <wind unit>, template, capture time, capture duration, distance
; <tab, space, or comma>ID, lane, last name, first name, affiliation, <time>, license, <delta time>, <ReacTime>, <splits>, time trial start time, user 1, user 2, user 3, <delta time 2>, <delta time 3>, <speed>, <pace>
; <tab, space, or comma> .
; <tab, space, or comma> .

; or

; event number, round number, heat number, event name
; event number, round number, heat number, event name

; Notes:

; + Any line starting with a semicolon is ignored.
; + In general, you can omit unnecessary or unknown information.
; + To indicate no lane assignment leave the lane field blank or use a zero.
; + To indicate no ID number you must put a zero in the ID field.
; + To indicate a competitor status, the first character of the participant line
;   must be a backslash (\).
; + If NO participants are listed after an event entry FinishLynx will
;   attempt to locate each participant's information in the .ppl file
;   when their ID number is entered.

41,6,1,Decat Men 110 Meter Hurdles
,758,2,Killin,Sam,Purdue
,646,4,Zsivoczky,Attila,Kansas State
,507,6,Johnson,Dominic,Arizona
,804,8,Ploetz,Ben,Southwest Texas
41,6,2,Decat Men 110 Meter Hurdles
*/
import { BrowserWindow, dialog, OpenDialogOptions } from 'electron';
import fs from 'fs';
import path from 'path';
import { getMainWindow } from '../mainWindow';
import { getAssetPath } from '../assets';
import {
  getLynxFolder,
  setLynxFolder,
  getLynxFolderOK,
  setLynxFolderOK,
  getMobileConfig,
  setBowToEvent,
  getDay,
  setMobileConfigDate,
  getFlightRaces,
} from '../main-settings';
import { userMessage } from '../util/util-handlers';

export interface LynxEvent {
  eventNum: string;
  roundNum: string;
  heatNum: string;
  eventName: string;
  wind?: string;
  windUnit?: string;
  template?: string;
  captureTime?: string;
  captureDuration?: string;
  distance?: string;
}

export interface LynxEntry {
  empty: '';
  ID: string | '0';
  lane: string | '' | '0';
  lastName: string;
  firstName: string | '';
  affiliation: string;
}

/*
; This file, 'lynx.sch', contains the schedule of events.

; Format:

; event number, round number, heat number
; event number, round number, heat number
; .
; .
; .

; Notes:

; + Any line starting with a semicolon is ignored.
; + If you omit the heat number or the round and heat numbers they will
;   default to 1.
*/

export interface LynxSchedule {
  eventNum: string;
  roundNum: string;
  heatNum: string;
}

const handleFileOpen = async (options: OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(
    getMainWindow() as BrowserWindow,
    options
  );
  return result;
};

export async function getDir(dir: string) {
  const options: Electron.OpenDialogOptions = {
    // See place holder 1 in above image
    title: 'Select Lynx input folder',

    // // See place holder 2 in above image
    defaultPath: dir,

    // // See place holder 3 in above image
    // buttonLabel: 'Custom button',

    properties: ['openDirectory'],
  };

  // Synchronous
  const result = await handleFileOpen(options);
  if (result.canceled) {
    return dir;
  }
  return result.filePaths[0];
}

export function refreshLynxLssFile(folder: string) {
  if (!getLynxFolderOK()) {
    return;
  }
  try {
    const lsspath = path.join(folder, 'CrewTimer.lss');
    // Write lss file if it does not exist
    fs.access(lsspath, (err: unknown) => {
      const pathToTemplate = getAssetPath('CrewTimer.lss');

      // Note: the sync methods will throw to a browser alert rather than being captured
      // by try catch
      const template = fs.readFileSync(pathToTemplate, 'utf8');
      if (err || template !== fs.readFileSync(lsspath, 'utf8')) {
        fs.writeFile(lsspath, template, (err) => {
          if (err) {
            setLynxFolderOK(false);
            userMessage.info(err instanceof Error ? err.message : String(err));
          }
        });
      }
    });
  } catch (err) {
    setLynxFolderOK(false);
    userMessage.info(err instanceof Error ? err.message : String(err));
  }
}

// Remove chars which may confuse JSON encoding of strings
const sanitize = (s?: string) => {
  return s?.replaceAll(',', ' ').replaceAll("'", '');
};
export async function generateEvtFiles() {
  const day = getDay();
  const dir = getLynxFolder();
  const flightRacesRegex = getFlightRaces() || '^.*';
  const mobileConfig = getMobileConfig();
  if (!mobileConfig) {
    return;
  }
  let flightRaces = mobileConfig.info.FlightRaces || [];
  // {"R111":["R111","R112","R113"],"R129":["R129","R130"],"R145":["R145","R146"],"R149":["R149","R150"],"R157":["R157","R158"],"R172":["R172","R173","R174"],"R219":["R219","R220"],"R221":["R221","R222","R223"],"R230":["R230","R231","R232"],"R234":["R234","R235","R236"],"R241":["R241","R242"],"R243":["R243","R244","R245"],"R248":["R248","R249","R250"],"R252":["R252","R253"],"R260":["R260","R261"],"R262":["R262","R263","R264"],"R268":["R268","R269"],"R273":["R273","R274"],"R307":["R307","R308"],"R315":["R315","R316"],"R338":["R338","R339"],"R428":["R428","R429"],"R431":["R431","R432"],"R442":["R442","R443"],"R449":["R449","R450"],"R453":["R453","R454"],"R457":["R457","R458","R459"],"R467":["R467","R468"],"R469":["R469","R470","R471"],"R478":["R478","R479","R480"],"R487":["R487","R488"],"R494":["R494","R495"],"R112":["R111","R112","R113"],"R113":["R111","R112","R113"],"R130":["R129","R130"],"R146":["R145","R146"],"R150":["R149","R150"],"R158":["R157","R158"],"R173":["R172","R173","R174"],"R174":["R172","R173","R174"],"R220":["R219","R220"],"R222":["R221","R222","R223"],"R223":["R221","R222","R223"],"R231":["R230","R231","R232"],"R232":["R230","R231","R232"],"R235":["R234","R235","R236"],"R236":["R234","R235","R236"],"R242":["R241","R242"],"R244":["R243","R244","R245"],"R245":["R243","R244","R245"],"R249":["R248","R249","R250"],"R250":["R248","R249","R250"],"R253":["R252","R253"],"R261":["R260","R261"],"R263":["R262","R263","R264"],"R264":["R262","R263","R264"],"R269":["R268","R269"],"R274":["R273","R274"],"R308":["R307","R308"],"R316":["R315","R316"],"R339":["R338","R339"],"R429":["R428","R429"],"R432":["R431","R432"],"R443":["R442","R443"],"R450":["R449","R450"],"R454":["R453","R454"],"R458":["R457","R458","R459"],"R459":["R457","R458","R459"],"R468":["R467","R468"],"R470":["R469","R470","R471"],"R471":["R469","R470","R471"],"R479":["R478","R479","R480"],"R480":["R478","R479","R480"],"R488":["R487","R488"],"R495":["R494","R495"]}
  const combinedRaces = JSON.parse(mobileConfig.info.CombinedRaces || '{}') as {
    [eventNum: string]: string[];
  };
  flightRaces = [...flightRaces, ...Object.values(combinedRaces)];

  const evtTypes = new Set<string>();
  let { eventList } = mobileConfig;
  if (!eventList) {
    eventList = [];
  }
  if (day) {
    eventList = eventList.filter((event) => event.Day === day);
  }

  const flights = new Map<string, string[]>();
  const flightsLookup = new Map<string, string>();
  const flightInSchedule = new Set<string>();

  if (flightRacesRegex) {
    const regex = RegExp(flightRacesRegex);
    const numList: string[] = [];

    eventList.forEach((event) => {
      if (regex.test(event.EventNum)) {
        numList.push(event.EventNum);
      }
    });
    flightRaces = [...flightRaces, numList];
    // Log.info('DBG', JSON.stringify(numList));
  }

  flightRaces.forEach((race) => {
    if (race.length === 0) {
      return;
    }
    const compositeEventNum = `C${race[0]}-${race[race.length - 1]}`;
    race.forEach((eventNum) => {
      //  Log.info('flts', `setting ${eventNum} to ${compositeEventNum}`);
      flightsLookup.set(eventNum, compositeEventNum);
    });
    flights.set(compositeEventNum, []);
    // Log.info('DBG', compositeEventNum);
  });

  userMessage.info(
    `Orig events ${mobileConfig.eventList?.length}, pruned=${eventList.length}, day='${day}'`
  );

  // Look thru races and get some info
  const bowToEventList = new Map<string, string[]>();
  eventList.forEach((event) => {
    // const raceType = event.RaceType || mobileConfig.info.RaceType;
    evtTypes.add(event.RaceType || mobileConfig.info.RaceType);

    event.eventItems.forEach((entry) => {
      const events = bowToEventList.get(entry.Bow) || [];
      events.push(entry.EventNum);
      bowToEventList.set(entry.Bow, events);
    });
  });

  const bowToEvent = new Map<string, string>();
  // eslint-disable-next-line no-restricted-syntax
  for (const [bow, events] of bowToEventList) {
    if (events.length === 1) {
      bowToEvent.set(bow, events[0]);
    }
  }

  let evtdata: (string[] | string)[] = [];
  let schdata: string[] = [];
  eventList.forEach((event) => {
    // const raceType = event.RaceType || mobileConfig.info.RaceType;
    const evt = `${event.EventNum},0,0,${sanitize(event.Event)}`;
    const entries: string[] = [];
    const eventNum = event.EventNum;
    const compositeEventNum = flightsLookup.get(eventNum);
    const flightEntries = flights.get(compositeEventNum || '');

    // Log.info(
    //   'DBG',
    //   JSON.stringify({ eventNum, compositeEventNum, flightEntries })
    // );

    // include composite flight
    if (
      compositeEventNum &&
      flightEntries &&
      !flightInSchedule.has(compositeEventNum)
    ) {
      // First time seeing this composite event.  Add to schedule as a flight.
      flightInSchedule.add(compositeEventNum);
      const nicekey = `FLT-${compositeEventNum
        .replaceAll(' FA', '')
        .replaceAll(' ', '')}`; // RM appends FA to finals

      schdata.push(`${nicekey},0,0`);
      evtdata.push(`${nicekey},0,0,${nicekey}`);
      evtdata.push(flightEntries);
    }

    // Add Regular schedule item and event header even if a composite event
    schdata.push(`${event.EventNum},0,0`);
    evtdata.push(evt);

    // construct a line as ',<evt-bow>,<bow>,<stroke>,<event>,<crew>'
    // or ',<evt-bow>,<evt-bow>,<stroke>,<event>,<crew>' when dups present
    event.eventItems.forEach((entry) => {
      const eventStart = event.Start;
      const line = `${entry.Bow},${
        entry.Stroke ? sanitize(entry.Stroke) : ''
      },${sanitize(eventStart)}${eventStart ? ' ' : ''}${sanitize(
        event.Event
      )},${sanitize(entry.Crew)} (${sanitize(entry.CrewAbbrev)})`;

      // Inject ID field and make Bow unique for All race
      const flEntry = `,${event.EventNum}-${entry.Bow},${line}`;
      if (flightEntries) {
        flightEntries.push(flEntry);
      }
      entries.push(flEntry);
    });

    evtdata.push(entries);
  });

  evtdata = evtdata.flat();
  schdata = [
    // 'All,0,0',
    ...schdata,
  ];

  setBowToEvent(bowToEvent);

  const evtpath = path.join(dir, 'Lynx.evt');
  const schpath = path.join(dir, 'Lynx.sch');
  fs.writeFileSync(evtpath, evtdata.join('\n'));
  fs.writeFileSync(schpath, schdata.join('\n'));
  refreshLynxLssFile(dir);
  setMobileConfigDate(new Date().toLocaleString('en-US'));
}

export async function chooseLynxFolder() {
  const dir = await getDir(getLynxFolder());
  setLynxFolder(dir);
  generateEvtFiles();
}
