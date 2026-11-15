@echo off
rem Usage: build.bat [verify|easinote] [output-exe-name]
rem Requires: MSVC environment (vcvars64) and WebView2 SDK unzipped to %RUNNER_TEMP%\wv2
rem NOTE: keep this file ASCII-only. cmd.exe reads .bat in the OEM code page,
rem       non-ASCII characters here break the script.
setlocal

set PRODUCT=%~1
if "%PRODUCT%"=="" set PRODUCT=verify

set OUTNAME=%~2
if "%OUTNAME%"=="" (
  if /I "%PRODUCT%"=="easinote" (set OUTNAME=EasiNote.exe) else (set OUTNAME=VerifyDemo.exe)
)

set EXTRA=
if /I "%PRODUCT%"=="easinote" set EXTRA=/DPRODUCT_EASINOTE

if not exist dist mkdir dist

rem 1) encrypt the page into src\payload_data.h
node scripts\encrypt.js %PRODUCT%
if errorlevel 1 exit /b 1

rem 2) icon + DPI manifest resources
rc /nologo /fo dist\app.res app.rc
if errorlevel 1 exit /b 1

rem 3) compile and link (PerMonitorV2 DPI awareness comes from the manifest)
cl /nologo /std:c++17 /EHsc /utf-8 /O1 /Os /MT /DUNICODE /D_UNICODE /DNDEBUG %EXTRA% ^
   /I "%RUNNER_TEMP%\wv2\build\native\include" ^
   src\main.cpp dist\app.res ^
   /link /SUBSYSTEM:WINDOWS /OPT:REF /OPT:ICF /INCREMENTAL:NO /MANIFEST:NO ^
   /OUT:dist\%OUTNAME% ^
   user32.lib gdi32.lib ole32.lib oleaut32.lib advapi32.lib shlwapi.lib shell32.lib bcrypt.lib ^
   "%RUNNER_TEMP%\wv2\build\native\x64\WebView2LoaderStatic.lib"

exit /b %ERRORLEVEL%
