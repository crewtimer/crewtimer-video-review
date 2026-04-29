@echo off
:: Captures the env set up by vcvars64.bat plus the portable build tools so a
:: bash session (e.g. VS Code's integrated terminal) can source it without
:: going through MSYS-vstudio.bat. Pair with make-env.js, which converts the
:: dump to a bash-sourceable vs-env.sh.
::
:: Usage (from cmd or git-bash):
::   cmd.exe /c scripts\dump-vs-env.bat > scripts\vs-env.raw.txt
::   node scripts\make-env.js
::   source scripts/vs-env.sh
::
:: NOTE: do NOT redirect vcvars's stdout to nul here. Doing so causes vcvars
:: to silently skip setting INCLUDE/LIB/LIBPATH on some installs. Let it print
:: its banner and capture the whole stream.

setlocal enableextensions

set "VS_VCVARS="
for %%I in (
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
) do if exist %%~I set "VS_VCVARS=%%~I"

if not defined VS_VCVARS (
  echo ERROR: could not find vcvars64.bat for Visual Studio 2022. 1>&2
  exit /b 1
)

call "%VS_VCVARS%"
set PATH=C:\buildtools\nasm;C:\buildtools\make\bin;C:\buildtools\strawberry\perl\bin;C:\buildtools;C:\buildtools\cmake\bin;%PATH%
set
