@echo off
chcp 65001 >nul
title Khoi dong may chu LAN
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js: https://nodejs.org & pause & exit /b 1)
rem Chay NGAM (khong co cua so de lo tay dong). Xem: trang-thai.bat   Tat: tat-may-chu.bat
rem Muon chay hien cua so de xem truc tiep: khoi-dong.bat hien
if /i "%~1"=="hien" (node khoi-dong.js & pause & exit /b)
powershell -NoProfile -Command "Start-Process -FilePath node -ArgumentList 'khoi-dong.js' -WorkingDirectory '%~dp0.' -WindowStyle Hidden" || goto loi
echo Dang bat may chu chay ngam (khong can giu cua so nao mo)...
echo Khoang 1 phut sau, link GitHub tu dan vao app:
echo   https://m23931716-coder.github.io/Quanlymanglan/
echo Xem tinh trang: trang-thai.bat     Tat may chu: tat-may-chu.bat
timeout /t 8 >nul
exit /b 0
:loi
echo LOI: khong bat duoc. Thu: khoi-dong.bat hien
pause
