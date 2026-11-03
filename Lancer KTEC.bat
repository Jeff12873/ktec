@echo off
rem Lance K.NOVA sous Windows, sans fenetre de console : le lanceur demarre le serveur en arriere-plan,
rem qui ouvre ensuite la fenetre de K.NOVA. Pour l arreter : bouton "Arreter K.NOVA".
rem Lance depuis un kit ou un zip de mise a jour decompresse (K.NOVA pas encore installe ici) : c est
rem l installation qu il faut, elle demarre a sa place ; sinon K.NOVA deja installe sur ce poste est ouvert.
chcp 65001 >nul
cd /d "%~dp0"
if exist "moteur\node\node.exe" goto lancer

if exist "hors-ligne\kit.json" goto installer
if exist "..\mise-a-jour.json" goto installer
if exist "%LOCALAPPDATA%\KTEC\moteur\node\node.exe" (
  cd /d "%LOCALAPPDATA%\KTEC"
  goto lancer
)
if exist "Installer KTEC.bat" goto installer
echo K.NOVA n'est pas installé sur ce poste : lancez « Installer KTEC.bat » depuis le kit hors ligne.
pause
exit /b 1

:installer
echo Ce dossier n'est pas K.NOVA installé : l'installation démarre (« Installer KTEC.bat »).
call "%~dp0Installer KTEC.bat" %*
exit /b

:lancer
start "" /min "moteur\node\node.exe" serveur\lanceur.js %*
