@echo off
title Workbench Hub - new PIN
set /p WHO=Whose PIN (their name on the Hub)?
set /p NEWPIN=New PIN (4 to 12 digits):
set WB_HUB_HOME=%LOCALAPPDATA%\WorkbenchHub
"%LOCALAPPDATA%\WorkbenchHub\node\node.exe" "%LOCALAPPDATA%\WorkbenchHub\app\server.js" --reset-pin "%WHO%" "%NEWPIN%"
echo.
pause
