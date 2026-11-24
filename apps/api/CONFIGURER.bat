@echo off
title D-aona - Configuration pare-feu (ADMINISTRATEUR)
color 0C
echo.
echo ============================================================
echo   CONFIGURATION DU PARE-FEU POUR D-AONA
echo   IMPORTANT : Ce script doit etre lance en ADMINISTRATEUR.
echo   (Clic droit sur le fichier ^> "Executer en tant
echo    qu'administrateur")
echo ============================================================
echo.

:: Verifier si on est admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   [!] Vous n'etes pas en mode administrateur.
    echo       Fermez puis relancez avec : Clic droit ^> Executer
    echo       en tant qu'administrateur.
    echo.
    pause
    exit /b
)

echo   [OK] Mode administrateur detecte.
echo.
echo   Ajout de la regle de pare-feu pour le port 8080...
netsh advfirewall firewall delete rule name="D-aona Server 8080" >nul 2>&1
netsh advfirewall firewall add rule name="D-aona Server 8080" dir=in action=allow protocol=TCP localport=8080
echo.
echo   Ajout de la regle pour node.exe (le serveur)...
netsh advfirewall firewall delete rule name="D-aona node" >nul 2>&1
netsh advfirewall firewall add rule name="D-aona node" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes
echo.
echo   ============================================================
echo   TERMINE !
echo   Le port 8080 est maintenant autorise sur le pare-feu.
echo   Vous pouvez maintenant demarrer le serveur avec DEMARRER.bat
