@echo off
rem Starts the Connect-N web game locally and opens it in your browser.
cd /d "%~dp0web"
start "" http://localhost:8765
python -m http.server 8765
