@echo off
setlocal
set "TARGET=%~dp0launch_operator.bat"
powershell -NoProfile -Command "$shell = New-Object -ComObject WScript.Shell; $name = 'AI' + [char]0x81EA + [char]0x52D5 + [char]0x6295 + [char]0x5F71; $shortcut = $shell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\' + $name + '.lnk'); $shortcut.TargetPath = '%TARGET%'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.Save()"
if errorlevel 1 exit /b 1
echo [INFO] Created Desktop shortcut: AI Jidou Touei
endlocal