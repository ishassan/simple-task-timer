# Simple Task Timer (Firefox)

A small Firefox add-on to time your tasks. It works in Firefox for desktop and Firefox for Android.

Firefox Add-ons page: https://addons.mozilla.org/en-US/firefox/addon/simple-task-timer/

## What it does

- Press Enter or Start to start a new task. With no name, the task gets the name "Task 1", "Task 2" and so on.
- Only one task runs at a time. When you start a task, the task that was running pauses.
- Each task has Start or Pause, Reset, Done and Delete. Click a task to change its name, its time or its goal.
- Reset, Done and Delete act at once. You can undo them for 6 seconds.
- Done tasks go to a folded "Done" group at the bottom. Start a done task to bring it back, or delete all done tasks at once.
- A task can have a goal. The timer keeps counting after the goal. When the task reaches its goal, the toolbar badge turns green, and you get one desktop notification if you allowed notifications.
- While a task runs, the toolbar icon shows its time.

## Keys

- **Alt+W** (Option+W on a Mac) opens the popup. The cursor is in the name field, so Alt+W then Enter starts a new task, and Alt+W then Space pauses or resumes the last task. On a Mac, this key then no longer types "∑" in Firefox. You can change this key in Firefox: Add-ons and themes, gear menu, Manage Extension Shortcuts.
- In the name field: **Enter** starts a new task. **Space** (with the field empty) pauses or resumes the last task. **Down arrow** goes to the list.
- On a task: **Up** and **Down arrows** move between tasks, **Space** starts or pauses, **Enter** or **E** edits, **R** resets, **D** marks done, **Delete** deletes, **Escape** goes back to the name field.
- **Ctrl+Z** (Cmd+Z on a Mac) undoes the last reset, done or delete while the Undo bar shows.

Keyboard shortcuts are for Firefox on a computer. Firefox for Android has no keyboard shortcuts for add-ons.

The add-on asks for the notification permission only when you set a goal, and only if you click "Turn on". It works without that permission.

## Build

```bash
npx web-ext build --source-dir src
```

The package goes to `web-ext-artifacts/`.

The PNG icons come from `src/icons/icon.svg` and `src/icons/icon-16.svg`. To make them again on macOS:

```bash
sh ci/render_icons.sh
```

## Test

Unit tests (Node.js 20 or newer, no packages):

```bash
node --test
```

Browser test in headless Firefox (needs `pip install selenium`):

```bash
python3 ci/goal_test.py
```

`ci/android_test.py` runs the add-on in an Android emulator. GitHub Actions runs these tests (see `.github/workflows/`).

## License

Copyright (C) 2026 Islam Hassan

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See LICENSE.
