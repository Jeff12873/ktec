@echo off
rem Lance par le raccourci « Installer K.NOVA » : la page d'installation s'ouvre, sans console qui reste ouverte.
rem Si ce lancement discret echoue, « Installer KTEC.bat » prend le relais, avec une console.
cd /d "%~dp0"
if exist "hors-ligne\node\node.exe" "hors-ligne\node\node.exe" serveur\lanceur.js --installation && exit /b 0
call "Installer KTEC.bat"
