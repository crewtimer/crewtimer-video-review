import { GrabFrameMessage, nativeVideoExecutor } from 'crewtimer_video_reader';
import { ipcMain } from 'electron';

/**
 * Extract a 64 bit 100ns UTC timestamp from the video frame.  The timestamp
 * is encoded in the row as two pixels per bit with each bit being white for 1 and black for 0.
 * @param image A rgba image array
 * @param row The row to extract the timestamp from
 * @param width The number of columns in a row
 * @returns The extracted timestamp in milliseconds
 */
export function extractTimestampFromFrame(
  image: Uint8Array,
  row: number,
  width: number,
): number {
  let number = 0n; // Initialize the 64-bit number as a BigInt

  for (let col = 0; col < 64; col++) {
    const pixel1 = image[4 * (row * width + col * 2)]; // Get the pixel at the current column
    const pixel2 = image[4 * (row * width + col * 2 + 1)];

    // Check the pixel's color values
    const isGreen = pixel1 + pixel2 > 220;
    const bit = isGreen ? 1n : 0n;

    number = number << 1n;

    // Set the corresponding bit in the 64-bit number
    number |= bit;
  }

  // console.log(`${number}`.replace('n', ''));

  number = (5000n + number) / 10000n; // Round 64-bit number to milliseconds

  return Number(number); // Convert the BigInt number to a regular number
}

export function stopVideoServices(_name: string) {}

export function startVideoServices() {}

ipcMain.handle('video:sendMulticast', (_event, msg, dest, port) => {
  try {
    const ret = nativeVideoExecutor({ op: 'sendMulticast', msg, dest, port });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:openFile', (_event, filePath) => {
  // Invoke native c++ handler
  try {
    const ret = nativeVideoExecutor({ op: 'openFile', file: filePath });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle('video:closeFile', (_event, filePath) => {
  // Invoke native c++ handler
  try {
    const ret = nativeVideoExecutor({ op: 'closeFile', file: filePath });
    return ret;
  } catch (err) {
    return { status: `${err instanceof Error ? err.message : err}` };
  }
});

ipcMain.handle(
  'video:getFrame',
  (_event, filePath, frameNum, tsMilli, zoom, blend, saveAs, closeTo) => {
    try {
      // console.log('Grabbing frame', zoom);
      // console.log('Grabbing frame', filePath, frameNum);
      const ret = nativeVideoExecutor({
        op: 'grabFrameAt',
        frameNum: frameNum,
        file: filePath,
        tsMilli: tsMilli,
        zoom: zoom || { x: 0, y: 0, width: 0, height: 0 },
        blend: blend || false,
        saveAs: saveAs || '',
        closeTo: closeTo || false,
      } as unknown as GrabFrameMessage);
      if (ret.status === 'OK') {
        // row 0 should be black
        // let timestamp = extractTimestampFromFrame(ret.data, 0, ret.width);
        // if (timestamp === 0) {
        //   timestamp = extractTimestampFromFrame(ret.data, 1, ret.width);
        //   //console.log('extracted timestamp', timestamp);
        //   ret.timestamp = timestamp;
        // } else {
        //   ret.timestamp = Math.trunc(
        //     0.5 + ((frameNum - 1) * 1000) / (ret.fps ?? 30)
        //   );
        // }
      }
      return ret;
    } catch (err) {
      return { status: `${err instanceof Error ? err.message : err}` };
    }
  },
);
