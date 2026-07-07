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

rem 首次运行若没装依赖，自动装一次
if not exist "node_modules" (
  echo   第一次启动，正在安装依赖，可能需要一两分钟...
  call npm install
  echo.
)

call npm run dev -- --open --port 5180 --strictPort

echo.
echo   服务器已停止。若上方有报错，请把它截图发我。
pause
