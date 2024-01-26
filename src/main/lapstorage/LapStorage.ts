import SQLite, { Database, RunResult } from 'sqlite3';
import { app } from 'electron';
import path from 'path';
import { Lap } from 'crewtimer-common';
import { LapDatumName } from '../../renderer/shared/Constants';
import Log from '../../renderer/util/Log';
import { getMemValue, setMemValue } from '../store/store';
import { timeToMilli } from '../../renderer/util/Util';

// SQLite.DEBUG(true);
// SQLite.enablePromise(true);

const DATABASE_NAME = 'CrewTimer.db';

const TABLE_NAME = 'TimeRecords';
const DATUM_COL = 'Datum';
const UUID_COL = 'uuid';

export const getLaps = () => getMemValue<Lap[]>(LapDatumName, []);
const setLaps = (laps: Lap[]) => setMemValue(LapDatumName, laps);

const updateProgress = (message: string) => {
  Log.info('SQL', message);
};
class LapStorage {
  static db: Database = new SQLite.Database(':memory:');

  static dropping = false;

  static errorCB = (err: Error) => {
    Log.error('Lap', `Err:${err.message || err}`);
  };

  static onQueueLapForTx: (lap: Lap) => void = () => {};

  initDatabase = async () => {
    try {
      Log.info('Sqlite', `Database stored at ${app.getPath('userData')}`);
      LapStorage.db = new SQLite.Database(
        path.join(app.getPath('userData'), DATABASE_NAME) /* ':memory:' */
      );
      await this.verifyDatabase();
    } catch (error) {
      Log.error(
        'Sqlite',
        `echoTest failed - plugin not functional${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  };

  verifyDatabase = async () => {
    return new Promise((resolve, reject) => {
      try {
        updateProgress('Database integrity check');
        // This query should never fail unless the db itself does not exist
        LapStorage.db.all(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='Version';",
          (err, rows) => {
            if (!err && rows.length > 0) {
              updateProgress('Already initialized');
              resolve(undefined);
              return;
            }
            updateProgress('Database not yet ready ... populating data');
            const err2 = this.populateDB();

            if (err2) {
              updateProgress(
                err2 instanceof Error ? err2.message : String(err2)
              );
              reject(err2);
            } else {
              updateProgress('Database populated ... ');
              resolve(undefined);
            }
          }
        );
      } catch (error) {
        updateProgress(error instanceof Error ? error.message : String(error));
        reject(error);
      }
    });
  };

  closeDatabase = async () => {
    const promiseClose = new Promise((resolve) => {
      if (LapStorage.db) {
        updateProgress('Closing DB');

        LapStorage.db.close((err) => {
          if (err) LapStorage.errorCB(err);
          updateProgress('Database CLOSED');
          resolve(undefined);
        });
      } else {
        updateProgress('Database was not OPENED');
        resolve(undefined);
      }
    });
    return promiseClose;
  };

  populateDB = () => {
    try {
      LapStorage.db.serialize(() => {
        updateProgress('Executing DROP stmts');
        LapStorage.db.run(`DROP TABLE IF EXISTS ${TABLE_NAME};`);
        // await tx.run('DROP VIEW IF EXISTS GetTimeRecords;');
        updateProgress('Executing CREATE stmts');
        LapStorage.db.run(
          'CREATE TABLE IF NOT EXISTS Version( version_id INTEGER PRIMARY KEY NOT NULL);'
        );
        LapStorage.db.run(
          `CREATE TABLE ${TABLE_NAME} (${DATUM_COL} STRING, ${UUID_COL} STRING PRIMARY KEY);`
        );

        // await tx.run(
        //   'CREATE VIEW GetTimeRecords AS SELECT * FROM ' + TABLE_NAME
        // );

        Log.trace('SQL', 'all config SQL done');
      });
      return undefined;
    } catch (error) {
      updateProgress(error instanceof Error ? error.message : String(error));
      LapStorage.errorCB(error as unknown as Error);
      return error;
    }
  };

  static truncateLapTable = async () => {
    updateProgress('Truncating Lap Table');
    setLaps([]);
    if (LapStorage.dropping || !LapStorage.db) return; // drop in progress
    LapStorage.dropping = true;
    try {
      LapStorage.db.serialize(() => {
        LapStorage.db.run(`DROP TABLE IF EXISTS ${TABLE_NAME};`);
        LapStorage.db.run(
          `CREATE TABLE ${TABLE_NAME} (${DATUM_COL} STRING, ${UUID_COL} STRING PRIMARY KEY);`
        );
        LapStorage.dropping = false;
      });
    } catch (error) {
      LapStorage.dropping = false;
      LapStorage.errorCB(error as unknown as Error);
      throw error;
    }
  };

  /**
   * Update an existing entry in the lap list.  If it does not already exist, it will be
   * appended to the list.  Note that for Lynx use, we use event-bow as a unique keyid to allow
   * Lynx to update an existing entry.
   *
   * @param datum The lap datum to update.
   */
  static updateLap = (datum: Lap) => {
    const seqNum = datum.SequenceNum || 0;
    datum.SequenceNum = seqNum + 1;
    datum.Timestamp = Date.now();

    const laps = getLaps();
    const existing = laps.findIndex((lap) => lap.keyid === datum.keyid);
    if (existing >= 0) {
      laps[existing] = datum;
    } else {
      laps.push(datum); // Add to end
    }
    setLaps(laps);

    // updateProgress('Storing lap');
    const s = JSON.stringify(datum);

    // Attempt to insert.  If that fails, try an update.  Do not use
    // INSERT OR REPLACE as that changes the readback order of the list.
    LapStorage.db.run(
      `INSERT INTO ${TABLE_NAME} (${DATUM_COL}, ${UUID_COL}) VALUES (?,?);`,
      [s, datum[UUID_COL]],
      (err: Error) => {
        if (err) {
          LapStorage.db.run(
            `UPDATE OR IGNORE ${TABLE_NAME} SET ${DATUM_COL}=? WHERE ${UUID_COL}=?;`,
            [s, datum[UUID_COL]],
            (__: RunResult, err2: Error) => {
              if (err2) {
                updateProgress(err2.message);
                LapStorage.errorCB(err2);
              }
            }
          );
        }
      }
    );
  };

  /**
   * Update fields in a lap.  Typically used to udpate tx Status field.
   *
   * @param fields Fields in a lap to update.  Must include uuid to select the lap.
   */
  static updateLapFields = (fields: {
    uuid: string;
    [key: string]: string;
  }) => {
    const laps = getLaps();
    const existing = laps.findIndex((lap) => lap.uuid === fields.uuid);
    if (existing < 0) {
      return; // Error
    }
    const lap = { ...laps[existing], ...fields };

    LapStorage.updateLap(lap);
  };

  static updateLapAndSend = (lap: Lap) => {
    LapStorage.updateLap(lap);
    LapStorage.onQueueLapForTx(lap);
  };

  getLaps = async () => {
    return new Promise<Lap[]>((resolve, reject) => {
      try {
        updateProgress('Initiating laps query');

        LapStorage.db.serialize(() => {
          LapStorage.db.all(`SELECT * FROM ${TABLE_NAME}`, (err, rows) => {
            const laps: Lap[] = [];
            if (err) {
              resolve(laps);
              return;
            }
            const len = rows.length;
            updateProgress(`Query completed with ${len} rows`);
            for (let i = 0; i < len; i += 1) {
              const row = rows[i];
              // console.log(`restored ${JSON.stringify(row)}`);
              laps.push(JSON.parse(row[DATUM_COL]));
            }
            const sortedLaps = laps.sort(
              (a, b) => (a.Timestamp || 0) - (b.Timestamp || 0)
            );
            resolve(sortedLaps);
          });
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        updateProgress(msg);
        Log.error('SQL', msg);
        reject(error);
      }
    });
  };
}

/**
 * Store a new lap in the database.  If a prior lap has the same keyid (event-bow)
 * it will be removed, and its uuid transferred to the new lap as a replacement.
 *
 * @param datum The lap datum to store.
 */
export const storeLap = (datum: Lap) => {
  const laps = getLaps();
  const existing = laps.findIndex((lap) => lap.keyid === datum.keyid);
  const milliTime = timeToMilli(datum.Time);

  if (existing >= 0) {
    const lap = laps[existing];
    if (
      lap.Time === datum.Time &&
      lap.State === datum.State &&
      lap.PenaltyCode === datum.PenaltyCode
    ) {
      return; // No change, a refresh
    }

    datum.uuid = lap.uuid; // keep same uuid
    laps.splice(existing, 1); // remove from list
  } else if (milliTime === 0) {
    // FL can send all entries including those without times yet
    return; // Ignore
  }

  datum.Status = 'TxPend';
  // Log.info('Lap', JSON.stringify(datum));
  LapStorage.onQueueLapForTx(datum);
};

// Singleton instance
const lapStorage = new LapStorage();

export function startLapUpdater() {
  const laps = getLaps();
  laps.forEach((lap) => {
    if (lap.Status !== 'OK') {
      LapStorage.onQueueLapForTx(lap);
    }
  });
}

export const startLapStorage = async (queueLapForTx: (lap: Lap) => void) => {
  LapStorage.onQueueLapForTx = queueLapForTx;
  await lapStorage.initDatabase();
  const laps = await lapStorage.getLaps();
  setLaps(laps);
  startLapUpdater();
};
export const stopLapStorage = async () => {
  await lapStorage.closeDatabase();
};

export default LapStorage;
