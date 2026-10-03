@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m bridge.server --port 8787
) else (
  python -m bridge.server --port 8787
)
if errorlevel 1 (
  echo.
  echo Empire could not start. Python 3.10 or newer is required.
  echo If port 8787 is already used, run: py -3 -m bridge.server --port 8788
)
pause
