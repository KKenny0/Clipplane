@echo off
setlocal
rem CLIPPLANE_NOTES_DIR not set
set "SCRIPT_DIR=%~dp0"
"C:\Program Files\nodejs\node.exe" "%SCRIPT_DIR%host.mjs"
