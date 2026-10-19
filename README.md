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
- An update from version 3.x keeps your tasks with their names, times and goals. A task that was running keeps running.

## Keys

- **Alt+W** (Option+W on a Mac) opens the popup. The cursor is in the name field, so Alt+W then Enter starts a new task, and Alt+W then Space pauses or resumes the last task. On a Mac, this key then no longer types "∑" in Firefox. You can change this key in Preferences (see below).
- In the name field: **Enter** starts a new task. **Space** (with the field empty) pauses or resumes the last task. **Down arrow** goes to the list.
- On a task: **Up** and **Down arrows** move between tasks, **Space** starts or pauses, **Enter** or **E** edits, **R** resets, **D** marks done, **Delete** deletes, **Escape** goes back to the name field. These are the start keys; you can change them.
- **Ctrl+Z** (Cmd+Z on a Mac) undoes the last reset, done or delete while the Undo bar shows.
- To change the keys, open **Preferences**: Firefox menu, Add-ons and themes, the "..." button of Simple Task Timer, Preferences. There you can change the shortcut that opens the popup and the keys for start or pause, edit, reset, done and delete. The tooltip of each button shows its key.

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

Browser tests in headless Firefox (need `pip install selenium`):

```bash
python3 ci/goal_test.py
```

```bash
python3 ci/update_test.py
```

`ci/goal_test.py` tests the buttons, the keys, Undo, the goal and the notification. `ci/update_test.py` installs 3.11.0 (from the git tag `v3.11.0`), makes tasks in it, updates to this version, and checks that the tasks are kept.

`ci/android_test.py` runs the add-on in an Android emulator. GitHub Actions runs these tests (see `.github/workflows/`).

## Desktop app

`desktop/` holds a desktop app made with [Tauri](https://tauri.app). It shows the same screen as the add-on, in its own window. It does not sync yet (see `docs/desktop-and-sync-plan.md`).

- The window works like the popup: the same buttons, keys, Undo and goals.
- The menu bar shows the time of the running task, like the toolbar badge. Click the menu-bar icon to show or hide the window. Its menu has Preferences and Quit.
- A global shortcut shows or hides the window from any app. At the start it is **Control+Option+W** on a Mac (Ctrl+Alt+W on Windows and Linux). This key types no character, so it does not take a letter from other apps. While the app runs, other apps do not get this key. To change the shortcut or turn it off, open **Preferences**: Command+, (Ctrl+, on Windows and Linux), or Preferences in the menu-bar menu.
- The close button hides the window. The timer keeps counting.
- The goal notification is a system notification. Turn it on with "Turn on" in the window, as in the add-on.
- The tasks are saved in `state.json` in the app data folder (on macOS: `~/Library/Application Support/io.github.ishassan.simpletasktimer/`).
- Preferences has the same keys for the task rows as the add-on.

How it works: `desktop/copy-web.mjs` copies the add-on files from `src/` into `desktop/web/` and adds `desktop/shim/browser-shim.js`. That script gives the add-on code the Firefox `browser` calls it uses (storage, badge, alarms, notifications, the shortcut), with the app commands in `desktop/src-tauri/src/main.rs`. The Preferences window is the add-on Preferences page, with desktop texts and a "Turn off" button for the shortcut.

Build (needs Rust and Node.js):

```bash
cd desktop && npm install
```

```bash
cd desktop && npx tauri build
```

The app goes to `desktop/src-tauri/target/release/bundle/macos/`. Use `npx tauri dev` to run it while you work on it.

## License

Copyright (C) 2026 Islam Hassan

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See LICENSE.
