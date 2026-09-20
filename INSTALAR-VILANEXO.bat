@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "INSTALLDIR=%LOCALAPPDATA%\Programs\VilaNexo Launcher"
set "RUNTIME=%INSTALLDIR%\runtime\electron"
set "ELECTRONZIP=%TEMP%\VilaNexo-electron-v38.zip"
set "ELECTRONURL=https://github.com/electron/electron/releases/download/v38.0.0/electron-v38.0.0-win32-x64.zip"

echo ====================================================
echo        VilaNexo Launcher 1.8.0 - Instalador
echo ====================================================
echo.
if not exist "%INSTALLDIR%" mkdir "%INSTALLDIR%"

echo [1/5] Copiando arquivos do launcher...
xcopy "%~dp0src" "%INSTALLDIR%\src\" /E /I /Y >nul || goto :erro
xcopy "%~dp0assets" "%INSTALLDIR%\assets\" /E /I /Y >nul || goto :erro
copy /Y "%~dp0launcher.config.json" "%INSTALLDIR%\launcher.config.json" >nul || goto :erro
copy /Y "%~dp0package.json" "%INSTALLDIR%\package.json" >nul || goto :erro
if not exist "%INSTALLDIR%\mods" mkdir "%INSTALLDIR%\mods"
if exist "%~dp0mods" xcopy "%~dp0mods\*.jar" "%INSTALLDIR%\mods\" /Y >nul 2>nul

echo [2/5] Verificando motor do launcher...
if exist "%RUNTIME%\electron.exe" goto :atalhos

echo [3/5] Baixando Electron oficial...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing '%ELECTRONURL%' -OutFile '%ELECTRONZIP%'" || goto :erro
if not exist "%RUNTIME%" mkdir "%RUNTIME%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ELECTRONZIP%' -DestinationPath '%RUNTIME%' -Force" || goto :erro
del /Q "%ELECTRONZIP%" >nul 2>nul

:atalhos
echo [4/5] Criando atalhos...
set "OPENBAT=%INSTALLDIR%\Abrir VilaNexo Launcher.cmd"
>"%OPENBAT%" echo @echo off
>>"%OPENBAT%" echo start "" "%RUNTIME%\electron.exe" "%INSTALLDIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'VilaNexo Launcher.lnk')); $s.TargetPath='%RUNTIME%\electron.exe'; $s.Arguments='\"%INSTALLDIR%\"'; $s.WorkingDirectory='%INSTALLDIR%'; $s.Save()" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'),'Programs','VilaNexo Launcher.lnk'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($p); $s.TargetPath='%RUNTIME%\electron.exe'; $s.Arguments='\"%INSTALLDIR%\"'; $s.WorkingDirectory='%INSTALLDIR%'; $s.Save()" >nul 2>nul

echo [5/5] Concluido.
echo Instalado em: %INSTALLDIR%
echo.
start "" "%RUNTIME%\electron.exe" "%INSTALLDIR%"
echo O VilaNexo Launcher foi aberto.
pause
exit /b 0

:erro
echo.
echo ERRO: a instalacao nao foi concluida.
echo Verifique sua internet e tente novamente.
pause
exit /b 1
