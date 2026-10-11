@echo off
setlocal

set "ROOT=%~dp0"
set "PYTHON=python"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "NPM_CMD=npm.cmd"

if not exist "%ROOT%.venv" "%PYTHON%" -m venv "%ROOT%.venv"
if not exist "%VENV_PY%" (
  echo [ERROR] Python venv was not created: "%VENV_PY%"
  exit /b 1
)

"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 exit /b 1
"%VENV_PY%" -m pip install -r "%ROOT%requirements.txt"
if errorlevel 1 exit /b 1

if not exist "%ROOT%frontend\node_modules" (
  call "%NPM_CMD%" --prefix "%ROOT%frontend" install
  if errorlevel 1 exit /b 1
)
call "%NPM_CMD%" --prefix "%ROOT%frontend" run build
if errorlevel 1 exit /b 1

echo [INFO] Preparation complete. Use launch_operator.bat for daily startup.
endlocal