# Plan: desktop app and sync with a Google account

## Goal

1. A desktop app (macOS first, then Windows and Linux) that does the same as the Firefox add-on.
2. Sign-in with a Google account. The tasks and their times sync between all devices that use the same account: the desktop app, Firefox on a computer, and Firefox for Android.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Desktop app | [Tauri](https://tauri.app) | The popup is plain HTML and JavaScript, and Tauri shows it in the system web view. The app is small. Electron also works, but its apps are much larger. |
| Sync and sign-in | Firebase: Authentication with the Google provider, and Cloud Firestore | Google sign-in and a database in one service. Firestore sends changes to the other devices at once, and it keeps working offline. |
| Shared logic | `src/tasks.js` stays the one file for the task rules | The add-on, the desktop app and the unit tests use the same rules. |
| iPhone | A small web version (step 7) | Firefox for iOS cannot run add-ons. A web page that you add to the home screen can use the same screen and the same sync. |

## Parts

```
src/tasks.js      Task rules, sync stamps and merge (no browser calls)
src/store.js      Add-on storage (browser.storage.local)
src/popup.*       The screen (the add-on popup, and later the desktop window)
src/background.js Add-on badge, alarms and notification
src/sync*.js      Firebase sign-in and Firestore sync, used by the add-on and the desktop app (see "Sync code")
desktop/          The Tauri app: window, menu-bar timer, global shortcut, notification
desktop/shim/     The "browser" API for the add-on scripts in the desktop app
docs/             Plans and decisions
```

Each platform gives the screen the same small set of functions:

| Function | Firefox add-on | Desktop app (Tauri) |
|---|---|---|
| Save and read tasks | `browser.storage.local` | `state.json` in the app data folder (app commands `load_state`, `save_state`) |
| Running time outside the window | Toolbar badge | Menu-bar (tray) title, for example "25m" |
| Goal alarm | `browser.alarms` and `browser.notifications` | Timers in the page and the notification plugin |
| Open shortcut | `commands` in the manifest (Alt+W) | Global shortcut plugin, set on the Preferences page |
| Sign-in | `browser.identity.launchWebAuthFlow` | The system browser, with a redirect to a local port |

### Desktop app decisions

- The desktop window runs the add-on scripts without changes: `popup.js` and `background.js` in one page. `desktop/shim/browser-shim.js` gives them the `browser` calls they use. So a change to the add-on screen also changes the desktop app.
- The window keeps its timers when it is hidden: the window setting `backgroundThrottling` is `"disabled"`. Tauri supports this setting on macOS 14 and later, not on Windows and Linux. On Windows and Linux, the menu-bar time and the goal alarm can be late while the window is hidden.
- The close button hides the window, so the timer keeps running. Quit is in the tray menu.
- The shortcut is global, so it takes its key from all apps while the desktop app runs. Its start value is Alt+W (Option+W on a Mac), as in the add-on: the user chose the same key as in Firefox, and accepts that Option+W then types no "∑" in any app while the desktop app runs. Preferences can change it or turn it off. It is saved as a Firefox shortcut text in `desktopShortcut`, so the Preferences page of the add-on works without changes.
- The Preferences window is made hidden at start and shown from the menu. A window that the app made later from a menu stayed empty on macOS. Both windows have `backgroundThrottling` `"disabled"`: with the default, the Preferences page stayed empty when the window was behind other windows.
- The two windows share `state.json`. The app writes only the keys that a window changes, and sends each change to the other window (`storage-changed`), so one window does not overwrite the changes of the other.

## Sync data

### Fields

Each task gets one new field:

- `updatedAt`: the time of the last change to this task, in milliseconds. The save step sets it. It compares the new list with the saved list, and each task that is new or different gets the current time. The task functions do not need to know about it. Undo also works: a task that Undo brings back is "new" again, so it gets a new time.

A deleted task leaves a delete marker, so that another device does not bring it back:

- `deleted`: an object `{ taskId: deletedAt }`, saved next to `tasks`.

### Merge rules

`Tasks.merge(local, remote)` gets two copies `{ tasks, deleted }` and gives one copy. Both devices get the same result from the same two copies.

1. For each task ID, the newest change wins: the task with the larger `updatedAt`, or the delete marker when `deletedAt` is the same or larger.
2. Only one task runs. When more than one task runs after the merge, the task with the newest `startedAt` keeps running. The other tasks pause at that `startedAt`, because that is when the user started the newer task on the other device.
3. The list keeps the local order. A task that comes from the other device goes in the place that its `createdAt` gives.
4. A task with no `updatedAt` (saved by version 4.1.0 or older) counts as changed at its `createdAt`.

### Clock differences

`startedAt` and `updatedAt` come from the clock of each device. A difference of a few seconds between clocks changes a running time by those seconds only. If a device clock is wrong by much more, the newest change can lose. The sync step can compare the device clock with the Firestore server time and warn when the difference is more than one minute.

### Firestore layout

```
users/{uid}/tasks/{taskId}    one document per task (the task fields), or { deletedAt } for a deleted task
```

One document per task means a change sends one small document, not the full list. Security rules let a signed-in user read and write only `users/{their uid}/**`.

Delete markers older than 90 days can be removed. A device that was offline for longer than that can bring back a deleted task one time.

## Sign-in

- **Desktop app:** Google does not let its sign-in page run inside an app web view. `desktop/src-tauri/src/google.rs` opens the Google sign-in page in the system browser, with PKCE and a redirect to `http://127.0.0.1:<free port>`, and changes the code for an ID token. This needs a Google OAuth client of the type "Desktop app".
- **Firefox add-on:** `browser.identity.launchWebAuthFlow` opens the Google sign-in page (`src/account.js`) and gets an ID token (`response_type=id_token`). This needs a Google OAuth client of the type "Web application" with this redirect URI: `https://87661a6e9e70747dfc24f6d51140fd1726dfeb61.extensions.allizom.org/`. Firefox makes this address from the SHA-1 hash of the add-on ID (`toolkit/components/extensions/child/ext-identity.js`).
- Both send the ID token to the background (`src/sync-bg.js`), which signs in to Firebase with `signInWithCredential`. Firebase keeps the sign-in in IndexedDB.
- With the emulator in `src/firebase-config.js`, the Preferences page uses a test token that only the Auth emulator takes.
- Firebase takes the ID token of the "Desktop app" client of the same project: no safelist entry is needed. (A real sign-in in the desktop app worked, and its tasks went to Firestore.)
- The add-on sign-in works in Firefox with a real account: "Sign in with Google" asks for the optional data collection (authenticationInfo, personallyIdentifyingInfo), `launchWebAuthFlow` opens Google and closes when Google sends the browser back, and Firebase takes the web client's ID token. A task started in the add-on went to Firestore, a task written to Firestore came into the add-on when the popup opened (the add-on's running task paused), and deletes went to Firestore as delete markers.
- Google does not let a browser under WebDriver control sign in ("This browser or app may not be secure"). A test profile that was signed in to Google without WebDriver keeps the session, and the account chooser then works under WebDriver.
- On the add-on's Google page, the account chooser says "continue to allizom.org" (the domain of the Firefox redirect address), not the app name.
- The global shortcut Option+W shows and hides the window (tested with a real key press). A test tool cannot press a global shortcut: macOS drops key events from a process that has no Accessibility permission.
- Debug builds of the desktop app only: with `SIMPLE_TIMER_AUTH_URL_FILE` set, the app writes the Google sign-in link to that file and opens no browser, so a test can open it in another browser.

## Sync code

| File | What it does |
|---|---|
| `src/sync-core.js` | Documents to copies and back, and which documents to write. No Firebase. Unit tests: `tests/sync-core.test.js`. |
| `src/sync.js` | The sync engine: sign-in, a merge run, the live listener. It gets the Firebase functions from the caller. |
| `src/sync-bg.js` | Runs the engine in the add-on background and in the desktop main window. It answers the messages `sign-in`, `sign-out` and `sync-now`, and keeps `syncStatus` in storage. |
| `src/account.js` | The Sync part of the Preferences page. |
| `src/firebase-config.js` | The Firebase project and the OAuth client IDs. Empty: sync is off. |
| `firebase/` | `firestore.rules`, the bundle step (`npm run bundle` makes `src/lib/firebase.js`) and the emulator tests (`npm test`, needs Java 21). |

- A merge run saves the merged copy with `Store.saveSynced`, not with `Store.saveTasks`. `saveTasks` would give a new `updatedAt` to each task that came from the other device, and two devices would then send the same task back and forth.
- The add-on background is an event page, which Firefox stops when it is not in use. So the add-on syncs when the popup opens (`sync-now`), after each local change, and on an alarm every 5 minutes. The live listener works while the background runs. The desktop main window always runs, so its listener always works.
- The desktop app uses Firestore with `experimentalForceLongPolling`. With the default stream, the live listener in the app's web view (WebKit) got no changes from the emulator; with long polling, a change from another device came in less than a second. The add-on uses the default.
- Data collection: the manifest has `"required": ["none"]` and `"optional": ["authenticationInfo", "personallyIdentifyingInfo"]`, because sync sends the Google account email and the sign-in to Firebase, and only when the user turns it on. "Sign in with Google" first asks for these with `permissions.request({ data_collection })` (Mozilla, "Firefox built-in data consent").
- The Firebase bundle uses `firebase/auth/web-extension`, the Auth build with no remote scripts, because addons.mozilla.org does not accept remote code.

## Firebase project

The project is `simple-task-timer-e196ff` (Spark plan, no cost), with the Firestore database `(default)` in `me-central2` (Dammam). Its values are in `src/firebase-config.js` and `firebase/.firebaserc`. The sign-in screen (Google Auth Platform) is External and "In production", so any Google account can sign in.

The desktop client secret is not in git, because Google turns off client secrets that it finds in public repos. The desktop build (`desktop/copy-web.mjs`) reads it from `desktop/local-secrets.json` (`{"googleDesktopSecret": "..."}`, ignored by git) or from the `GOOGLE_DESKTOP_SECRET` environment variable. A build without it cannot sign in on the desktop. The secret is in the Google Cloud console, Clients, "Simple Task Timer desktop" (Google shows a secret only when it is made; a new one can be added there).

These steps made the project. Use them for a new project:

1. Sign in to the Firebase CLI: `cd firebase && npx firebase login`.
2. Create the project and a web app, then get the web app config: `npx firebase projects:create`, `npx firebase apps:create web`, `npx firebase apps:sdkconfig web`.
3. Create the Firestore database (the location cannot change later) and send the rules: `npx firebase firestore:databases:create "(default)" --location <location>`, `npx firebase deploy --only firestore:rules`.
4. In the Firebase console, Authentication, Sign-in method: turn on Google. This makes the OAuth client "Web client (auto created by Google Service)".
5. In the Google Cloud console, APIs and Services:
   - OAuth consent screen: user type External; add your Google account as a test user (or publish the app).
   - Credentials, the web client: add the redirect URI of the add-on (see "Sign-in").
   - Credentials, Create credentials, OAuth client ID, type "Desktop app": its ID and secret go into `googleDesktopClientId` and `googleDesktopSecret`.
6. Put the web app config into `firebase`, and the web client ID into `googleWebClientId`.

## Things to check before the release

- Does `browser.identity.launchWebAuthFlow` work in Firefox for Android? No: Firefox for Android has no `identity.launchWebAuthFlow` and no `getRedirectURL` (MDN browser compatibility data, `webextensions/api/identity.json`). So Preferences on Android says that sync is not available there. To decide: keep it so, or sign in on Android through a page on Firebase Hosting (the web version has the sign-in code for a normal page).
- The desktop goal notification banner after "Allow". The app sends it (the notify command returns success), and macOS then asks once whether "Simple Task Timer" may send notifications. Until the user clicks Allow, no alert shows. The notification plugin uses `NSUserNotificationCenter` (deprecated since macOS 11).
- The current limits of the Firebase free plan for Authentication and Firestore.
- The addons.mozilla.org listing must say that sync sends task names, times and the Google account email to Firebase. Done in 4.2.0: the listing has a Sync and a Private item, and the add-on has a privacy policy.
- Does the new `identity` permission make Firefox ask existing users before the update?

## Steps

1. **Shared logic:** `updatedAt` stamps, delete markers and `Tasks.merge`, with unit tests. The add-on saves the stamps and markers now, so data saved from this version is ready for sync.
2. **Desktop app:** Tauri app with the popup screen, local storage, menu-bar timer, global shortcut and goal notification. No sync yet.
3. **Firebase project:** Firebase project, Google provider, Firestore with security rules, OAuth clients for the desktop app and the add-on.
4. **Sync in the desktop app:** sign-in, first upload, live listener, merge.
5. **Sync in the add-on:** bundle step, sign-in with `identity`, sync on popup open and on an alarm. Test on Firefox for Android.
6. **Release:** new add-on version (4.2.0) with the privacy text and a privacy policy. The source code goes with the version, because `src/lib/firebase.js` is a minified bundle. The macOS app stays ad-hoc signed: a signed and notarized build needs a paid Apple Developer ID, and it helps only when other people install the app.
7. **Web version for iPhone:** the popup screen as a small web app on Firebase Hosting (`simple-task-timer-e196ff.web.app`), which you add to the iPhone home screen from Safari (Share, Add to Home Screen). It uses a browser version of the shim (`webapp/web-shim.js`: storage in the page, the time in the page title, no global shortcut), the same Firestore sync with long polling (Safari is WebKit, as in the desktop app), a web app manifest, icons, and a service worker that keeps a copy of the files. Google sign-in goes by a full-page redirect with the web client (the add-on flow, with a `state` value that the page checks), so the web client has the Hosting address as a redirect URI. There is no goal alert: the page timers stop when the page is closed, so an alert at a set time would need a push server.
8. **Desktop app icon without the grey border:** in the Dock, the icon sat in a grey frame, unlike the other app icons. The cause: `src/icons/icon.svg` draws its own rounded tile (clear corners, a dark bottom edge), and macOS 26 and later put such icons in a grey frame. The fix: `desktop/icon.svg`, the same picture on a tile that fills the whole square, made into `desktop/src-tauri/icons` with `npx tauri icon`. macOS now gives the icon the standard rounded shape with no frame (checked with the icon that macOS draws for the app). The add-on icons stay as they are.
