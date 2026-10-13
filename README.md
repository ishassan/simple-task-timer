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

The add-on asks for the notification permission only when you set a goal, and only if you click "Turn on". It works without that permission.

## Build

```bash
npx web-ext build --source-dir src
```

The package goes to `web-ext-artifacts/`.

## Test

Unit tests (Node.js 20 or newer, no packages):

```bash
node --test tests/
```

Browser test in headless Firefox (needs `pip install selenium`):

```bash
python3 ci/goal_test.py
```

`ci/android_test.py` runs the add-on in an Android emulator. GitHub Actions runs these tests (see `.github/workflows/`).

## License

Copyright (C) 2026 Islam Hassan

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See LICENSE.
