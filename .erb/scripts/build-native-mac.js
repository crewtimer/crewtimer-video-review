// Builds the native video reader for this Mac and stages it into release/app,
// so a Mac package needs no published prebuild and never ships a stale module
// or the Windows one left behind by build:win.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../..');
const nativeRoot = path.join(projectRoot, 'native', 'ffreader');
const nativeRelease = path.join(nativeRoot, 'build', 'Release');
const destination = path.join(
  projectRoot,
  'release',
  'app',
  'node_modules',
  'crewtimer_video_reader',
  'build',
  'Release',
);

const MACHO_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;

const isMacArm64 = (filename) => {
  if (!fs.existsSync(filename)) return false;
  const fd = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(8);
    return (
      fs.readSync(fd, header, 0, 8, 0) === 8 &&
      header.readUInt32LE(0) === MACHO_64 &&
      header.readUInt32LE(4) === CPU_TYPE_ARM64
    );
  } finally {
    fs.closeSync(fd);
  }
};

// Always a clean rebuild: the build folder is shared with Windows builds of the
// same checkout. Run node-gyp through node, not node_modules/.bin, whose shims
// differ between the Mac and Windows installs of the shared folder.
console.log('Rebuilding native video reader...');
execFileSync(
  process.execPath,
  [
    path.join(nativeRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
    'rebuild',
  ],
  { cwd: nativeRoot, stdio: 'inherit' },
);

// binding.gyp copies the ONNX Runtime library next to the module
const files = ['crewtimer_video_reader.node', 'libonnxruntime.1.dylib'];
for (const name of files) {
  const source = path.join(nativeRelease, name);
  if (!isMacArm64(source)) {
    throw new Error(
      `Native build output is not a macOS arm64 binary: ${source}`,
    );
  }
}

fs.mkdirSync(destination, { recursive: true });
for (const name of files) {
  const source = path.join(nativeRelease, name);
  const target = path.join(destination, name);
  fs.copyFileSync(source, target);
  console.log(`Staged ${name}: ${source} -> ${target}`);
}

// Do not carry Windows runtime libraries into a Mac package when switching
// build targets in the same working tree.
for (const name of fs.readdirSync(destination)) {
  if (name.endsWith('.dll')) {
    fs.unlinkSync(path.join(destination, name));
  }
}
