# Web version

The task list as a web page, for the iPhone and other browsers: [simple-task-timer-e196ff.web.app](https://simple-task-timer-e196ff.web.app). On the iPhone, open it in Safari, then Share, Add to Home Screen.

- It has the same task list, buttons and goals, and the Sync part of Preferences at the bottom.
- Sign in with Google to sync: the page goes to Google and comes back signed in.
- The tasks are kept in the browser's page storage. A copy of the page files lets it open with no network.
- There is no goal alert: a web page cannot show an alert at a set time when it is closed. The page title shows the time of the running task.

## How it works

`build.mjs` copies the files of [`app/`](../app) into `firebase/hosting/` and adds `web-shim.js`, which gives the app code the Firefox `browser` calls it uses, in a normal web page. The Google sign-in client (`googleWebClientId`) must have `https://simple-task-timer-e196ff.web.app/` as an authorized redirect URI.

## Build and deploy

Needs the Firebase bundle (see the [main README](../README.md)) and `firebase login`:

```bash
cd firebase && npm run deploy-web
```

## Test

In headless WebKit, the engine of Safari (needs Java 21 or newer, `pip install playwright` and `playwright install webkit`):

```bash
cd firebase && npx firebase emulators:exec --project demo-simple-task-timer --only auth,firestore "python3 ../web/test.py"
```

Two iPhone-sized pages sign in to the Firebase emulators as two devices, and a task started on one shows on the other at once.
