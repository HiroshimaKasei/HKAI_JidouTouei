@echo off
setlocal

call "%~dp0prepare_lan.bat"
if errorlevel 1 exit /b 1
call "%~dp0launch_operator.bat"

endlocal
