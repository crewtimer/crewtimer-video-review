# crewtimer_video_reader

An electron native module for processing video for use with CrewTimer.  The package uses 'prebuild' to build native versions and store them in github releases so projects which use this module do not have to build the module.

## Constraints

The package name cannot have dashes like most npm packages.  This is because the package name gets used in a macro for the napi boilerplate.

If using yarn to add this module locally, you must use yarn link or the .erb/scripts/check-native-dep.js script fails running `npm ls <modulename>`.  Using yarn add file:../../native/ffreader from the release/app of an electron app also works.

## Package Size

When the final app gets packaged, the .gitignore and .npmignore files tell the packager what files to leave out of the native module.  The .gitignore and .npmignore need to be in the native library folder and not in a parent.

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
      "!node_modules/**/lib-build/**/*",
      "!node_modules/**/ffmpeg*/**/*"
    ],
}
```

## Building static opencv

To avoid linking issues when deploying to other machines than the build machine opencv is built as a static library and linked directly to the native add-on.

```bash
yarn opencv-build
```

## Building ffmpeg on Windows

Native modules must be build with MSVC toolchains.

ffmpeg needs configure which requires bash.  One recipe follows:

* Install nvm for windows.
* Install node 16 (includes npm): `nvm install 16 && nvm use 16`
* Install yarn: `npm install -g yarn`
* Install Cygwin with make and git options
* Install Visual Studio Community Edition with C++ support
* Edit C:\cygwin64\Cygwin.bat and add ```call "c:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"``` to provide MSVC to cygwin shell.
* Start a Cygwin shell from file file explorer by clicking on Cygwin.bat
* Verify msvc is available.  Create a dummy main.cpp and invoke `cl main.cpp` to test.

Build the ffmpeg libraries

```bash
cd crewtimer-video-review/native/ffreader
yarn build-ffmpeg-win
```

## Making a new prebuilt on windows

First, ensure that ffmpeg has been built by following the prior section instructions.

Open a shell via C:\cygwin64\Cygwin.bat.  Alternatively, open a Visual Studio 2022 x64 Native Tools Command Prompt.

```bash
cd c:/Users/glenne/git/crewtimer-video-review/native/ffreader
rm -rf node_modules build # start from scratch
rm yarn.lock # removes an error about stringWidth libraries
yarn install # The final step of the install will fail where it tries to get prebuilt binaries.  We'll build our own next
yarn prebuild # This will likely fail on the final step where it tries to upload to github releases
```

If you get an error about a stringWidth require, do the following: `rm -rf node_modules yarn.lock && yarn install`.  A conflict exists between two string packages and an install without a yarn.lock will succeed.

The result is placed into a file such as prebuilds/crewtimer_video_reader-v1.0.2-napi-v6-win32-x64.tar.gz.  It will also attempt to upload it to github releases.  This file can also be copied to a similar directory on a mac and uploaded from there via `yarn uploadall`.

If it creates a file with something like v94 instead of v6, this is not what you want and a script got the wrong napi version.  Try also removing the build directory - `rm -rf node_modules yarn.lock build && yarn install`.

Uploading requires a GITHUB_TOKEN env variable to be set to grant permission.

## Usage

Here's how to use the module in your Electron app:

```ts
import { someFunction } = from 'crewtimer_video_reader';

console.log(someFunction());
```

## Requirements

* Node.js
* Electron
* C++ toolchain

## Building

The `install` script in `package.json` is configured to build the native module:

```bash
yarn install
```

## Problems

On windows, running the Electron App you might see the error *The specified module could not be found*.  This usually indicates missing dll files.  Copy dll files into the same folder as the exe to see if you can figure out which dlls are missing.

Lacking that, try running the [Dependency Walker](https://www.dependencywalker.com/) tool 'depends' to see what libraries are required by the .node file. It takes many minutes to run so be patient.  Once it finally opens, scan down the list of external dlls looking for ones that might be related to the native module like opencv or ffmpeg.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## Author

Glenn Engel (glenne)

## License

This project is licensed under the ISC License - see the LICENSE file for details.
