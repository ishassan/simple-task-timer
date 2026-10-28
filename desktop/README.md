# Mac app

The desktop app, made with [Tauri](https://tauri.app). It shows the same task list as the add-on, in its own window.

- The menu bar shows the time of the running task. Click the icon to show or hide the window; its menu has Preferences and Quit.
- A global shortcut shows or hides the window from any app: Alt+W (Option+W) at the start. While the app runs, other apps do not get this key. Change it or turn it off in Preferences (the gear button, or Cmd+,).
- The close button hides the window and removes the app from the Dock, and the timer keeps counting. The menu bar icon stays. To stop the app, use Quit in the menu bar icon's menu.
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

## Release

The "Mac release" workflow (`.github/workflows/mac-release.yml`) builds the app on a GitHub Mac with Apple silicon, makes `Simple-Task-Timer-<version>-mac-arm64.dmg`, and puts it in the GitHub release `v<version>`. When that release is not there, the workflow makes it, with the release notes. When the release already has the file, the workflow stops.

1. Raise the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
2. One time only: add the repository secret `GOOGLE_DESKTOP_SECRET`, the client secret of "Simple Task Timer desktop" (see [`docs/desktop-and-sync-plan.md`](../docs/desktop-and-sync-plan.md), "Firebase project"). Without it, the workflow stops, because sign-in does not work in a build without the secret.
3. In GitHub, open Actions, "Mac release", Run workflow. Write "What's new" there, with `;` between the items.

To build the app of a release again (for example, after a fix in the build), run the workflow with "replace" on. It replaces the disk image in the release and writes the release notes again.

The build signs the whole app ad hoc (`bundle > macOS > signingIdentity` is `"-"` in `src-tauri/tauri.conf.json`). Without it, only the program file has a signature, and `codesign --verify` says "code has no resources but signature indicates they must be present". The app is not notarized, so macOS 27 says that a downloaded copy "is damaged and can't be opened" until the user removes the quarantine mark (see the [main README](../README.md)).

The app icons come from `icon.svg`, which fills the whole square so that macOS gives it the standard rounded shape. To make them again (then remove the files that `tauri.conf.json` does not list):

```bash
cd desktop && npx tauri icon icon.svg -o src-tauri/icons
```
