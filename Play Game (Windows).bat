@echo off
REM ============================================================
REM Play Game (Windows).bat
REM Double-click to launch the game. Finds its own folder,
REM starts a local server (needed for webcam pose control),
REM opens the browser, and stops when you close this window.
REM ============================================================
cd /d "%~dp0"
set PORT=8000
echo ==================================================
echo   Untitled Quest - starting local server
echo   Folder: %CD%
echo   URL:    http://localhost:%PORT%
echo ==================================================
echo.
echo Opening your browser... keep this window open while playing.
echo Close this window to stop the game server.
echo.
start "" "http://localhost:%PORT%"
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m http.server %PORT%
) else (
  where py >nul 2>nul
  if %ERRORLEVEL%==0 (
    py -m http.server %PORT%
  ) else (
    echo Python is not installed. Install it from https://www.python.org/downloads/
    echo then double-click this file again.
    pause
  )
)
