@echo off
rem Desinstalle K.NOVA (KTEC) de ce poste Windows : le programme, ses applications et ses raccourcis.
rem Les donnees sont gardees : Documents\KTEC (fichier de connaissances .ktec, sauvegardes, preferences).
rem Les modeles d'IA (dossier commun du poste) ne sont supprimes que si on le demande.
rem Pas de PowerShell ni de droits d'administrateur : tout est dans le profil de l'utilisateur.
chcp 65001 >nul
title Désinstallation de K.NOVA
setlocal

set "DOSSIER=%LOCALAPPDATA%\KTEC"
if exist "%~dp0registre.json" set "DOSSIER=%~dp0"
if "%DOSSIER:~-1%"=="\" set "DOSSIER=%DOSSIER:~0,-1%"
if not "%~1"=="" set "DOSSIER=%~1"

rem Lancé depuis le dossier installé (qu'il va supprimer) : il se recopie dans le dossier temporaire et continue de là.
if exist "%~dp0registre.json" (
  copy /y "%~f0" "%TEMP%\Desinstaller-KTEC.bat" >nul
  start "Désinstallation de K.NOVA" "%TEMP%\Desinstaller-KTEC.bat" "%DOSSIER%"
  exit /b
)
set "MODELES=%PUBLIC%\KTEC\modeles"

echo.
echo   Désinstallation de K.NOVA
echo   -------------------------
echo   Programme supprimé : %DOSSIER%
echo   Données gardées    : %USERPROFILE%\Documents\KTEC (fichier .ktec, sauvegardes)
echo.
if not exist "%DOSSIER%" (
  echo K.NOVA n'est pas installé dans ce dossier.
  echo Pour un autre dossier : faites glisser ce dossier sur ce fichier .bat.
  goto fin
)
choice /c ON /m "Désinstaller K.NOVA de ce poste ? (O = oui, N = non)"
if errorlevel 2 goto fin

rem 1. Arrêter K.NOVA s'il tourne (il enregistre le fichier de connaissances avant de s'arrêter).
echo Arrêt de K.NOVA...
curl.exe -s -X POST -H "X-KTEC: 1" http://127.0.0.1:47700/api/ktec/quitter >nul 2>&1
timeout /t 5 /nobreak >nul
taskkill /f /im llama-server.exe >nul 2>&1

rem 2. Les raccourcis : Bureau (même redirigé, lu dans le registre) et menu Démarrer.
set "BUREAU=%USERPROFILE%\Desktop"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v Desktop 2^>nul ^| find "Desktop"') do call set "BUREAU=%%b"
del /q "%BUREAU%\KTEC.lnk" 2>nul
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\KTEC.lnk" 2>nul

rem 3. Le programme et ses applications, puis le Node téléchargé par l'installateur.
echo Suppression du programme...
rmdir /s /q "%DOSSIER%" 2>nul
if exist "%DOSSIER%" (
  timeout /t 5 /nobreak >nul
  rmdir /s /q "%DOSSIER%" 2>nul
)
if exist "%DOSSIER%" (
  echo.
  echo Le dossier n'a pas pu être supprimé entièrement : K.NOVA est peut-être encore ouvert.
  echo Fermez la fenêtre de K.NOVA puis relancez ce fichier.
  goto fin
)
rmdir /s /q "%LOCALAPPDATA%\KTEC-installation" 2>nul

rem 4. Les modèles d'IA : plusieurs Go, communs au poste. Seulement si on le demande.
if exist "%MODELES%" (
  echo.
  choice /c ON /m "Supprimer aussi les modèles d'IA (%MODELES%) ? (O = oui, N = non)"
  if not errorlevel 2 rmdir /s /q "%MODELES%" 2>nul
)

echo.
echo K.NOVA est désinstallé. Vos données restent dans %USERPROFILE%\Documents\KTEC.

:fin
echo.
pause
endlocal
