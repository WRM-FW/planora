@echo off
chcp 65001 >nul
title Planora dev
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node launch.mjs %*
goto done
:nonode
echo.
echo   Node.js not found. Install Node 18+ from https://nodejs.org/ and try again.
echo.
:done
echo.
pause
