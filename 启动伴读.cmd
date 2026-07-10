@echo off
chcp 65001 >nul
title 伴读 · AI 阅读工具
cd /d "%~dp0"

echo.
echo   ============================================
echo      正在启动「伴读」，请稍候...
echo      浏览器会自动打开阅读界面
echo   ============================================
echo.
echo   * 使用期间请保持本窗口开着（它就是本地服务器）
echo   * 读完后直接关闭本窗口即可停止
echo.

REM ---------- 若伴读已在运行（端口 5180），直接打开浏览器 ----------
netstat -ano | findstr "LISTENING" | findstr ":5180 " >nul 2>nul
if not errorlevel 1 (
  echo   伴读已经在运行，直接打开浏览器...
  start "" http://localhost:5180/
  timeout /t 3 >nul
  exit /b 0
)

REM ---------- 定位 npm（不依赖系统 PATH 中的 npm） ----------
set "NPM_CMD="

REM 1) 优先使用系统 PATH 里能找到的 npm
where npm >nul 2>nul
if not errorlevel 1 set "NPM_CMD=npm"

REM 2) 依次探测常见 Node.js 安装位置（覆盖 PATH 未配置的情况）
if not defined NPM_CMD (
  if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
)
if not defined NPM_CMD (
  if exist "%LOCALAPPDATA%\npm\npm.cmd" set "NPM_CMD=%LOCALAPPDATA%\npm\npm.cmd"
)
if not defined NPM_CMD (
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\npm.cmd" set "NPM_CMD=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\npm.cmd"
)
if not defined NPM_CMD (
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\npm" set "NPM_CMD=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\npm"
)

if not defined NPM_CMD (
  echo   [出错] 找不到 Node.js / npm。
  echo   请从 https://nodejs.org/ 安装 Node.js（安装时勾选 "Add to PATH"）后再试。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   第一次启动，正在安装依赖，可能需要一两分钟...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo   [出错] 依赖安装失败，请把上面的红色报错发我。
    echo.
    pause
    exit /b 1
  )
  echo.
)

REM ---------- 每次启动都重新构建，保证打开的永远是最新代码 ----------
echo   正在构建最新版本（约十几秒）...
call "%NPM_CMD%" run build
if errorlevel 1 (
  if exist "dist\index.html" (
    echo.
    echo   [注意] 最新代码构建失败，先打开上一次能用的版本。
    echo   请把上面的红色报错截图发给写代码的 agent 修复。
    echo.
  ) else (
    echo   [出错] 构建失败，请把上面的红色报错截图发我。
    echo.
    pause
    exit /b 1
  )
)
echo.

REM ---------- 固定端口 5180（保证书籍/设置永久保留），服务稳定版 ----------
echo   正在启动本地服务器（http://localhost:5180/）...
call "%NPM_CMD%" run preview -- --open --port 5180 --strictPort

if errorlevel 1 (
  echo.
  echo   [出错] 启动失败，请查看上方红色报错。
  echo.
  pause
  exit /b 1
)

echo.
echo   服务器已停止。若上方有红色报错，请把整个窗口截图发我。
pause
