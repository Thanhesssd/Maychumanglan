@echo off
chcp 65001 >nul
title Trang thai may chu LAN
cd /d "%~dp0"
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'khoi-dong\.js|server\.js|chia-se-internet\.js') -or ($_.Name -match '^python' -and $_.CommandLine -match 'server\.py|chia_se_internet\.py') -or $_.Name -eq 'cloudflared.exe' }; 'So chuong trinh dang chay: ' + @($p).Count + ' (du: 7)'; $c = Get-NetTCPConnection -LocalPort 3000,8000,8443 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique; 'Cong dang mo: ' + ($c -join ', ') + ' (du: 3000, 8000, 8443)'; if (Test-Path 'data\public_url.txt') { 'Link app: ' + (Get-Content 'data\public_url.txt') } else { 'Link app: CHUA CO (may chu chua chay hoac dang khoi dong)' }; ''; '--- 15 dong nhat ky gan nhat (data\khoi-dong.log) ---'; Get-Content 'data\khoi-dong.log' -Tail 15 -Encoding UTF8 -ErrorAction SilentlyContinue"
echo.
echo Link cho moi nguoi: https://m23931716-coder.github.io/Quanlymanglan/
pause
