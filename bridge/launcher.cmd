@echo off
setlocal
set BRIDGE_DIR=%~dp0
cd /d "%BRIDGE_DIR%"
node "%BRIDGE_DIR%dist\host.js"
