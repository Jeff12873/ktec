@echo off
rem Lance KTEC sous Windows : demarre le serveur local, qui ouvre ensuite le navigateur.
rem Fermer cette fenetre arrete KTEC.
chcp 65001 >nul
cd /d "%~dp0"
title KTEC

:demarrer
"moteur\node\node.exe" serveur\demarrer.js %*
rem 42 = redemarrage demande (apres une mise a jour)
if %errorlevel%==42 goto demarrer
