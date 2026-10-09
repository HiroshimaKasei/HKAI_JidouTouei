@echo off
setlocal

set ROOT=%~dp0
set PYTHON=python
set VENV_PY=%ROOT%\.venv\Scripts\python.exe
set NPM_CMD=npm.cmd

if "%HKAI_HOST%"=="" set HKAI_HOST=0.0.0.0
if "%HKAI_PORT%"=="" set HKAI_PORT=8000

if not exist "%ROOT%\.venv" (
  %PYTHON% -m venv "%ROOT%\.venv"
)

if not exist "%VENV_PY%" (
  echo [ERROR] Python venv was not created: "%VENV_PY%"
  exit /b 1
)

call "%ROOT%\.venv\Scripts\activate.bat"
"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 (
  echo [ERROR] Failed to upgrade pip.
  exit /b 1
)

"%VENV_PY%" -m pip install -r "%ROOT%\requirements.txt"
if errorlevel 1 (
  echo [ERROR] Failed to install Python dependencies.
  exit /b 1
)

if not exist "%ROOT%\frontend\node_modules" (
  call %NPM_CMD% --prefix "%ROOT%\frontend" install
  if errorlevel 1 (
    echo [ERROR] Failed to install frontend dependencies.
    exit /b 1
  )
)

call %NPM_CMD% --prefix "%ROOT%\frontend" run build
if errorlevel 1 (
  echo [ERROR] Frontend build failed.
  exit /b 1
)

echo [INFO] Starting HKAI LAN server on %HKAI_HOST%:%HKAI_PORT%
set HKAI_ENTRY=%ROOT%backend\run_server.py
if not exist "%HKAI_ENTRY%" (
  echo [ERROR] Entry script not found: "%HKAI_ENTRY%"
  exit /b 1
)

start "HKAI LAN Server" /D "%ROOT%backend" cmd /k "\"%VENV_PY%\" \"%HKAI_ENTRY%\""
if errorlevel 1 (
  echo [ERROR] Failed to start HKAI LAN Server window.
  exit /b 1
)

echo [INFO] Server process started in a new window: HKAI LAN Server
echo [INFO] Use that window to confirm LAN URL and server status.

endlocal
