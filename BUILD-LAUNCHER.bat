@echo off
setlocal
cd /d "%~dp0"
title VilaNexo Launcher - Build

echo ====================================================
echo          VilaNexo Launcher - Gerar instalador
echo ====================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js LTS: https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado.
  pause
  exit /b 1
)

echo [1/3] Verificando codigo...
call npm run check
if errorlevel 1 goto :fail

echo [2/3] Instalando dependencias de build...
call npm install
if errorlevel 1 goto :fail

echo [3/3] Gerando instalador Windows x64...
call npm run dist
if errorlevel 1 goto :fail

echo.
echo SUCESSO.
echo O instalador foi criado dentro da pasta dist.
explorer "%cd%\dist"
pause
exit /b 0

:fail
echo.
echo [ERRO] A build falhou. Veja a mensagem acima.
pause
exit /b 1
