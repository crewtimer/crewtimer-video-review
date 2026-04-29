@echo off
setlocal enableextensions
set TERM=

:: Locate vcvars64.bat across common VS 2022 editions (Build Tools, Community,
:: Professional, Enterprise). Last match wins; adjust order if you have multiple.
set "VS_VCVARS="
for %%I in (
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
) do if exist %%~I set "VS_VCVARS=%%~I"

if not defined VS_VCVARS (
  echo ERROR: could not find vcvars64.bat for Visual Studio 2022.
  echo Install the "Desktop development with C++" workload from VS Build Tools 2022.
  exit /b 1
)

call "%VS_VCVARS%"

:: Prepend the portable build tools that the FFmpeg/OpenCV builds need.
:: See native/ffreader/README.md "Windows Toolchain (MSYS + MSVC)" for layout.
set PATH=C:\buildtools\nasm;C:\buildtools\make\bin;C:\buildtools\strawberry\perl\bin;C:\buildtools;C:\buildtools\cmake\bin;%PATH%

:: NOTE: MSYS_NO_PATHCONV and MSYS2_ARG_CONV_EXCL are NOT set here on purpose.
:: Setting them globally breaks OpenCV's CMake/curl invocations. They are only
:: needed for the FFmpeg build; export them in your bash shell just before
:: running build-ffmpeg.sh, per native/ffreader/README.md.

:: Move to native/ffreader (parent of scripts/)
set BATCH_DIR=%~dp0
cd "%BATCH_DIR%.."

:: Launch Git Bash. INCLUDE/LIB/LIBPATH set by vcvars64 are inherited as-is
:: (MSYS does not path-convert these), so cl.exe resolves them correctly.
set "GIT_BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GIT_BASH%" set "GIT_BASH=C:\Program Files\Git\usr\bin\bash.exe"
"%GIT_BASH%" --login -i
