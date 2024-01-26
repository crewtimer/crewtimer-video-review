# crewtimer_video_reader

An example of how to define and use an Electron native module.

## Description

This project demonstrates the implementation and usage of a native module in Electron.

## Constraints

The package name cannot have dashes like most npm packages.  This is because the package name gets used in a macro for the napi boilerplate.

If using yarn to add this module locally, you must use yarn link or the .erb/scripts/check-native-dep.js script fails running `npm ls <modulename>`.

## Installation in an Electron App

To install the module in a react-native-boilerplate electron app, run the following command:

```bash
cd <your-electron-app-dir>
yarn add -D crewtimer_video_reader
cd release/app
yarn add crewtimer_video_reader
```

This will add the types to the root build as a dev module and add the native module under release/app where it will get compiled as a native code module using `node-gyp`.

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
cd crewtimer-connect/native/ffreader
yarn build-ffmpeg-win
```

Build prebuilt ffreader:

```bash
yarn prebuild
```

## Usage

Here's how to use the module in your Electron app:

```javascript
const { incrementByOne } = require('crewtimer_video_reader');

console.log(incrementByOne(1)); // Outputs: 2
```

or

```ts
import { incrementByOne } = from 'crewtimer_video_reader';

console.log(incrementByOne(1)); // Outputs: 2
```

## Requirements

- Node.js
- Electron
- C++ toolchain

## Building

The `install` script in `package.json` is configured to build the native module:

```bash
yarn install
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## Author

Glenn Engel (glenne)

## License

This project is licensed under the ISC License - see the LICENSE file for details.