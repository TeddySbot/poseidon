@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul || (echo Python introuvable. Installe-le : winget install Python.Python.3.12 & pause & exit /b)
if not exist config.json (copy config.exemple.json config.json >nul & echo Remplis config.json avec le token du bot puis relance. & notepad config.json & exit /b)
py -m pip install -q -r requirements.txt
py recap_bot.py
pause
