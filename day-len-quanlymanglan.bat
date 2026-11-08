@echo off
chcp 65001 >nul
title Day code len GitHub Quanlymanglan
cd /d "%~dp0"
echo Day code len https://github.com/m23931716-coder/Quanlymanglan
echo Khi cua so dang nhap GitHub hien ra: dang nhap tai khoan m23931716-coder
echo.
git remote set-url quanly https://m23931716-coder@github.com/m23931716-coder/Quanlymanglan.git
git push quanly main || goto loi
for /f %%i in ('git subtree split --prefix docs HEAD 2^>nul') do set PAGES=%%i
git push --force quanly %PAGES%:refs/heads/gh-pages || goto loi
echo.
echo XONG. Mo https://github.com/m23931716-coder/Quanlymanglan/settings/pages
echo chon Branch: gh-pages, bam Save. Sau 1-2 phut link chay:
echo https://m23931716-coder.github.io/Quanlymanglan/
pause
exit /b 0
:loi
echo.
echo LOI: khong day duoc. Chup man hinh cua so nay gui lai.
pause
