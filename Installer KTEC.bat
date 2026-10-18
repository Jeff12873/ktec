@echo off
rem Installe KTEC sous Windows, ou le met a jour : ouvre la page d'installation dans le navigateur.
rem Node vient du kit hors ligne (hors-ligne\node) ; sinon il est telecharge une fois dans le profil.
rem Rien n'est installe hors du profil de l'utilisateur, aucun droit d'administrateur n'est necessaire.
chcp 65001 >nul
title Installation de KTEC
setlocal
cd /d "%~dp0"

rem Version de Node utilisee par KTEC (aussi dans installer-ktec.sh et outils\catalogue.json)
set "NODE_VERSION=v24.21.0"
set "NODE=%~dp0hors-ligne\node\node.exe"
if exist "%NODE%" goto lancer

set "NODE=%LOCALAPPDATA%\KTEC-installation\node-%NODE_VERSION%-win-x64\node.exe"
if exist "%NODE%" goto lancer
echo Téléchargement de Node %NODE_VERSION%...
mkdir "%LOCALAPPDATA%\KTEC-installation" 2>nul
curl.exe -L --fail -o "%LOCALAPPDATA%\KTEC-installation\node.zip" "https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip" || goto erreur
tar.exe -xf "%LOCALAPPDATA%\KTEC-installation\node.zip" -C "%LOCALAPPDATA%\KTEC-installation" || goto erreur
del "%LOCALAPPDATA%\KTEC-installation\node.zip"

:lancer
echo La page d'installation s'ouvre dans votre navigateur. Fermer cette fenêtre l'arrête.
"%NODE%" serveur\demarrer.js --installation %*
exit /b 0

:erreur
echo.
echo L'installation ne peut pas démarrer : voir le message ci-dessus.
pause
exit /b 1
