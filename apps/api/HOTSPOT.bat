@echo off
chcp 65001 >nul
title D-aona - Activer le hotspot WiFi (ADMIN)
echo.
echo ============================================================
echo   ACTIVATION DU POINT D'ACCES MOBILE (HOTSPOT WIFI)
echo   Les telephones se connectent a ce hotspot, puis ouvrent :
echo        http://192.168.137.1:8080
echo ============================================================
echo.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Relance automatique en administrateur...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0HOTSPOT.ps1"
type "%~dp0hotspot_result.txt"
echo.
echo   Si le hotspot ne demarre pas ici, activez-le manuellement :
echo   Parametres ^> Reseau et Internet ^> Point d'acces mobile ^> Activer
echo.
pause
