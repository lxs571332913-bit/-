@echo off
title Habit Tracker
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
  ) else (
    echo.
    echo   [ERROR] Node.js not found.
    echo   Please install Node.js LTS from https://nodejs.org, then run this file again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Starting Habit Tracker ...
echo   Local: http://localhost:4321
echo   Press Ctrl+C to stop.
echo.
"%NODE%" server.js
echo.
echo   Service stopped.
pause