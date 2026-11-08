@echo off
chcp 65001 >nul
reg delete "HKCU\Software\Classes\maychulan" /f >nul 2>nul
echo Da go nut "Mo app" (link maychulan://) khoi may nay.
pause
