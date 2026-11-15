@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Air Space

where py >nul 2>nul
if not errorlevel 1 py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
if not errorlevel 1 goto use_py
where python >nul 2>nul
if not errorlevel 1 python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
if not errorlevel 1 goto use_python

echo Python 3.10 ou plus recent est necessaire pour lancer Air Space.
echo Installe Python depuis python.org, puis relance ce fichier.
pause
exit /b 1

:use_py
start "Air Space — serveur" cmd /k py -3 server.py
goto finished

:use_python
start "Air Space — serveur" cmd /k python server.py

:finished
exit /b 0
