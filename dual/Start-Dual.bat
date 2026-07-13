@echo off&&cd /d %~dp0..
Title AI-Toolkit DUAL (2x GPU build) - port 8676

set PYTHONPATH=
set PYTHONHOME=
set PYTHON=
set PYTHONSTARTUP=
set PYTHONUSERBASE=
set PIP_CONFIG_FILE=
set PIP_REQUIRE_VIRTUALENV=
set VIRTUAL_ENV=
set CONDA_PREFIX=
set CONDA_DEFAULT_ENV=
set PYENV_ROOT=
set PYENV_VERSION=

set warning=[33m
set     red=[91m
set   green=[92m
set  yellow=[93m
set   reset=[0m

set "path=%~dp0..\..\python_embeded_dual;%~dp0..\..\python_embeded_dual\Scripts;%path%"

if not exist "%~dp0..\..\python_embeded_dual\" (
    echo %warning%WARNING:%reset% 'python_embeded_dual' folder NOT found at %~dp0..\..
    echo %green%Copy python_embeded to python_embeded_dual and rerun dual\Update-Dual.bat%reset%
    echo Press any key to Exit...&Pause>nul
    goto :eof
)

set GIT_LFS_SKIP_SMUDGE=1

echo.
echo %green%::::::::::::: Starting AI-Toolkit DUAL (port 8676) :::::::::::::%reset%
echo.
git.exe fetch --quiet >nul 2>&1
git.exe status -uno | findstr /C:"Your branch is behind" >nul
if %errorlevel%==0 (
    echo  - %red%UPDATES%reset% available on the dual-gpu branch.%green% Run dual\Update-Dual.bat%reset%
    echo.
)
echo  - Use the %green%Shutdown%reset% / %green%Restart%reset% buttons in the UI (bottom of the sidebar)
echo.

set "path=%windir%\System32\WindowsPowerShell\v1.0;%path%"

start /b powershell -NoProfile -ExecutionPolicy Bypass -Command "while(1){Start-Sleep 2;try{Invoke-WebRequest 'http://localhost:8676' -TimeoutSec 2 -UseBasicParsing -EA Stop|Out-Null;Start-Process 'http://localhost:8676';break}catch{}}"

REM Supervisor loop: the UI's Restart button drops a .dual_restart flag then
REM exits the server (concurrently --kill-others stops the worker too). We
REM relaunch when the flag is present, otherwise the Shutdown button / a clean
REM exit ends here. A restart rebuilds, so it picks up code changes.
if exist "%~dp0..\.dual_restart" del "%~dp0..\.dual_restart" >nul 2>&1
:runloop
cd /d %~dp0..\ui
call npm run build_and_start_dual
cd /d %~dp0..
if exist ".dual_restart" (
    del ".dual_restart" >nul 2>&1
    echo.
    echo %green%::::::::::::: Restarting AI-Toolkit DUAL... :::::::::::::%reset%
    echo.
    goto runloop
)
echo.
echo %yellow%AI-Toolkit DUAL has shut down. Close this window.%reset%
