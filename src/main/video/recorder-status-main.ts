/**
 * Listens for CrewTimer Video Recorder status reports on the multicast group
 * this app already uses to send split-video and info commands, and forwards
 * them, and the exit notice a recorder sends as it quits, to the renderer as
 * 'recorder-status' events.
 */
import dgram from 'dgram';
import { getMainWindow } from '../mainWindow';

const MCAST_ADDR = '239.215.23.42';
const MCAST_PORT = 52342;
// Retry after a socket failure, e.g. no network yet at startup
const RETRY_MS = 10 * 1000;

let socket: dgram.Socket | undefined;
// Retries repeat the same failure; log it once rather than every 10 s
let lastError = '';

export function startRecorderStatusListener() {
  if (socket) return;
  // reuseAddr lets a recorder on this PC share the port.  On macOS libuv sets
  // SO_REUSEPORT for it, so the recorder's socket must set SO_REUSEPORT too.
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket = sock;

  const restart = (err: Error) => {
    if (String(err) !== lastError) {
      lastError = String(err);
      console.error('Recorder status listener error:', err);
    }
    sock.close();
    socket = undefined;
    setTimeout(startRecorderStatusListener, RETRY_MS);
  };
  sock.on('error', restart);

  sock.on('message', (data) => {
    let msg: { cmd?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    // The group also carries this app's own split-video and info commands
    if (msg.cmd !== 'recorder-status' && msg.cmd !== 'recorder-exit') return;
    getMainWindow()?.webContents.send('recorder-status', msg);
  });

  sock.bind(MCAST_PORT, () => {
    try {
      sock.addMembership(MCAST_ADDR);
      if (lastError) console.log('Recorder status listener started');
      lastError = '';
    } catch (err) {
      restart(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function stopRecorderStatusListener() {
  socket?.close();
  socket = undefined;
}
