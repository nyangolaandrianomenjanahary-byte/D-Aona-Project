@echo off
chcp 65001 >nul
title D-aona Server - Mode Hote (telephones)
cd /d "%~dp0"
echo.
echo ============================================================
echo   D-aona - DEMARRAGE DU SERVEUR (mode hote)
echo   Ce PC fait office de serveur. Sans internet necessaire.
echo ============================================================
echo.

:: 1. Activer le hotspot WiFi si pas deja fait (optionnel)
echo   Astuce : pour connecter des telephones, activez d'abord
echo   le HOTSPOT WiFi Windows :
echo     Parametres ^> Reseau et Internet ^> Point d'acces mobile
echo   (Pas besoin d'internet, juste le partage local)
echo.

:: 2. Lancer le serveur
echo   Demarrage du serveur sur le port 8080...
echo.
node server.js

echo.
echo ============================================================
echo   Le serveur s'est arrete. Appuyez sur une touche.
echo ============================================================
pause