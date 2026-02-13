@echo off
cd /d "%~dp0"
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do set "%%a=%%b"
node src\index.js
