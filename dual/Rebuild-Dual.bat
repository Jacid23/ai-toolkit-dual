@echo off&&cd /d %~dp0..
Title AI-Toolkit DUAL - REBUILD (compile UI, then start)

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

set "path=%~dp0..\..\python_embeded_dual_v2;%~dp0..\..\python_embeded_dual_v2\Scripts;%path%"
set GIT_LFS_SKIP_SMUDGE=1

echo.
echo ::::::::::: Rebuilding AI-Toolkit DUAL UI :::::::::::
echo (install deps, sync db, next build - run this AFTER changing code)
echo.

cd /d %~dp0..\ui
call npm run install_deps
if errorlevel 1 goto :buildfail
call npm run update_db
if errorlevel 1 goto :buildfail
call npm run build
if errorlevel 1 goto :buildfail

echo.
echo ::::::::::: Build complete - launching :::::::::::
echo.
cd /d %~dp0
call "%~dp0Start-Dual.bat"
goto :eof

:buildfail
echo.
echo ***** BUILD FAILED - see the output above. Not starting. *****
echo Fix the error, then run dual\Rebuild-Dual.bat again.
echo Press any key to exit...&Pause>nul
