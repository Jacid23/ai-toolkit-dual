@echo off&&cd /d %~dp0..
Title AI-Toolkit DUAL - Sync upstream (ostris) into the dual-gpu branch

REM Intended to run on the STAGING clone (T:\AItoolKit Builds\ai-toolkit-dual),
REM so merges are tested before the runtime install pulls them. Running it on
REM the runtime clone works too, just riskier.
REM
REM Flow: upstream/main --ff--> main --merge--> dual-gpu --push--> fork
REM A merge conflict is the DESIGNED failure mode: it means upstream touched
REM something we patched. Resolve by hand, commit, rerun. Nothing is ever
REM overwritten silently.

set warning=[33m
set     red=[91m
set   green=[92m
set  yellow=[93m
set   reset=[0m

git.exe remote get-url upstream >nul 2>&1
if errorlevel 1 git.exe remote add upstream https://github.com/ostris/ai-toolkit.git

echo %green%:: Fetching upstream (ostris) and origin (fork)...%reset%
git.exe fetch upstream
if errorlevel 1 goto :fail
git.exe fetch origin
if errorlevel 1 goto :fail

echo %green%:: Syncing main to upstream/main (mirror)...%reset%
git.exe checkout main
if errorlevel 1 goto :fail
REM pick up whatever the fork already has, then ff to the newest upstream
git.exe merge --ff-only origin/main
git.exe merge --ff-only upstream/main
if errorlevel 1 (
    echo %red%main has diverged from upstream - it must stay a pure mirror. Fix manually.%reset%
    goto :fail
)
git.exe push origin main

echo %green%:: Merging main into dual-gpu...%reset%
git.exe checkout dual-gpu
if errorlevel 1 goto :fail
REM CRITICAL: sync local dual-gpu to the fork FIRST. A merge may have been done
REM and pushed from another clone (e.g. the runtime install); without this the
REM merge below would re-run against a stale local branch and throw phantom
REM conflicts for work that is already resolved on the fork.
git.exe merge --ff-only origin/dual-gpu
if errorlevel 1 (
    echo %red%local dual-gpu diverged from the fork - resolve manually before syncing.%reset%
    goto :fail
)
git.exe merge main --no-edit
if errorlevel 1 (
    echo.
    echo %warning%MERGE CONFLICT - upstream changed something the dual build patches.%reset%
    echo %yellow%Resolve the conflicts, 'git commit', then 'git push origin dual-gpu'.%reset%
    echo %yellow%The conflicted files show exactly what upstream changed vs our patch.%reset%
    goto :end
)
git.exe push origin dual-gpu

echo.
echo %green%:: Sync complete. Run dual\Update-Dual.bat on the runtime install to pick it up.%reset%
goto :end

:fail
echo %red%Sync failed - see output above. Nothing destructive was done.%reset%

:end
if "%~1"=="" (echo Press any key to exit...&Pause>nul)
