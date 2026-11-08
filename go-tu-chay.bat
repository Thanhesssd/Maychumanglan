@echo off
chcp 65001 >nul
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Startup') + '\May chu LAN - khoi dong.lnk') -ErrorAction SilentlyContinue"
echo Da go: may chu khong tu chay khi bat may nua.
echo (Che do ngu: chinh lai trong Settings - System - Power neu muon.)
pause
