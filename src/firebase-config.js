// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Firebase project and the Google sign-in clients for sync (see
// docs/desktop-and-sync-plan.md, "Firebase project"). These values are not
// secrets: the Firestore rules protect the data. With "firebase" null,
// sync is off and Preferences says so.
//   firebase               the web app config from the Firebase console
//   googleWebClientId      OAuth client "Web application" (the add-on)
//   googleDesktopClientId  OAuth client "Desktop app" (the desktop app),
//   googleDesktopSecret    and its secret. It is not in git: Google turns off
//                          client secrets that it finds in public repos. The
//                          desktop build reads it from desktop/local-secrets.json.
//   emulator               only for tests: the Auth and Firestore emulators

globalThis.SYNC_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyCDVSSkri9HpE4JaYCQSgyW5ezNWCZOJoI',
    authDomain: 'simple-task-timer-e196ff.firebaseapp.com',
    projectId: 'simple-task-timer-e196ff',
    appId: '1:427469644050:web:7a93e7dbe79d94d57093cb',
  },
  googleWebClientId: '427469644050-oluiaha6cgnaace7au5p5ptucto9fka3.apps.googleusercontent.com',
  googleDesktopClientId: '427469644050-bnjvsb0khbobq9vcbeqcl8kmptive59k.apps.googleusercontent.com',
  googleDesktopSecret: '',  // the desktop build adds it from desktop/local-secrets.json
  emulator: null,
};
