# Windows and Deadline

*Batch and command files, for the machine rather than the app. Part of [Chroma Motion Scripts](../README.md).*

Double-click to run. All of them prompt for their input, so there are no arguments to remember. `C4D_migration.bat` lives here rather than under `cinema4d/` because it's a Windows batch file that happens to move a C4D install around — nothing in it runs inside Cinema 4D.

### `C4D_migration.bat` — legacy

> **Superseded.** A cross-platform replacement is in development: **C4D Migrator**, a Python tool that auto-detects installed C4D versions, reads `version.h` for the real version numbers, skips C++ plugins on major-version migrations because they won't load anyway, discovers external plugin folders from `plugins.json`, lets you opt in and out of each category from a UI, and writes an HTML report of what it did. This batch script is preserved here, and in that project's `docs/`, as the thing it replaces.
>
> Still fine to use on Windows in the meantime — it works, it just hardcodes a lot.

Migrates a Cinema 4D setup from one release to the next.

Prompts for the old and new release numbers plus the unique install hash from each `%APPDATA%\Maxon\Maxon Cinema 4D <ver>_<hash>` folder, then copies across `new.c4d` (the default scene), user scripts, keyboard shortcuts, browser catalogs, layouts and plugins — from both the AppData and Program Files locations.

It then creates junctions from the commandline (`_x`) and Team Render (`_c`) preference folders back into the main plugins folder for **Greyscalegorilla**, **Motion Manager** and **MSLiveLink**, so render nodes see the same plugins as the workstation without a second copy on disk. Edit that block if you run a different plugin set.

### `run_deadline_custom_delay.bat`

Delayed Deadline Worker startup for a workstation you're about to use yourself.

Kills `deadlinelauncher.exe` and `deadlineworker.exe`, asks how many minutes to wait, counts down, then relaunches both. Use it to take a machine out of the farm for a couple of hours without having to remember to put it back. Assumes a default Deadline 10 install path (`C:\Program Files\Thinkbox\Deadline10\bin`).

### `system shutdown.cmd`

Prompts for a delay in minutes, then shuts the machine down. For leaving an overnight render with a clean end.

### `system standby.cmd`

Same, but suspends to standby instead of shutting down, via `powrprof.dll,SetSuspendState`.
