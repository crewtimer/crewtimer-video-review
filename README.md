# CrewTimer Video Review

CrewTimer Video Review is built using Electron, and specificlly
the [Electron React Boilerplate Project](https://electron-react-boilerplate.js.org/docs/installation/).

See the [VSCode plugins suggested here](https://electron-react-boilerplate.js.org/docs/editor-configuration).

## Development Environment Setup

Node version 18 or later is recommended.

* [Visual Studio Code](https://code.visualstudio.com/) is the recommended IDE for editing code for this repo.  If you don't have it installed, please do that first.
* The [nvm node version manager](https://github.com/nvm-sh/nvm) is recommended to manage node versions.  [Node.js which includes npm](https://nodejs.org/en) is required for local development.
* Source code utilizes git.  If you are unfamiliar with git, the [Atlassian Sourcetree](https://www.sourcetreeapp.com/) program provides a nice GUI as does [Github Desktop](https://desktop.github.com/).

## Quickstart

```bash
nvm install 18
nvm use 18
nvm alias default v16
npm i -g node-gyp@latest
npm i -g yarn
npm i -g ts-node

git clone git@github.com:crewtimer/crewtimer-video-review.git
yarn install
yarn start
```

If the build fails with a node-gyp error, be sure node-gyp is installed globally.

The crewtimer_video_reader native module contains pre-built binaries for mac and win targets.  If this repo is private, a github token is required to retrieve the pre-built binaries.

1. Obtain your [github token](https://github.com/prebuild/prebuild?tab=readme-ov-file#create-github-token)
2. Add it to ~/.prebuild-installrc
3. e.g. `token=ghp_8bh6rSO2EhGf3nVCgY4GrEvs1dqd324`


* For firebase, edit webpack.config.renderer.dev.dll.ts and modify renderer field `entry: {
    renderer: Object.keys(dependencies || {}).filter((it) => it !== 'firebase'),
  },` . See [stackoverflow](https://stackoverflow.com/a/72220505/924369) for issue it resolves.
* In resolve: section of , add ```fallback: {
      path: require.resolve('path-browserify'),
    },``` to make path available from the renderer.

## Native modules

A native module is used to read mp4 files from storage using the ffmpeg and opencv libraries.  This code is prebuilt and stored on github.

To make updates to the native code, see [Instructions for the native video reader](native/ffreader/README.md).  Access to both windows and Mac is required. Parallels Desktop on Mac works well as a windows VM.

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
* config.json C:\\Users\\glenne\\AppData\Roaming\\CrewTimer Video Reviewor\\config.json

### MacOS

* CrewTimer.db '/Users/glenne/Library/Application Support/Electron/CrewTimer.db'
* config.json debug: '/Users/glenne//Library/Application Support/Electron/config.json'
* config.json installed: '/Users/glenne//Library/Application Support/crewtimer-fl-connector/config.json'

## Releasing new versions

1. Edit [release/app/package.json](release/app/package.json) and adjust version info
2. Execute `yarn macbuild && yarn winbuild`
3. Look in release/ for the dmg and exe files
4. Copy the dmg and exe to a Releases set on github

## Notarizing MacOS builds

To create a notarized macos build, create a .env file with the following contents.  **Do not commit this file to the repo**

```txt
APPLE_ID=glenne@engel.org
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
TEAM_ID=P<snip>4
```

## Tips

* Blank screen at startup? Check to make sure packagse were added top level package.json
* [Speedsoft Time Sync](https://www.speed-soft.de/software/time_sync/index.php)
* [Use Meinberg NTP](https://www.meinbergglobal.com/english/sw/ntp.htm)

## Using opencv for frame interpolation

* [Python opencv interpolation](https://github.com/satinder147/video-frame-interpolation)
* [chatgpt conversion of xxx](https://chat.openai.com/share/42a74f77-a0ab-4b40-97ab-6b75b121f289)
* [minimal opencv libs](https://github.com/nihui/opencv-mobile)
