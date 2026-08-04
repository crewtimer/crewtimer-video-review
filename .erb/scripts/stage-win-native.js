const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const nativeRoot = path.join(projectRoot, 'native', 'ffreader');
const destination = path.join(
  projectRoot,
  'release',
  'app',
  'node_modules',
  'crewtimer_video_reader',
  'build',
  'Release',
);

const files = [
  {
    source: path.join(
      nativeRoot,
      'build',
      'Release',
      'crewtimer_video_reader.node',
    ),
    name: 'crewtimer_video_reader.node',
  },
  {
    source: path.join(
      nativeRoot,
      'lib-build',
      'onnxruntime-static-win',
      'lib',
      'onnxruntime.dll',
    ),
    name: 'onnxruntime.dll',
  },
  {
    source: path.join(
      nativeRoot,
      'lib-build',
      'onnxruntime-static-win',
      'lib',
      'onnxruntime_providers_shared.dll',
    ),
    name: 'onnxruntime_providers_shared.dll',
  },
];

for (const file of files) {
  if (!fs.existsSync(file.source)) {
    throw new Error(
      `Required Windows native build output is missing: ${file.source}`,
    );
  }
}

fs.mkdirSync(destination, { recursive: true });
for (const file of files) {
  const target = path.join(destination, file.name);
  fs.copyFileSync(file.source, target);
  console.log(`Staged ${file.name}: ${file.source} -> ${target}`);
}
