@echo off
chcp 65001 >nul
title Link Internet - Cloudflare
cd /d "%~dp0"
echo Bat may chu truoc (chay-trang-dia-chi.bat), roi giu cua so nay mo.
node chia-se-internet.js
pause
