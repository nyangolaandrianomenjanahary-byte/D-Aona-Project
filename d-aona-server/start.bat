@echo off
title D-aona Server - Hote Reseau
cd /d "%~dp0"
echo.
echo ============================================================
echo   D-aona Server - Mode Hote (partage reseau)
echo   Ce PC heberge le serveur. Partagez le lien affiche
echo   a vos amis sur le meme reseau WiFi / Bluetooth PAN.
echo ============================================================
echo.
node server.js
pause