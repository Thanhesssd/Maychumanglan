@echo off
chcp 65001 >nul
title Khoi dong may chu LAN
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js: https://nodejs.org & pause & exit /b 1)
rem Loi thi dung lai de doc; da chay san thi tu dong cua so
node khoi-dong.js || pause
