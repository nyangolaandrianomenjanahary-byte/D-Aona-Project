@echo off
chcp 65001 >nul
title D-aona - LIEN REMOTE (serveur + tunnel public)
cd /d "%~dp0"
color 0B

echo.
echo ============================================================
echo   D-AONA - DEMARRAGE COMPLET (mode hote)
echo   1. Regle pare-feu (demande admin une fois)
echo   2. Serveur de jeu (HTTP + WebSocket + base SQLite)
echo   3. Tunnel public Cloudflare (lien Internet)
echo ============================================================
echo.

:: --- 1. Pare-feu (silencieux si deja fait) ---
netsh advfirewall firewall show rule name="D-aona Server 8080" >nul 2>&1
if %errorlevel% neq 0 (
    echo   [1/3] Ajout de la regle pare-feu (acceptez la fenetre UAC)...
    powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0setup_firewall.ps1'"
) else (
    echo   [1/3] Pare-feu : deja configure. OK.
)

:: --- 2. Serveur de jeu ---
echo   [2/3] Demarrage du serveur de jeu sur le port 8080...
taskkill /F /IM node.exe >nul 2>&1
start "D-aona Server" /min cmd /c "node server.js ^> server_out.log 2^> server_err.log"
timeout /t 3 /nobreak >nul

:: --- 3. Tunnel public Cloudflare ---
echo   [3/3] Ouverture du tunnel public (Cloudflare)...
taskkill /F /IM cloudflared.exe >nul 2>&1
if not exist cloudflared.exe (
    echo        Telechargement de cloudflared...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing"
)
start "D-aona Tunnel" /min cmd /c "cloudflared.exe tunnel --url http://localhost:8080 --no-autoupdate 2> tunnel_err.log"
echo        Attente de l'URL publique...
set PUBURL=
for /l %%i in (1,1,30) do (
    timeout /t 2 /nobreak >nul
    for /f "tokens=*" %%u in ('powershell -NoProfile -Command "(Select-String -Path 'tunnel_err.log' -Pattern 'https://[a-z0-9\-]+\.trycloudflare\.com' -AllMatches | Select-Object -Last 1).Matches.Value"') do set PUBURL=%%u
    if defined PUBURL goto :found
)
:found

echo.
echo ============================================================
echo   TOUT EST PRET ! Partagez UN de ces liens :
echo ============================================================
echo.
echo   [MEME WIFI / HOTSPOT / BLUETOOTH PAN]
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | ForEach-Object { Write-Host ('     http://' + $_.IPAddress + ':8080   (' + $_.InterfaceAlias + ')') }"
echo     http://192.168.137.1:8080   (si hotspot Windows actif)
echo.
echo   [INTERNET - depuis n'importe ou]
if defined PUBURL (
    echo     %PUBURL%
) else (
    echo     (URL tunnel en cours de generation... relancez ce script dans 20s)
)
echo.
echo ============================================================
echo   Appuyez sur une touche pour TOUT ARRETER.
echo ============================================================
pause >nul

taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1
echo   Serveur et tunnel arretes.
timeout /t 2 >nul
