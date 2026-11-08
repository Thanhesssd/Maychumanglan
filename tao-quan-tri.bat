@echo off
chcp 65001 >nul
title Tao tai khoan quan tri
cd /d "%~dp0"
node tao-quan-tri.js
pause
