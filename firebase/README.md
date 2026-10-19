# Firebase

Sync for all versions: the Firebase project `simple-task-timer-e196ff` (Spark plan). The app's Firebase values are in [`app/firebase-config.js`](../app/firebase-config.js); with no values there, sync is off.

- `firestore.rules`: each account reads and writes only `users/{its id}/tasks`, with fixed fields and size limits.
- `bundle-entry.js`: the Firebase functions that `app/sync.js` uses. `npm run bundle` makes `app/lib/firebase.js` from it.
- `hosting/`: the web version that `npm run web` makes (see [`web/`](../web)).

The design of the sync, and the steps that made the project, are in [`docs/desktop-and-sync-plan.md`](../docs/desktop-and-sync-plan.md).

## Commands

```bash
npm install && npm run bundle
```

Firestore rules and sync tests, with the Firebase emulators (need Java 21 or newer):

```bash
npm test
```

They check that each account can read and write only its own tasks, and they run two devices of one account and a device of another account.

```bash
npm run deploy-rules
```
