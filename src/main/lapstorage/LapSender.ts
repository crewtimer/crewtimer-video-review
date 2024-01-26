import axios, { Method, ResponseType } from 'axios';
import { Lap, TxLapItem, CrewTimerHttpResponse } from 'crewtimer-common';
import { getMobileID, getMobilePin } from '../main-settings';
import Log from '../../renderer/util/Log';
import { getConnectionProps } from '../../renderer/util/Util';
import LapStorage from './LapStorage';

let sendInProgress = false;
const txSendState = {
  txPendList: [] as Lap[],
  txSendingList: [] as Lap[],
};

export function clearPendingData() {
  txSendState.txPendList = [];
  txSendState.txSendingList = [];
}

// async function timeout<T>(ms: number, promise: Promise<T>): Promise<T> {
//   return new Promise((resolve, reject) => {
//     setTimeout(() => {
//       reject(new Error('timeout'));
//     }, ms);
//     promise.then(resolve, reject).catch((reason) => reject(reason));
//   });
// }

async function sendToCrewTimer(messages: TxLapItem[]) {
  const mobileID = getMobileID();
  // console.log(`Sending ${  JSON.stringify(messages)}`);
  try {
    const { regattaID, url } = getConnectionProps(mobileID);
    const mobilePin = getMobilePin();
    const data = `regatta=${encodeURIComponent(
      regattaID
    )}&password=${encodeURIComponent(mobilePin)}&list=${encodeURIComponent(
      JSON.stringify(messages)
    )}`;

    const options = {
      url,
      method: 'POST' as Method,
      responseType: 'json' as ResponseType,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      referrer: 'no-referrer',
      data,
    };
    const queryResponse = await axios(options);
    const results = queryResponse.data as CrewTimerHttpResponse;
    const { list } = results;
    if (!Array.isArray(list) && list.error) {
      // error shows up as object with 'error' field
      return list.error;
    }
    return list;
  } catch (err) {
    Log.warn('Lap', `Fail: ${String(err)}`);
    return 'Error';
  }
}

async function sendPendList(retryCount = 0) {
  try {
    if (txSendState.txPendList.length === 0) return;
    if (sendInProgress && retryCount === 0) {
      return;
    }

    // 1. Assenmle messages
    // 2. Send to Crewtimer
    // 3. Process Results
    // 4. Prepend any failed items to pend queue
    // 5. Reschedule if queue is not empty

    sendInProgress = true;
    txSendState.txSendingList = txSendState.txPendList;
    txSendState.txPendList = [];
    const messages: TxLapItem[] = txSendState.txSendingList.map((lap) => {
      const { uuid } = lap;
      const envelope: TxLapItem = { uuid, op: 'store-lap', data: lap };
      return envelope;
    });

    // 2. Send to Crewtimer
    const result = await sendToCrewTimer(messages);
    if (txSendState.txSendingList.length === 0) {
      // regatta reset while in sendToCrewTimer()
      sendInProgress = false;
    } else {
      // 3. Process Results
      let failedList: Lap[] = [];
      if (Array.isArray(result)) {
        // partial or full success
        result.forEach((item, index) => {
          const { uuid } = txSendState.txSendingList[index];
          const ok = item.code === 'OK';
          // console.log(`Tx status=${ok}`);
          if (!ok) {
            Log.warn(
              'Lap',
              `Failed on ${JSON.stringify(messages[index], null, 2)}`
            );
            failedList.push(txSendState.txSendingList[index]);
          }
          const newStatus = ok ? 'OK' : 'Fail';
          LapStorage.updateLapFields({
            uuid,
            Status: newStatus,
          });
        });
      } else {
        // 4. Prepend any failed items to pend queue
        txSendState.txSendingList.forEach((lap) => {
          LapStorage.updateLapFields({
            uuid: lap.uuid,
            Status: 'Fail',
          });
        });
        failedList = txSendState.txSendingList;
      }
      if (failedList.length > 0) {
        txSendState.txPendList = failedList.concat(txSendState.txPendList);
        txSendState.txSendingList = [];
        setTimeout(() => sendPendList(retryCount + 1), 20000);
      } else {
        sendInProgress = false;
      }
    }
  } catch (err) {
    // Major unexpected error.  Return items to queue and schedule
    // a retry.
    Log.warn('Lap', `Unexpected error sending: ${String(err)}`);
    try {
      txSendState.txSendingList.forEach((lap) => {
        LapStorage.updateLapFields({
          uuid: lap.uuid,
          Status: 'Fail',
        });
      });
    } catch (e) {
      /* do nothing */
    }
    txSendState.txPendList = txSendState.txSendingList.concat(
      txSendState.txPendList
    );
    txSendState.txSendingList = [];
    sendInProgress = false;
    setTimeout(() => sendPendList(0), 20000);
  }

  // 5. Reschedule if queue is not empty
  if (!sendInProgress && txSendState.txPendList.length > 0) {
    setTimeout(() => sendPendList(0), 0);
  }
}

export function queueLapForTx(lap: Lap) {
  // console.log(`Queue for Tx: ${JSON.stringify(lap, null, 2)}`);
  if (!lap) return;
  const item: Lap = { ...lap, Status: 'TxPend' };
  LapStorage.updateLap(item); // will also push onto lapdata list if needed
  txSendState.txPendList.push(item);
  sendPendList();
}
