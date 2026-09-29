@echo off
REM MonitorMail Desktop Launcher
REM This file starts the MonitorMail application

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Change to the MonitorMail directory
cd /d "%SCRIPT_DIR%"

REM Run the Python launcher
python launcher.py

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo Failed to start MonitorMail. Press any key to exit...
    pause
    exit /b 1
)

exit /b 0
