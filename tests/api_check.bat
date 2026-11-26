@echo off
setlocal
python "%~dp0api_check.py"
exit /b %errorlevel%
