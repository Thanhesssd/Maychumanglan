@echo off
chcp 65001 >nul
title Cai may chu tu chay
cd /d "%~dp0"
echo Cai de may chu LUON CHAY: dien thoai nao bam "Mo app" cung vao duoc ngay.
echo.
rem 1. Loi tat khoi-dong.bat trong thu muc Startup: tu chay moi khi dang nhap Windows (cua so thu nho)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\May chu LAN - khoi dong.lnk'); $s.TargetPath='%~dp0khoi-dong.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()" || goto loi
echo [1/2] Da cai: may chu tu chay khi bat may.
rem 2. Khong cho may ngu khi cam sac (ngu la link ngung chay)
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
echo [2/2] Da tat che do ngu khi cam sac.
echo.
echo XONG. Bay gio bat may chu luon: dang mo khoi-dong.bat...
start "" /min "%~dp0khoi-dong.bat"
echo Go bo: bam dup go-tu-chay.bat
pause
exit /b 0
:loi
echo LOI: khong cai duoc. Chup man hinh gui lai.
pause
