@echo off
cd /d "%~dp0"
echo Running FreshMart sync...
node sync.js >> sync.log 2>&1
echo Done. See sync.log for details.
