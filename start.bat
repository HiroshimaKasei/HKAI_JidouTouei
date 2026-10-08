@echo off
setlocal

set ROOT=%~dp0
set PYTHON=python

if not exist "%ROOT%\.venv" (
  %PYTHON% -m venv "%ROOT%\.venv"
)

call "%ROOT%\.venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r "%ROOT%\requirements.txt"

if not exist "%ROOT%\frontend\node_modules" (
  npm --prefix "%ROOT%\frontend" install
)

start "HKAI Backend" cmd /k "cd /d %ROOT%\backend && uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "HKAI Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev"

echo Started:
echo Backend:  http://127.0.0.1:8000
echo Frontend: http://127.0.0.1:5173
endlocal
