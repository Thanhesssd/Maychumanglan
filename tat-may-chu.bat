@echo off
chcp 65001 >nul
title Tat may chu LAN
echo Tat may chu: link app se ngung chay cho den khi bat lai (khoi-dong.bat).
choice /c CK /m "Tat that khong? C = Co, K = Khong"
if errorlevel 2 exit /b 0
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'khoi-dong\.js|server\.js|chia-se-internet\.js') -or ($_.Name -match '^python' -and $_.CommandLine -match 'server\.py|chia_se_internet\.py') -or $_.Name -eq 'cloudflared.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
del "%~dp0data\public_url.txt" >nul 2>nul
echo Da tat may chu.
pause
