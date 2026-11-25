@echo off
title SAFE-STAY Server - Hotel Emergency Guest Accountability System
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed on this computer.
  echo Please install Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

echo Starting SAFE-STAY Server...
start "" http://localhost:3000
node server.js
pause
