# Web version

The task list as a web page, for the iPhone and other browsers: [simple-task-timer-e196ff.web.app](https://simple-task-timer-e196ff.web.app). On the iPhone, open it in Safari, then Share, Add to Home Screen.

- It has the same task list, buttons and goals. The gear button opens Settings, with the Sync part of Preferences, in place of the task list. Settings stays in the same page, because Google sign-in comes back to this address and sync runs in this page.
- Sign in with Google to sync: the page goes to Google and comes back signed in.
- The tasks are kept in the browser's page storage. A copy of the page files lets it open with no network.
- There is no goal alert: a web page cannot show an alert at a set time when it is closed. The page title shows the time of the running task.

## How it works

`build.mjs` copies the files of [`app/`](../app) into `firebase/hosting/` and adds `web-shim.js`, which gives the app code the Firefox `browser` calls it uses, in a normal web page. The Google sign-in client (`googleWebClientId`) must have `https://simple-task-timer-e196ff.web.app/` as an authorized redirect URI.

The add-on in Firefox for Android signs in through this page: when the `state` from Google is `ext.<add-on ID>.<value>`, the page does not sign in, and sends the token on to the add-on Preferences page (see [`firefox/`](../firefox)).

## Build and deploy

Needs the Firebase bundle (see the [main README](../README.md)) and `firebase login`:

```bash
cd firebase && npm run deploy-web
```

Or deploy from GitHub, with no computer: open Actions, "Web deploy" (`.github/workflows/web-deploy.yml`), Run workflow. The workflow uses no key and no secret. It signs in with Workload Identity Federation: GitHub gives the run a short-lived token, and Google lets runs from this repository act as the service account `github-web-deploy`. This setup is in the Google Cloud project `simple-task-timer-e196ff`:

- The service account `github-web-deploy`, with the roles Firebase Hosting Admin, API Keys Viewer and Service Usage Consumer. It has no keys. Without Service Usage Consumer, the deploy fails with "Permission denied to get service [firebasehosting.googleapis.com]", because the Firebase CLI first checks that the Hosting API is on.
- The workload identity pool `github`, with the OIDC provider `simple-task-timer`. The provider accepts tokens from `https://token.actions.githubusercontent.com` only when `assertion.repository` is `ishassan/simple-task-timer`.
- On the service account, the role Workload Identity User for `principalSet://iam.googleapis.com/projects/427469644050/locations/global/workloadIdentityPools/github/attribute.repository/ishassan/simple-task-timer`.
- The APIs IAM Service Account Credentials and Security Token Service are on.

## Test

In headless WebKit, the engine of Safari (needs Java 21 or newer, `pip install playwright` and `playwright install webkit`):

```bash
cd firebase && npx firebase emulators:exec --project demo-simple-task-timer --only auth,firestore "python3 ../web/test.py"
```

Two iPhone-sized pages sign in to the Firebase emulators as two devices, and a task started on one shows on the other at once.
