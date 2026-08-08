@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "KEY=%CD%\src-tauri\keys\zerror.key"
set "CONF=%CD%\src-tauri\tauri.conf.json"
set "BAK=%CONF%.build-windows.bak"

if not exist "%KEY%" (
  echo Missing signing key: %KEY%
  exit /b 1
)

echo ==> Build NSIS
powershell -NoProfile -Command ^
  "$p='%CONF%'; $t=[IO.File]::ReadAllText($p); if($t -match '\"createUpdaterArtifacts\": true'){ Copy-Item $p '%BAK%' -Force; $u=New-Object Text.UTF8Encoding $false; [IO.File]::WriteAllText($p, $t.Replace('\"createUpdaterArtifacts\": true','\"createUpdaterArtifacts\": false'), $u) }"

call npm run tauri -- build --bundles nsis
set "BUILD_EXIT=%ERRORLEVEL%"

if exist "%BAK%" move /y "%BAK%" "%CONF%" >nul

if not "%BUILD_EXIT%"=="0" (
  echo tauri build failed: %BUILD_EXIT%
  exit /b %BUILD_EXIT%
)

for /f "delims=" %%F in ('dir /b /o-d "%CD%\src-tauri\target\release\bundle\nsis\*-setup.exe" 2^>nul') do (
  set "SETUP=%CD%\src-tauri\target\release\bundle\nsis\%%F"
  goto :found
)
echo NSIS setup.exe not found
exit /b 1

:found
echo ==> Sign %SETUP%
call npm run tauri -- signer sign --private-key-path "%KEY%" --password= "%SETUP%"
if errorlevel 1 (
  echo sign failed
  exit /b 1
)

echo ==> Done
dir /b "%CD%\src-tauri\target\release\bundle\nsis\*"
exit /b 0