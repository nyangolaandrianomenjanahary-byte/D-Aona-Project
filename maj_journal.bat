@echo off
chcp 65001 >nul
title D-aona - Mise a jour du journal projet
cd /d "%~dp0"
echo ============================================
echo   Mise a jour du journal (CONTEXTE_PROJET.md)
echo ============================================
node update_log.js
echo.
pause
