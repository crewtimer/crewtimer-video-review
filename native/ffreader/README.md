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

A unix-like environment is needed to build ffmpeg and opencv. Two paths are
supported:

- **MSYS + MSVC (recommended)** — uses the bash that ships with Git for Windows
  plus Visual Studio Build Tools 2022. No separate Cygwin install. This is the
  path the build scripts target out of the box.
- **Cygwin (legacy)** — Glenn's original setup. Still works; documented at the
  bottom of this section.

#### Windows Toolchain (MSYS + MSVC)

One-time prerequisites:

- **Visual Studio 2022 Build Tools** with the *Desktop development with C++*
  workload (Windows 10 SDK 10.0.26100 known-good). Build Tools, Community,
  Professional, and Enterprise editions are all auto-detected.
  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools `
    --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
    --accept-package-agreements --accept-source-agreements
  ```
- **Git for Windows** (provides the MSYS bash shell).
- **Node.js 18.x** + **yarn 1.22.x** (`npm install -g yarn`).

Portable build tools — extract these zips under `C:\buildtools\` (no installs):

| Tool            | Version           | Download                                                                                                                |
|-----------------|-------------------|-------------------------------------------------------------------------------------------------------------------------|
| NASM            | 2.16.03           | https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/win64/nasm-2.16.03-win64.zip                                         |
| YASM            | 1.3.0             | http://www.tortall.net/projects/yasm/releases/yasm-1.3.0-win64.exe (rename to `yasm.exe`)                               |
| CMake           | 3.30.5            | https://github.com/Kitware/CMake/releases/download/v3.30.5/cmake-3.30.5-windows-x86_64.zip                              |
| GNU Make        | 4.4.1             | https://sourceforge.net/projects/ezwinports/files/make-4.4.1-without-guile-w32-bin.zip/download                         |
| Strawberry Perl | 5.32.1.1 portable | https://strawberryperl.com/download/5.32.1.1/strawberry-perl-5.32.1.1-64bit-portable.zip                                |

Expected layout:
```
C:\buildtools\
  nasm\nasm.exe
  yasm.exe
  cmake\bin\cmake.exe
  make\bin\make.exe
  strawberry\perl\bin\perl.exe
```

Allow ~10 GB free disk for source trees, object files, and static libs.

**Open a build shell.** Double-click `native/ffreader/scripts/MSYS-vstudio.bat`
to launch a Git Bash terminal with `vcvars64.bat`'s `INCLUDE`/`LIB`/`LIBPATH`
inherited and the portable tools on `PATH`. (To use VS Code's integrated
terminal instead, see "Sourcing the env into another bash shell" below.)

**Build OpenCV** (clean, no patches needed, ~30–60 min):
```bash
cd native/ffreader
./scripts/build-opencv.sh
```

**Build FFmpeg.** This phase needs `MSYS_NO_PATHCONV=1` and
`MSYS2_ARG_CONV_EXCL='*'` to stop MSYS from path-converting Windows-style
arguments to MSVC. Export them once for the rest of the FFmpeg work — do
**not** keep them set permanently (they break OpenCV's CMake/curl
invocations, which is why they are not in `vs-env.sh`):

```bash
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
./scripts/build-ffmpeg.sh
```

`build-ffmpeg.sh` will run `configure` and then fail in `make` once with two
MSYS-specific issues. Apply the patch and resume:

```bash
# Fix the dependency-tracking awk that MSYS bash corrupts (writes ffbuild/dep.awk
# and rewrites ffbuild/config.mak to invoke awk -f).
node scripts/patch-config-mak.js

# Resume the build. vcpkg paths must be re-exported because the previous run
# only set them inside build-ffmpeg.sh's environment.
FF=$(pwd)/lib-build/FFmpeg-n7.1
VCPKG=$(cd "$(pwd)/lib-build/vcpkg/installed/x64-windows-static" && pwd -W)
export INCLUDE="$INCLUDE;$VCPKG/include"
export LIB="$LIB;$VCPKG/lib"

cd "$FF"
find . -name "*.o" -size 0 -delete
find . -name "*.a" -delete
make -j4   # MSYS_NO_PATHCONV/MSYS2_ARG_CONV_EXCL must still be exported
```

The final AR step (`lib.exe`) fails when invoked through make on MSYS — long
arg lists get truncated at the first `\t`, producing `LNK1181: cannot open
input file 'libavforma'`. The exact same commands run directly from bash
succeed. Workaround:

```bash
for L in libavformat libavcodec libavutil libswscale; do rm -f $L/$L.a; done
make -n libavformat/libavformat.a libavcodec/libavcodec.a \
        libavutil/libavutil.a libswscale/libswscale.a 2>&1 \
  | sed -nE 's/.*;[[:space:]]*(lib\.exe[[:space:]].*)/\1/p' > /tmp/ar-cmds.sh
bash /tmp/ar-cmds.sh
make install                             # MSYS env still required
cd ../
rm -rf ffmpeg-static-win
cp -a ffmpeg-static-win-x86_64 ffmpeg-static-win
```

(FFmpeg n7.1's `make -n` emits each AR step as
`printf "AR\t%s\n" target.a; lib.exe ...`, so `grep "^lib.exe"` won't catch
them — the sed extracts the `lib.exe ...` portion after the `;`.)

**Build the `.node` and use it:**
```bash
cd native/ffreader
yarn install --network-timeout 600000
npx node-gyp rebuild --arch=x64
cp build/Release/crewtimer_video_reader.node \
   ../../release/app/node_modules/crewtimer_video_reader/build/Release/
```

**Sourcing the env into another bash shell.** If you want to build from VS
Code's integrated terminal or any bash session that wasn't launched via
`MSYS-vstudio.bat`, generate a sourceable env file once:

```bash
cmd.exe //c "scripts\\dump-vs-env.bat > scripts\\vs-env.raw.txt"
node scripts/make-env.js
# Then in any bash session:
source native/ffreader/scripts/vs-env.sh
```

**Known gotchas** (covered above; collected here for reference):

| Symptom                                                                 | Cause                                                  | Fix                                       |
|-------------------------------------------------------------------------|--------------------------------------------------------|-------------------------------------------|
| `cl.exe not found` after sourcing env                                   | `vcvars64 >nul` suppressed `INCLUDE`/`LIB`             | `dump-vs-env.bat` does not redirect stdout |
| FFmpeg configure: `ERROR: zlib requested but not found`                 | vcpkg path passed as `/c/...` to `cl.exe`              | `pwd -W` MSYS branch in `build-ffmpeg.sh` |
| `awk: unterminated regexp` on every compile                             | MSYS bash strips one `\` from inline awk arg           | `node scripts/patch-config-mak.js`        |
| `LNK1181: cannot open input file 'libavforma'`                          | MSYS arg-passing corrupts long AR command              | Run `lib.exe` directly from bash          |
| `node-gyp rebuild` can't find `libavcodec/avcodec.h` under `release/app`| `binding.gyp` paths are relative to `native/ffreader`  | Build in `native/ffreader/`, copy `.node` |

For the app-level packaging step (electron-builder + NSIS installer) and the
`-c.npmRebuild=false` flag that's required on Windows, see the top-level
[README.md](../../README.md#windows-packaging-notes).

#### Windows Toolchain (Cygwin, legacy)

Glenn's original setup. Install the following:

- [nvm for windows](https://github.com/coreybutler/nvm-windows/releases)
- [git for windows](https://gitforwindows.org/)
- [Visual Studio Community]() with C++ addon
- [cmake](https://cmake.org/download/)
- Python.  Just type `python` on windows to get prompted to install. It is installed already on macos.
- [Cygwin 64 bit](https://www.cygwin.com/install.html).  Add 'yasm' and 'make' modules.

Either check out the git repo or if in a Macos Parallels Desktop, map a network drive to share the git repo.

In windows explorer, navigate to the scripts/ folder and double click on the Cygwin-vstudio.bat file.  This will open a bash terminal with the visual studio tools available from the command line.

## Building the prebuilt binary

## Build setup
Set up nvm/node:

```bash
nvm install 18
nvm use 18
npm i -g yarn
```

## Build ffmpeg and opencv

```bash
cd crewtimer-video-review/native/ffreader
./scripts/build-opencv.sh
./scripts/build-ffmpeg.sh
```

## Build the module and upload to github

```bash
yarn clean && yarn install && yarn build:mac
```

For windows:
```bash
# on mac when sharing file system
yarn clean

# on windows bash shell
cd y:/git/crewtimer-video-review/native/ffreader
yarn install && yarn build:win && yarn prebuild
```

The result is placed into a file such as prebuilds/crewtimer_video_reader-v1.0.2-napi-v6-win32-x64.tar.gz.

The command will also upload the binary module to github if a ~/.prebuildrc file with a github token is present such as 

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
