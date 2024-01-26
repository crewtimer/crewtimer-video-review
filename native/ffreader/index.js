const addon = require('bindings')('crewtimer_video_reader');

module.exports = {nativeVideoExecutor: addon.nativeVideoExecutor
};