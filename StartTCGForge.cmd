@echo off
rem Double-click to run TCGForge. This window closes when you close the app.
setlocal
title TCGForge
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH. Install it from https://nodejs.org and try again.
  goto :failed
)

if not exist "node_modules\" (
  echo First run: installing dependencies. This takes a minute or two...
  call npm install
  if errorlevel 1 goto :failed
)

set TCGFORGE_NO_DEVTOOLS=1
echo Starting TCGForge...
call npm start
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo TCGForge stopped with an error (see above).
echo If it mentions port 5173 being in use, TCGForge is probably already running.
pause
exit /b 1
