/* eslint-disable no-console */
function logmsg(msg: string) {
  console.log(msg);
}
const Log = {
  info: (tag: string, msg: string) => {
    logmsg(`${tag}: ${msg}`);
  },
  trace: (tag: string, msg: string) => {
    logmsg(`${tag}: ${msg}`);
  },
  warn: (tag: string, msg: string) => {
    logmsg(`${tag}: ${msg}`);
  },
  error: (tag: string, msg: string) => {
    logmsg(`${tag}: ${msg}`);
  },
};
export default Log;
