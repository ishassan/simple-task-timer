// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Sync in the background: the add-on background script, or the main window
// of the desktop app. Other pages talk to it with runtime messages:
//   {type: 'sign-in', idToken}  signs in to Firebase with a Google ID token
//   {type: 'sign-out'}
//   {type: 'sync-now'}          the popup sends this when it opens
// It keeps the state in storage.local "syncStatus": {email, lastSync, error},
// so that each page can show it and gets storage.onChanged.
// When signed in, it merges at once, on each local change, on each change in
// the database (while this page runs), and every 5 minutes.

(function () {
  'use strict';

  const cfg = globalThis.SYNC_CONFIG;
  const available = !!(cfg && cfg.firebase && typeof FirebaseLib !== 'undefined');

  function setStatus(status) {
    return browser.storage.local.set({ syncStatus: { available, email: null, lastSync: null, error: null, ...status } });
  }

  if (!available) {
    setStatus({});
    browser.runtime.onMessage.addListener(m => {
      if (m && m.type === 'sign-in') return Promise.reject(new Error('Sync is not set up in this build.'));
      return undefined;
    });
    return;
  }

  const engine = Sync.create({
    lib: FirebaseLib, config: cfg.firebase, store: Store, emulator: cfg.emulator,
    // In the desktop app (WebKit), the live listener got no changes over the
    // default stream; long polling works there. The web version uses it too,
    // because Safari on the iPhone is WebKit.
    firestoreSettings: window.__TAURI__ || globalThis.SIMPLE_TIMER_WEB ? { experimentalForceLongPolling: true } : {},
    log: m => { if (/error/.test(m)) console.error(m); },
  });

  let email = null;

  async function syncNow() {
    if (!engine.user()) return;
    try {
      await engine.syncNow();
      await setStatus({ email, lastSync: Date.now() });
    } catch (e) {
      await setStatus({ email, error: String(e && e.message || e) });
    }
  }

  engine.onUser(user => {
    email = user ? user.email : null;
    if (user) {
      syncNow().then(() => engine.listen());
      browser.alarms.create('sync', { periodInMinutes: 5 });
    } else {
      engine.stop();
      browser.alarms.clear('sync');
      setStatus({});
    }
  });

  // A local change: send it (the merge of a sync also comes here, and then
  // there is nothing to write)
  let pushTimer = null;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.tasks || changes.deleted) || !engine.user()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => engine.pushLocal(), 300);
  });

  browser.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'sync') syncNow();
  });

  browser.runtime.onMessage.addListener(m => {
    if (!m || typeof m !== 'object') return undefined;
    if (m.type === 'sign-in') {
      return engine.signInWithGoogleIdToken(m.idToken).then(r => ({ email: r.user.email }));
    }
    if (m.type === 'sign-out') return engine.signOut().then(() => ({}));
    if (m.type === 'sync-now') return syncNow().then(() => ({}));
    return undefined;
  });
})();
