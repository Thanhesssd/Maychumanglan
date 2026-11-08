@echo off
chcp 65001 >nul
:: Mo cong 3000 trong tuong lua de may khac cung Wi-Fi vao duoc
net session >nul 2>&1 || (powershell -Command "Start-Process -Verb RunAs -FilePath \"%~f0\"" & exit /b)
netsh advfirewall firewall delete rule name="Cua hang LAN 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Cua hang LAN 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
echo Da mo cong 3000.
pause
