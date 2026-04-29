// MSYS-only fixup for FFmpeg's dependency-tracking awk invocation.
//
// FFmpeg's configure emits inline awk in ffbuild/config.mak that contains a
// regex with a backslash escape. MSYS bash strips one backslash on the way
// to make/awk, corrupting the regex and failing every source compile with
// "awk: unterminated regexp". The fix is to extract the awk program into a
// script file and invoke it via `awk -f`, so nothing has to round-trip
// through the shell.
//
// Usage (from native/ffreader/, after build-ffmpeg.sh's configure step):
//   node scripts/patch-config-mak.js
//
// Idempotent. Locates FFmpeg-* under lib-build/ automatically.

const fs = require('fs');
const path = require('path');

const ffreaderDir = path.resolve(__dirname, '..');
const libBuild = path.join(ffreaderDir, 'lib-build');

if (!fs.existsSync(libBuild)) {
  console.error('lib-build/ not found at', libBuild);
  console.error('Run scripts/build-ffmpeg.sh first to fetch FFmpeg sources.');
  process.exit(1);
}

const ffmpegDirs = fs
  .readdirSync(libBuild)
  .filter(name => /^FFmpeg-/.test(name))
  .map(name => path.join(libBuild, name))
  .filter(p => fs.statSync(p).isDirectory());

if (ffmpegDirs.length === 0) {
  console.error('No FFmpeg-* directory under', libBuild);
  process.exit(1);
}
if (ffmpegDirs.length > 1) {
  console.error('Multiple FFmpeg-* directories under lib-build/, refusing to guess:');
  for (const d of ffmpegDirs) console.error('  ' + d);
  process.exit(1);
}

const ffmpegDir = ffmpegDirs[0];
const ffbuild = path.join(ffmpegDir, 'ffbuild');
const configMak = path.join(ffbuild, 'config.mak');
const depAwk = path.join(ffbuild, 'dep.awk');

if (!fs.existsSync(configMak)) {
  console.error('config.mak not found at', configMak);
  console.error('Run scripts/build-ffmpeg.sh through its configure step first.');
  process.exit(1);
}

// Write the awk program as a standalone file so MSYS's shell does not eat
// the backslash in the regex.
fs.writeFileSync(
  depAwk,
  '/including/ { sub(/^.*file: */, ""); gsub(/\\\\/, "/"); if (!match($0, / /)) print TARGET ":", $0 }\n',
);

// Replace inline awk invocations (CCDEP, CXXDEP, ASDEP, HOSTCCDEP) with the
// scripted form. Idempotent: re-running is a no-op once patched.
const before = fs.readFileSync(configMak, 'utf8');
const after = before.replace(
  /awk '\/including\/[^']*'/g,
  `awk -v TARGET="$@" -f ffbuild/dep.awk`,
);

if (before === after) {
  console.log('config.mak already patched (no inline awk found).');
} else {
  fs.writeFileSync(configMak, after);
  console.log('Patched ' + configMak);
}
console.log('Wrote ' + depAwk);
