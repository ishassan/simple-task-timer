# Firefox add-on

The add-on for Firefox on a computer and on Android: [addons.mozilla.org/firefox/addon/simple-task-timer](https://addons.mozilla.org/firefox/addon/simple-task-timer/).

- The toolbar button shows the time of the running task. The badge turns green at the goal.
- Alt+W (Option+W on a Mac) opens the popup. Change it in Preferences (the gear button).
- The add-on asks for the notification permission only when you set a goal and click "Turn on".
- Firefox for Android has no keyboard shortcuts for add-ons.
- Firefox for Android has no Google sign-in for add-ons (`identity.launchWebAuthFlow`), so its sign-in goes through the web version. Preferences goes to Google, Google sends the sign-in to the web version's page, and that page sends it on to Preferences. Only that site can open Preferences (`web_accessible_resources` in `manifest.json`). The `state` value tells the web version the add-on's ID, and Preferences uses the sign-in only when the state is the one it saved, at most 30 minutes before.

## Build

`build.mjs` puts the files of [`app/`](../app) and `manifest.json` into `firefox/build/`, the add-on folder. Make the Firebase bundle first (see the [main README](../README.md)).

```bash
node firefox/build.mjs
```

```bash
npx web-ext build --source-dir firefox/build
```

The package goes to `web-ext-artifacts/`. AMO needs the source code with each version, because `app/lib/firebase.js` is a minified bundle.

## Release

The "Firefox release" workflow (`.github/workflows/firefox-release.yml`) sends a new version to AMO. It builds the add-on, makes the source code package from git, and sends both to AMO as a listed version. Mozilla then reviews the version.

1. Raise `version` in `manifest.json`. AMO refuses a version that it already has.
2. One time only: add the repository secrets `AMO_API_KEY` (JWT issuer) and `AMO_API_SECRET` (JWT secret), from the AMO Developer Hub, Manage API Keys.
3. In GitHub, open Actions, "Firefox release", Run workflow. You can write the release notes there.

## Test

Browser tests in headless Firefox (need `pip install selenium`), on `firefox/build`:

```bash
python3 firefox/tests/goal_test.py
```

```bash
python3 firefox/tests/update_test.py
```

```bash
node web/build.mjs && python3 firefox/tests/hand_off_test.py
```

- `goal_test.py`: the buttons, the keys, Undo, Preferences, the goal, the badge and the notification.
- `update_test.py`: installs 3.11.0 (git tag `v3.11.0`), makes tasks in it, updates to this version, and checks that the tasks are kept.
- `hand_off_test.py`: the sign-in of Firefox for Android after Google. The web version gets a test token and sends it on to the add-on. A token with another state, the same state a second time, and a page on another site are refused.
- `android_test.py`: runs the add-on in an Android emulator (GitHub Actions only), with the same sign-in step as `hand_off_test.py`.
- `amo_screenshots.py`: makes the AMO screenshots in `screenshots/` (also needs `pip install pillow`).
- `android_screenshot.py`: makes `screenshots/6-android.png` from two screenshots of the Android test (the menu, and the add-on page).
