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
//   googleDesktopSecret    and its secret, which Google says is not secret
//   emulator               only for tests: the Auth and Firestore emulators

globalThis.SYNC_CONFIG = {
  firebase: null,
  googleWebClientId: '',
  googleDesktopClientId: '',
  googleDesktopSecret: '',
  emulator: null,
};
