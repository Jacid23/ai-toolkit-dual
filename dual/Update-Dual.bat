@echo off&&cd /d %~dp0..
Title AI-Toolkit DUAL Update (pulls dual-gpu branch from the fork - never upstream directly)

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
set GIT_LFS_SKIP_SMUDGE=1

echo.
echo %green%:::::::::: Updating AI-Toolkit DUAL (dual-gpu branch) ::::::::::%reset%
echo.
REM IMPORTANT: no 'git reset --hard', no 'git clean' here. Custom work lives on
REM the dual-gpu branch of the fork; upstream changes only arrive via
REM dual\Sync-Upstream.bat (merge on the T: staging clone, then push).
git.exe checkout dual-gpu
git.exe pull origin dual-gpu
if errorlevel 1 (
    echo %red%Pull failed - resolve manually. Nothing was overwritten.%reset%
    echo Press any key to Exit...&Pause>nul
    goto :eof
)

echo.
echo %green%::::::: Installing requirements and updating diffusers :::::::%reset%
echo.
"%~dp0..\..\python_embeded_dual\python.exe" -I -m pip uninstall diffusers -y
"%~dp0..\..\python_embeded_dual\python.exe" -I -m pip install -r requirements.txt --no-cache --no-warn-script-location

echo.
echo %green%::::::::::::::: Update completed :::::::::::::::%reset%
echo %yellow%(UI rebuilds automatically on next dual\Start-Dual.bat)%reset%
if "%~1"=="" (
    echo %yellow%::::::::::::::: Press any key to exit :::::::::::::::%reset%&Pause>nul
    exit
)
