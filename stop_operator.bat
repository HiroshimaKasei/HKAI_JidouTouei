@echo off
setlocal

set "ROOT=%~dp0"
set "PID_FILE=%ROOT%logs\server.pid"
if not exist "%PID_FILE%" (
  echo [INFO] No launcher-managed HKAI server is running.
  exit /b 0
)

set /p PID=<"%PID_FILE%"
taskkill /pid %PID% /t >nul 2>nul
if errorlevel 1 (
  echo [WARN] The recorded HKAI process is already stopped.
) else (
  echo [INFO] HKAI server stopped.
)
del /q "%PID_FILE%" >nul 2>nul
endlocal