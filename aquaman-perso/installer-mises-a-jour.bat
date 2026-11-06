@echo off
rem Installe (une seule fois) l'assistant qui permet au bouton "Mettre a jour" d'Aquaman (perso) de se mettre a jour tout seul.
rem Pour le retirer : installer-mises-a-jour.bat -Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0updater\install.ps1" %*
pause
