# Mac app

The desktop app, made with [Tauri](https://tauri.app). It shows the same task list as the add-on, in its own window.

- The menu bar shows the time of the running task. Click the icon to show or hide the window; its menu has Preferences and Quit.
- A global shortcut shows or hides the window from any app: Alt+W (Option+W) at the start. While the app runs, other apps do not get this key. Change it or turn it off in Preferences (the gear button, or Cmd+,).
- The close button hides the window, and the timer keeps counting.
- The goal alert is a system notification.
- The tasks are saved in `~/Library/Application Support/io.github.ishassan.simpletasktimer/state.json`.

## How it works

`copy-web.mjs` copies the files of [`app/`](../app) into `desktop/web/` and adds `shim/browser-shim.js`. The shim gives the app code the Firefox `browser` calls it uses (storage, badge, alarms, notifications, the shortcut), with the app commands in `src-tauri/src/main.rs`. Google sign-in opens the system browser (`src-tauri/src/google.rs`).

## Build

Needs Rust, Node.js and the Firebase bundle (see the [main README](../README.md)). For Google sign-in, the build also needs the desktop client secret in `desktop/local-secrets.json`, which git ignores (see [`docs/desktop-and-sync-plan.md`](../docs/desktop-and-sync-plan.md), "Firebase project").

```bash
cd desktop && npm install && npx tauri build
```

The app goes to `src-tauri/target/release/bundle/`. Use `npx tauri dev` while you work on it.

The app icons come from `icon.svg`, which fills the whole square so that macOS gives it the standard rounded shape. To make them again (then remove the files that `tauri.conf.json` does not list):

```bash
cd desktop && npx tauri icon icon.svg -o src-tauri/icons
```
