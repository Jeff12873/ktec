@echo off
rem Lance K.NOVA sous Windows, sans fenetre de console : le lanceur demarre le serveur en arriere-plan,
rem qui ouvre ensuite la fenetre de K.NOVA. Pour l arreter : bouton "Arreter K.NOVA".
cd /d "%~dp0"
start "" /min "moteur\node\node.exe" serveur\lanceur.js %*
