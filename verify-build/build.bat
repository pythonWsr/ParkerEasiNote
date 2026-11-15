@echo off
rem 用法：build.bat [verify|easinote] [输出文件名]
rem 需要：已设置 MSVC 环境（vcvars64），%RUNNER_TEMP% 下解压了 WebView2 SDK（wv2 目录）
setlocal enabledelayedexpansion

set PRODUCT=%~1
if "%PRODUCT%"=="" set PRODUCT=verify

set OUTNAME=%~2
if "%OUTNAME%"=="" (
  if /I "%PRODUCT%"=="easinote" (set OUTNAME=EasiNote.exe) else (set OUTNAME=VerifyDemo.exe)
)

set EXTRA=
if /I "%PRODUCT%"=="easinote" set EXTRA=/DPRODUCT_EASINOTE

if not exist dist mkdir dist

rem 1) 加密页面 → src\payload_data.h
node scripts\encrypt.js %PRODUCT%
if errorlevel 1 exit /b 1

rem 2) 资源：图标 + DPI 清单
rc /nologo /fo dist\app.res app.rc
if errorlevel 1 exit /b 1

rem 3) 编译链接（PerMonitorV2 DPI 感知由清单声明，避免高分屏模糊）
cl /nologo /std:c++17 /EHsc /utf-8 /O1 /Os /MT /DUNICODE /D_UNICODE /DNDEBUG %EXTRA% ^
   /I "%RUNNER_TEMP%\wv2\build\native\include" ^
   src\main.cpp dist\app.res ^
   /link /SUBSYSTEM:WINDOWS /OPT:REF /OPT:ICF /INCREMENTAL:NO /MANIFEST:NO ^
   /OUT:dist\%OUTNAME% ^
   user32.lib gdi32.lib ole32.lib oleaut32.lib advapi32.lib shlwapi.lib shell32.lib bcrypt.lib ^
   "%RUNNER_TEMP%\wv2\build\native\x64\WebView2LoaderStatic.lib"

exit /b %ERRORLEVEL%
