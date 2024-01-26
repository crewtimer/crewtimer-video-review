# CrewTimer FinishLynx Connect

CrewTimer FinishLynx Connect is built using Electron, and specificlly
the [Electron React Boilerplate Project](https://electron-react-boilerplate.js.org/docs/installation/).

See the [VSCode plugins suggested here](https://electron-react-boilerplate.js.org/docs/editor-configuration).

## Installation and Configuration tweaks

MacOS can build for all targets - mac, win, linux

To build native libs (sqlite3) a recent version of npm is needed.

These versions are known to work together:

node 14.17.0
npm 6.14.13
node-gyp 9.1.0

* Run `nvm ls-remote --lts` and pick a version.  16 known to work.
* Install `nvm install 16`
* Use it `nvm use 16`
* Make it default `nvm alias default v16`
* Update node-gyp `npm i -g node-gyp@latest"`.  Required to build sqlite3.
* Install yarn `npm i -g yarn`
* Install ts-node `npm i -g ts-node`
* Some report needing this: `npm config set node_gyp "/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js`
* Add sqlite3 to release/app/package.json instead of top level. `cd release/app && npm i --save sqlite3`
* For firebase, edit webpack.config.renderer.dev.dll.ts and modify renderer field `entry: {
    renderer: Object.keys(dependencies || {}).filter((it) => it !== 'firebase'),
  },` . See [stackoverflow](https://stackoverflow.com/a/72220505/924369) for issue it resolves.
* In resolve: section of , add ```fallback: {
      path: require.resolve('path-browserify'),
    },``` to make path available from the renderer.

## Building from scratch

```bash
git clone git@github.com:crewtimer/crewtimer-connect.git
yarn install
yarn electron-rebuild
yarn start
```

If the build fails with a node-gyp error, be sure node-gyp is installed globally.

## Native modules

A native module is used to read mp4 files from storage using the ffmpeg library.  This code is prebuilt and stored on github.

To make updates to the native code, see [Instructions for the native video reader](native/ffreader/README.md).  Access to both a windows and Mac is required.

## Debugging

Starting from VSCode seems broke. Try this command line

`yarn "start:main" "--inspect=5858" "--remote-debugging-port=9223"`

Open dev window with releases code:

`yarn cross-env DEBUG_PROD=true yarn package`

See also [the Electron React Boilerplate page](https://electron-react-boilerplate.js.org/docs/packaging).

## File Locations

### Windows

* CrewTimer.db No longer correct: C:\\Users\\glenne\\AppData\\Local\\Programs\\crewtimer-fl-connector\\CrewTimer.db
* Images and assets C:\\Users\\glenne\\AppData\\Local\\Programs\\crewtimer-fl-connector\\resources\assets
* config.json C:\\Users\\glenne\\AppData\Roaming\\CrewTimer FinishLynx Connector\\config.json

### MacOS

* CrewTimer.db '/Users/glenne/Library/Application Support/Electron/CrewTimer.db'

## Debugging with Parallels and MacOS

FL connects via TCP/IP to the CrewTimer FL Connect app. When running with parallels the
scoreboard must be provided with the IP address where CrewTimer FL Connect is running.

1. Find the macOS IP Address for the Parallels container. Issue `ifconfig` and look for the IP address associated with the vnic1 interface. E.g. 10.37.129.2. This will be used within FinishLynx.
2. Run FinishLynx within Parallels and configure a scoreboard with the IP address found in the prior step.
3. Run CrewTimer FL Connect on macOS: `npm start`

## Using Manual Start on FL

1. Go to File|Options|General and set the Hardware Type = None.
2. Set Camera Settings -> Input -> Wired Sensor = Open if not using a start sensor.
3. Go to LapTime options and click New.
4. Restart FL

## Releasing new versions

1. Edit [release/app/package.json](release/app/package.json) and src/renderer/Nav.tsx and adjust version info
2. Execute `npm run winbuild`
3. Look in release/ for the exe file
4. Copy the exe to the 'CrewTimer Installers' google drive folder.
5. Make a copy of the installer and rename it without a version: `CrewTimerConnect Setup.exe`.

## Tips

* Blank screen at startup? Check to make sure packagse were added top level package.json
* [Speedsoft Time Sync](https://www.speed-soft.de/software/time_sync/index.php)
* [Use Meinberg NTP](https://www.meinbergglobal.com/english/sw/ntp.htm)
