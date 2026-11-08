@echo off
chcp 65001 >nul
title Trang dia chi may chu LAN
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:3000/quan-ly
node server.js
pause
