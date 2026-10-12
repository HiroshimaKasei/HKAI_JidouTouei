@echo off
setlocal

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "HKAI_HOST=0.0.0.0"
if "%HKAI_PORT%"=="" set "HKAI_PORT=8000"
set "URL=http://127.0.0.1:%HKAI_PORT%"
set "LOG_DIR=%ROOT%logs"
set "LOG_FILE=%LOG_DIR%\server.log"
set "ERROR_LOG_FILE=%LOG_DIR%\server-error.log"
set "PID_FILE=%LOG_DIR%\server.pid"

if not exist "%VENV_PY%" (
  echo [ERROR] AI Jidou Touei is not prepared. Run prepare_lan.bat once first.
  exit /b 1
)
if not exist "%ROOT%frontend\dist\index.html" (
  echo [ERROR] Frontend build is missing. Run prepare_lan.bat once first.
  exit /b 1
)
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%/api/health/'; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto :open_browser

powershell -NoProfile -Command "$connection = Get-NetTCPConnection -LocalPort %HKAI_PORT% -State Listen -ErrorAction SilentlyContinue; if ($connection) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [ERROR] Port %HKAI_PORT% is already in use, but AI Jidou Touei is not ready. Check "%LOG_FILE%".
  exit /b 1
)

del /q "%PID_FILE%" >nul 2>nul
powershell -NoProfile -Command "$process = Start-Process -FilePath '%VENV_PY%' -ArgumentList '%ROOT%backend\run_server.py' -WorkingDirectory '%ROOT%backend' -RedirectStandardOutput '%LOG_FILE%' -RedirectStandardError '%ERROR_LOG_FILE%' -PassThru; $process.Id | Set-Content -NoNewline '%PID_FILE%'"
if errorlevel 1 (
  echo [ERROR] Failed to start AI Jidou Touei. Check "%LOG_FILE%".
  exit /b 1
)

for /l %%I in (1,1,20) do (
  powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%/api/health/'; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto :open_browser
  timeout /t 1 /nobreak >nul
)
echo [ERROR] AI Jidou Touei did not become ready. Check "%LOG_FILE%".
exit /b 1

:open_browser
start "" "%URL%"
echo [INFO] AI Jidou Touei ready at %URL%
echo [INFO] LAN PCs: http://SERVER-LAN-IP:%HKAI_PORT%
endlocal