@echo off
cd /d "%~dp0"
set PORT=8743
echo Starting Reel Factory...
start "" http://localhost:%PORT%/
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -m http.server %PORT%
  ) else (
    echo Python isn't installed. Install it from python.org, then double-click this file again.
    pause
  )
)
