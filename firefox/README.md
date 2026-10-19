# Firefox add-on

The add-on for Firefox on a computer and on Android: [addons.mozilla.org/firefox/addon/simple-task-timer](https://addons.mozilla.org/firefox/addon/simple-task-timer/).

- The toolbar button shows the time of the running task. The badge turns green at the goal.
- Alt+W (Option+W on a Mac) opens the popup. Change it in Preferences (the gear button).
- The add-on asks for the notification permission only when you set a goal and click "Turn on".
- Firefox for Android has no keyboard shortcuts for add-ons, and no Google sign-in for add-ons, so there is no sync there.

## Build

`build.mjs` puts the files of [`app/`](../app) and `manifest.json` into `firefox/build/`, the add-on folder. Make the Firebase bundle first (see the [main README](../README.md)).

```bash
node firefox/build.mjs
```

```bash
npx web-ext build --source-dir firefox/build
```

The package goes to `web-ext-artifacts/`. AMO needs the source code with each version, because `app/lib/firebase.js` is a minified bundle.

## Test

Browser tests in headless Firefox (need `pip install selenium`), on `firefox/build`:

```bash
python3 firefox/tests/goal_test.py
```

```bash
python3 firefox/tests/update_test.py
```

- `goal_test.py`: the buttons, the keys, Undo, Preferences, the goal, the badge and the notification.
- `update_test.py`: installs 3.11.0 (git tag `v3.11.0`), makes tasks in it, updates to this version, and checks that the tasks are kept.
- `android_test.py`: runs the add-on in an Android emulator (GitHub Actions only).
- `amo_screenshots.py`: makes the AMO screenshots in `screenshots/` (also needs `pip install pillow`).
