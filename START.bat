@echo off
title Panta Pulse
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Opening the download page...
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing packages, please wait...
  call npm install
)

if not exist .env (
  call npm run setup
)

echo.
echo Starting Panta Pulse... keep this window open.
start "" http://localhost:8787
call npm start
pause
