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
| iPhone | Not in this plan | Firefox for iOS cannot run add-ons. A web version (a page you add to the home screen) can use the same sync later. |

## Parts

```
src/tasks.js      Task rules, sync stamps and merge (no browser calls)
src/store.js      Add-on storage (browser.storage.local)
src/popup.*       The screen (the add-on popup, and later the desktop window)
src/background.js Add-on badge, alarms and notification
src/sync.js       (new) Firebase sign-in and Firestore sync, used by the add-on and the desktop app
desktop/          (new) The Tauri app: window, menu-bar timer, global shortcut, notification
docs/             Plans and decisions
```

Each platform gives the screen the same small set of functions:

| Function | Firefox add-on | Desktop app (Tauri) |
|---|---|---|
| Save and read tasks | `browser.storage.local` | Tauri store plugin (a JSON file in the app data folder) |
| Running time outside the window | Toolbar badge | Menu-bar (tray) title, for example "25m" |
| Goal alarm | `browser.alarms` and `browser.notifications` | A timer in the app and the notification plugin |
| Open shortcut | `commands` in the manifest (Alt+W) | Global shortcut plugin |
| Sign-in | `browser.identity.launchWebAuthFlow` | The system browser, with a redirect to a local port |

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

- **Desktop app:** Google does not let its sign-in page run inside an app web view. The app opens the Google sign-in page in the system browser, with PKCE and a redirect to `http://127.0.0.1:<port>`. The app reads the ID token and signs in to Firebase with `signInWithCredential`. This needs a Google OAuth client of the type "Desktop app".
- **Firefox add-on:** `browser.identity.launchWebAuthFlow` opens the Google sign-in page. The redirect URL is `browser.identity.getRedirectURL()`. The add-on then signs in to Firebase with the same `signInWithCredential` call. The add-on needs the `identity` permission.

## Things to check before the build

- Does `browser.identity.launchWebAuthFlow` work in Firefox for Android? If it does not, Android needs another sign-in path.
- The add-on background is an event page: Firefox stops it when it is not in use. A live Firestore listener stops with it. Plan: sync when the popup opens, listen while the popup is open, and sync on an alarm every few minutes.
- The Firebase SDK must be in the add-on package (add-ons cannot load remote code). This adds a bundle step (esbuild) and a source upload to addons.mozilla.org.
- The current limits of the Firebase free plan for Authentication and Firestore.
- Privacy: the add-on manifest now says it collects no data. With sync, it sends task names and times to Firebase. The manifest `data_collection_permissions` and the addons.mozilla.org listing must say this. Sync stays off until the user signs in.

## Steps

1. **Shared logic:** `updatedAt` stamps, delete markers and `Tasks.merge`, with unit tests. The add-on saves the stamps and markers now, so data saved from this version is ready for sync.
2. **Desktop app:** Tauri app with the popup screen, local storage, menu-bar timer, global shortcut and goal notification. No sync yet.
3. **Firebase project:** Firebase project, Google provider, Firestore with security rules, OAuth clients for the desktop app and the add-on.
4. **Sync in the desktop app:** sign-in, first upload, live listener, merge.
5. **Sync in the add-on:** bundle step, sign-in with `identity`, sync on popup open and on an alarm. Test on Firefox for Android.
6. **Release:** signed macOS build, new add-on version with the privacy text.
