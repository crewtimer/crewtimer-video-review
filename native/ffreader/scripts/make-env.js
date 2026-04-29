// Convert the cmd-style env dump from dump-vs-env.bat into a bash-sourceable
// vs-env.sh. PATH is rewritten to MSYS-style (/c/...); INCLUDE/LIB/LIBPATH are
// kept as native Windows path lists (MSYS does not path-convert these env
// vars, so cl.exe resolves them correctly).
//
// Usage:
//   cmd.exe /c scripts\dump-vs-env.bat > scripts\vs-env.raw.txt
//   node scripts/make-env.js
//   source scripts/vs-env.sh
const fs = require('fs');
const path = require('path');

const here = __dirname;
const rawPath = path.join(here, 'vs-env.raw.txt');
const outPath = path.join(here, 'vs-env.sh');

if (!fs.existsSync(rawPath)) {
  console.error('vs-env.raw.txt not found. Run dump-vs-env.bat first:');
  console.error('  cmd.exe /c scripts\\dump-vs-env.bat > scripts\\vs-env.raw.txt');
  process.exit(1);
}

const raw = fs.readFileSync(rawPath, 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const strip = s => (s || '').replace(/\\+$/, '');
const winPathToMsys = winPath =>
  (winPath || '')
    .split(';')
    .filter(Boolean)
    .map(e => {
      e = e.replace(/\\/g, '/').replace(/\/+$/, '');
      const drive = e.match(/^([A-Za-z]):\//);
      if (drive) e = '/' + drive[1].toLowerCase() + '/' + e.slice(3);
      return e;
    })
    .join(':');

const out =
`# Auto-generated VS build env. Do not edit; rerun scripts/make-env.js to refresh.
export PATH="/c/buildtools/nasm:/c/buildtools/make/bin:/c/buildtools/strawberry/perl/bin:/c/buildtools:/c/buildtools/cmake/bin:${winPathToMsys(env.PATH)}:$PATH"
export INCLUDE='${strip(env.INCLUDE)}'
export LIB='${strip(env.LIB)}'
export LIBPATH='${strip(env.LIBPATH)}'
`;

fs.writeFileSync(outPath, out);
console.log('wrote ' + outPath);
