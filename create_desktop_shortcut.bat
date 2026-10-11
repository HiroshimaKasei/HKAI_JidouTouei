@echo off
setlocal
set "TARGET=%~dp0launch_operator.bat"
powershell -NoProfile -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\HKAI Operator.lnk'); $shortcut.TargetPath = '%TARGET%'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.Save()"
if errorlevel 1 exit /b 1
echo [INFO] Created Desktop shortcut: HKAI Operator
endlocal