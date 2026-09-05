@echo off
rem Planification quotidienne du journal projet (appele par la tache Windows)
cd /d "D:\Project\D-Aona\Root"
node update_log.js >> "%TEMP%\d-aona-journal.log" 2>&1
