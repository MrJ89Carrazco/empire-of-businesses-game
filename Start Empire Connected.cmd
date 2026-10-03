@echo off
setlocal
cd /d "%~dp0"
echo Read-only connected mode: reads local Local Registry on port 8770
echo and Local Runtime on port 8000. No jobs are executed.
echo Start those existing services first. Press Ctrl+C to stop this bridge.
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m bridge.server --connect-local --port 8787
) else (
  python -m bridge.server --connect-local --port 8787
)
if errorlevel 1 (
  echo.
  echo Empire could not start. Python 3.10 or newer is required.
  echo If port 8787 is already used, run: py -3 -m bridge.server --connect-local --port 8788
)
pause
