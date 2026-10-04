MAINTENANCE / DANGER - do NOT run these casually
================================================

These scripts change git state and can disrupt your working install.
They are tucked in here on purpose so you don't run them by accident.
For normal use you only ever need the two bats in the dual\ folder:

    dual\Start-Dual.bat     - start the app (fast, no rebuild)
    dual\Rebuild-Dual.bat   - rebuild the UI after code changes, then start

Scripts in THIS folder:

  Update-Dual.bat
    - git checkout + git pull of the build branch, then reinstalls
      python requirements. Only run when you deliberately want to pull
      down updates to this install. It does NOT build the UI - run
      dual\Rebuild-Dual.bat afterward to compile.

  Sync-Upstream.bat
    - fetches ostris upstream and MERGES it into the build branch, then
      pushes to your fork. Meant to run on the T: staging clone, not the
      runtime install. A merge conflict is the intended signal that
      upstream touched something the dual build patches.

NOTE: both scripts currently target the OLD 'dual-gpu' branch, not
'dual-gpu-v2'. Running them as-is on this v2 install would switch/merge
the wrong branch. Leave them alone unless you (or Claude) have updated
the branch name and you actually intend to update or sync.
