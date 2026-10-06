@echo off
title Panta Pulse setup
cd /d "%~dp0"
call npm run setup
echo.
echo Setup finished. Close this window, stop the old Panta Pulse window (Ctrl+C), then double-click START.bat again.
pause
