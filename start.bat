@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
if not exist node_modules call npm install
start "" http://localhost:3000
node server\server.js
pause
