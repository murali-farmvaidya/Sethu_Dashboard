@echo off
echo.
echo ========================================
echo   Copy Production Data to Test Tables
echo ========================================
echo.

cd /d %~dp0..
node scripts/copy-to-test.js

echo.
echo Press any key to close...
pause >nul
