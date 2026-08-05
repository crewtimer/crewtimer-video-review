const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const unpackedAppDir = path.join(
  projectRoot,
  'release',
  'build',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
);
const videoReaderDir = path.join(
  unpackedAppDir,
  'node_modules',
  'crewtimer_video_reader',
  'build',
  'Release',
);

const requiredFiles = [
  path.join(videoReaderDir, 'crewtimer_video_reader.node'),
  path.join(videoReaderDir, 'onnxruntime.dll'),
  path.join(videoReaderDir, 'onnxruntime_providers_shared.dll'),
  path.join(
    unpackedAppDir,
    'node_modules',
    'sqlite3',
    'build',
    'Release',
    'node_sqlite3.node',
  ),
];
const missingFiles = requiredFiles.filter(
  (filename) => !fs.existsSync(filename),
);

if (missingFiles.length > 0) {
  throw new Error(
    `Windows package is missing required native runtime files: ${missingFiles.join(
      ', ',
    )}`,
  );
}

const nonPeFiles = requiredFiles.filter((filename) => {
  const signature = fs.readFileSync(filename);
  return signature.length < 2 || signature[0] !== 0x4d || signature[1] !== 0x5a;
});

if (nonPeFiles.length > 0) {
  throw new Error(
    `Windows package contains non-Windows native runtime files: ${nonPeFiles.join(
      ', ',
    )}`,
  );
}

console.log('Verified Windows native runtime files and PE signatures');
