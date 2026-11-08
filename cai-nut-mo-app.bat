@echo off
chcp 65001 >nul
title Cai nut Mo app
cd /d "%~dp0"
set "BAT=%~dp0khoi-dong.bat"
reg add "HKCU\Software\Classes\maychulan" /ve /d "URL:Khoi dong may chu LAN" /f >nul || goto loi
reg add "HKCU\Software\Classes\maychulan" /v "URL Protocol" /d "" /f >nul || goto loi
reg add "HKCU\Software\Classes\maychulan\shell\open\command" /ve /d "\"%BAT%\"" /f >nul || goto loi
echo.
echo DA CAI XONG nut "Mo app" tren may nay.
echo Tu gio, bam "Mo app" / "Bat may chu" tren trang GitHub se tu chay: %BAT%
echo Trinh duyet se hoi "Mo Khoi dong may chu LAN?" - bam Mo (co the tich "Luon cho phep").
echo Go bo: bam dup go-nut-mo-app.bat
echo.
pause
exit /b 0
:loi
echo LOI: khong cai duoc. Chup man hinh gui lai.
pause
