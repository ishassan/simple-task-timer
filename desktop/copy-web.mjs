// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Makes desktop/web, the pages of the desktop app, from the add-on files in
// src. Tauri runs this script before each build (see src-tauri/tauri.conf.json).
//   index.html    popup.html with more scripts: browser-shim.js (before the
//                 add-on scripts) gives them the "browser" API; background.js
//                 (the badge and the goal alarm) and the sync scripts run in
//                 the same page, as the add-on background script does
//   options.html  the Preferences page with browser-shim.js, the texts for a
//                 shortcut that works in all apps, and a "Turn off" button

import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const src = new URL('../src/', here);
const out = new URL('web/', here);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

for (const name of ['tasks.js', 'keys.js', 'store.js', 'background.js', 'popup.js', 'popup.css', 'options.css',
  'sync-core.js', 'sync.js', 'sync-bg.js', 'firebase-config.js', 'account.js']) {
  copyFileSync(new URL(name, src), new URL(name, out));
}
cpSync(new URL('icons/', src), new URL('icons/', out), { recursive: true });
try {
  cpSync(new URL('lib/', src), new URL('lib/', out), { recursive: true });
} catch (e) {
  throw new Error('src/lib/firebase.js is missing: run "npm run bundle" in firebase/ first');
}
for (const name of ['browser-shim.js', 'desktop.css', 'prefs-desktop.js']) {
  copyFileSync(new URL('shim/' + name, here), new URL(name, out));
}

function insert(text, anchor, value) {
  if (!text.includes(anchor)) throw new Error(`No "${anchor}" to replace`);
  return text.replace(anchor, value);
}

let html = readFileSync(new URL('popup.html', src), 'utf8');
html = insert(html, '<link rel="stylesheet" href="popup.css">',
  '<link rel="stylesheet" href="popup.css">\n  <link rel="stylesheet" href="desktop.css">');
html = insert(html, '<script src="tasks.js"></script>',
  '<script src="browser-shim.js"></script>\n  <script src="tasks.js"></script>');
html = insert(html, '<script src="popup.js"></script>',
  ['background.js', 'lib/firebase.js', 'sync-core.js', 'firebase-config.js', 'sync.js', 'sync-bg.js', 'popup.js']
    .map(f => `<script src="${f}"></script>`).join('\n  '));
writeFileSync(new URL('index.html', out), html);

let prefs = readFileSync(new URL('options.html', src), 'utf8');
prefs = insert(prefs, '<button type="button" class="link" id="open-reset">Reset</button>',
  '<button type="button" class="link" id="open-reset">Reset</button>\n      <button type="button" class="link" id="open-off">Turn off</button>');
prefs = insert(prefs, 'This shortcut works in any Firefox window.',
  'This shortcut shows or hides Simple Task Timer from any app. While Simple Task Timer runs, other apps do not get this key, so choose a key that they do not use, or turn it off.');
prefs = insert(prefs, '<h2>Keys in the popup</h2>', '<h2>Keys in the window</h2>');
prefs = insert(prefs, '<script src="keys.js"></script>',
  '<script src="browser-shim.js"></script>\n  <script src="keys.js"></script>');
prefs = insert(prefs, '<script src="options.js"></script>',
  '<script src="options.js"></script>\n  <script src="prefs-desktop.js"></script>');
writeFileSync(new URL('options.html', out), prefs);

let options = readFileSync(new URL('options.js', src), 'utf8');
options = insert(options, "'Firefox did not accept this shortcut: '", "'This shortcut cannot be used: '");
writeFileSync(new URL('options.js', out), options);
// For tests only: SYNC_EMULATOR=1 makes a build that syncs with the Firebase
// emulators (firebase/firebase.json) and signs in with a test token
if (process.env.SYNC_EMULATOR === '1') {
  writeFileSync(new URL('firebase-config.js', out), `globalThis.SYNC_CONFIG = ${JSON.stringify({
    firebase: { apiKey: 'demo-key', projectId: 'demo-simple-task-timer', authDomain: 'demo-simple-task-timer.firebaseapp.com' },
    googleWebClientId: '', googleDesktopClientId: '', googleDesktopSecret: '',
    emulator: { auth: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8085 },
  })};\n`);
  console.log('desktop/web uses the Firebase emulators');
}
console.log('desktop/web is ready');
