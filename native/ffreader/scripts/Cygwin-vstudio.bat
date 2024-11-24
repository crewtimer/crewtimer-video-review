@echo off
setlocal enableextensions
set TERM=
call "c:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

:: Get the directory of the batch file
set BATCH_DIR=%~dp0

:: Move to the parent directory of the batch file
cd "%BATCH_DIR%.."

:: Start Bash
"c:\Cygwin64\bin\bash" --login -i