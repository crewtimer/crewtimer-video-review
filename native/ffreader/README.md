# crewtimer_video_reader

An electron native module for processing video for use with CrewTimer.  The package uses 'prebuild' to build native versions and store them in github releases so projects which use this module do not have to build the module.

## Toolchains

Building this native module on windows requires building both opencv and ffmpeg from source to allow static linking to the C++ code.  This requires build tools and a few custom scripts.

### MacOS Toolchain

On MacOS, the following brew modules are required to be installed.

Install brew from [brew.sh](https://brew.sh)

```bash
brew install nvm
brew install nasm
brew install yasm
brew install pkg-config
brew install cmake
```

### Windows Toolchain

A unix like environment is needed to build ffmpeg and opencv.  Cygwin is used to establish a unix-like environment.  Install the following:

- [nvm for windows](https://github.com/coreybutler/nvm-windows/releases)
- [git for windows](https://gitforwindows.org/)
- [Visual Studio Community]() with C++ addon
- [cmake](https://cmake.org/download/)
- Python.  Just type `python` on windows to get prompted to install. It is installed already on macos.
- [Cygwin 64 bit](https://www.cygwin.com/install.html).  Add 'yasm' and 'make' modules.

Either check out the git repo or if in a Macos Parallels Desktop, map a network drive to share the git repo.

In windows explorer, navigate to the scripts/ folder and double click on the Cygwin-vstudio.bat file.  This will open a bash terminal with the visual studio tools available from the command line.

## Building the prebuilt binary

Set up nvm/node:

```bash
nvm install 18
nvm use 18
npm i -g yarn
```

Build ffmpeg and opencv:

```bash
cd crewtimer-video-review/native/ffreader
./scripts/build-opencv.sh
./scripts/build-ffmpeg.sh
```

Build the module and upload to github:

```bash
yarn install
yarn prebuild
```

The result is placed into a file such as prebuilds/crewtimer_video_reader-v1.0.2-napi-v6-win32-x64.tar.gz.

The `yarn prebuild` command will also upload the binary module to github if a ~/.prebuildrc file with a github token is present such as 

```txt
upload=ghp_kQ04DpisXo2hTiLt2syssyssysysysysysy
token=ghp_kQ04DpisXo2hTiLt2syssyssysysysysysy
```

Optionally manually upload the tar.gz file to [github releases](https://github.com/crewtimer/crewtimer-video-review/releases).

## Usage

Here's how to use the module in your Electron app:

```ts
import { someFunction } = from 'crewtimer_video_reader';

console.log(someFunction());
```

## Package Size

When building the Electron app that utilizes this package files to exclude are added to the top level package.json file with ! prefix:

```json
"build": {
    "files": [
      "dist",
      "node_modules",
      "package.json",
      "!node_modules/**/*.cpp",
      "!node_modules/**/*.h",
      "!node_modules/**/*.md",
      "!node_modules/**/lib-build/**/*"
    ],
}
```

## Constraints

The package name cannot have dashes like most npm packages.  This is because the package name gets used in a macro for the napi boilerplate.

If using yarn to add this module locally, you must use yarn link or the .erb/scripts/check-native-dep.js script fails running `npm ls <modulename>`.  Using yarn add file:../../native/ffreader from the release/app of an electron app also works.


## Problems

If you get an error about a stringWidth require, do the following: `rm -rf node_modules yarn.lock && yarn install`.  A conflict exists between two string packages and an install without a yarn.lock will succeed.

On windows, running the Electron App you might see the error *The specified module could not be found*.  This usually indicates missing dll files.  Copy dll files into the same folder as the exe to see if you can figure out which dlls are missing.

Lacking that, try running the [Dependency Walker](https://www.dependencywalker.com/) tool 'depends' to see what libraries are required by the .node file. It takes many minutes to run so be patient.  Once it finally opens, scan down the list of external dlls looking for ones that might be related to the native module like opencv or ffmpeg.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## Author

Glenn Engel (glenne)

## License

This project is licensed under the ISC License - see the LICENSE file for details.
