const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const tar = require('tar');

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

const nativeBuild = path.join(
  nativeRoot,
  'build',
  'Release',
  'crewtimer_video_reader.node',
);
const isPeFile = (filename) => {
  if (!fs.existsSync(filename)) return false;
  const fd = fs.openSync(filename, 'r');
  try {
    const signature = Buffer.alloc(2);
    return (
      fs.readSync(fd, signature, 0, 2, 0) === 2 &&
      signature[0] === 0x4d &&
      signature[1] === 0x5a
    );
  } finally {
    fs.closeSync(fd);
  }
};

fs.mkdirSync(destination, { recursive: true });
const stagedAddon = path.join(destination, 'crewtimer_video_reader.node');
const installedModuleRoot = path.resolve(destination, '../..');

if (isPeFile(nativeBuild)) {
  fs.copyFileSync(nativeBuild, stagedAddon);
  console.log(`Staged Windows native build: ${nativeBuild} -> ${stagedAddon}`);
} else {
  const prebuildDir = path.join(nativeRoot, 'prebuilds');
  const archives = (
    fs.existsSync(prebuildDir) ? fs.readdirSync(prebuildDir) : []
  )
    .filter((name) => name.endsWith('-win32-x64.tar.gz'))
    .map((name) => ({
      name,
      mtimeMs: fs.statSync(path.join(prebuildDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (archives.length > 0) {
    const archive = path.join(prebuildDir, archives[0].name);
    tar.x({
      file: archive,
      cwd: installedModuleRoot,
      sync: true,
    });
    console.log(`Staged Windows native prebuild: ${archive} -> ${stagedAddon}`);
  } else {
    const prebuildInstall = require.resolve('prebuild-install/bin.js', {
      paths: [nativeRoot],
    });
    console.log(
      'No local Windows prebuild found; downloading published prebuild',
    );
    try {
      execFileSync(
        process.execPath,
        [
          prebuildInstall,
          '--platform',
          'win32',
          '--arch',
          'x64',
          '--runtime',
          'napi',
          '--target',
          '6',
          '--force',
        ],
        { cwd: installedModuleRoot, stdio: 'inherit' },
      );
    } catch (err) {
      throw new Error(
        'Unable to download the published Windows x64 native prebuild',
        { cause: err },
      );
    }
  }
}

if (!isPeFile(stagedAddon)) {
  throw new Error(
    `Staged native addon is not a Windows PE file: ${stagedAddon}`,
  );
}

const files = [
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

for (const file of files) {
  const target = path.join(destination, file.name);
  fs.copyFileSync(file.source, target);
  console.log(`Staged ${file.name}: ${file.source} -> ${target}`);
}

// Do not carry a macOS runtime library into a Windows package when switching
// build targets in the same working tree.
for (const name of fs.readdirSync(destination)) {
  if (name.endsWith('.dylib')) {
    fs.unlinkSync(path.join(destination, name));
  }
}
