const incrementByOne =
  require('../build/Release/crewtimer_video_reader').incrementByOne;
const nativeVideoExecutor =
  require('../build/Release/crewtimer_video_reader').nativeVideoExecutor;

console.log(new Date());
console.log(incrementByOne(1)); // Should log '2'
console.log('nativeVideoExecutor');
const value = nativeVideoExecutor({ op: 'add', count: 123 });
console.log(JSON.stringify(value, null, 2));
