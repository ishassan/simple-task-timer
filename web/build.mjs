// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Makes firebase/hosting, the web version for the iPhone (and other
// browsers), from the add-on files in src. Firebase Hosting serves that
// folder (see firebase/firebase.json).
//   index.html  popup.html with more scripts: web-shim.js (before the add-on
//               scripts) gives them the "browser" API; background.js and the
//               sync scripts run in the same page. The gear button opens
//               Settings in the same page: the Sync part of the Preferences
//               page. It stays in this page, because Google sign-in comes
//               back to this address, and sync runs in this page.
// SYNC_EMULATOR=1 makes a test build that syncs with the Firebase emulators.

import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const src = new URL('../app/', here);
const out = new URL('../firebase/hosting/', here);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

for (const name of ['tasks.js', 'keys.js', 'store.js', 'background.js', 'popup.js', 'popup.css',
  'sync-core.js', 'sync.js', 'sync-bg.js', 'firebase-config.js', 'account.js']) {
  copyFileSync(new URL(name, src), new URL(name, out));
}
try {
  cpSync(new URL('lib/', src), new URL('lib/', out), { recursive: true });
} catch (e) {
  throw new Error('app/lib/firebase.js is missing: run "npm run bundle" in firebase/ first');
}
for (const name of ['web-shim.js', 'web.css', 'sw.js', 'manifest.webmanifest']) {
  copyFileSync(new URL(name, here), new URL(name, out));
}
cpSync(new URL('icons/', here), new URL('icons/', out), { recursive: true });

function insert(text, anchor, value) {
  if (!text.includes(anchor)) throw new Error(`No "${anchor}" to replace`);
  return text.replace(anchor, value);
}

const options = readFileSync(new URL('options.html', src), 'utf8');
const sync = options.match(/  <section id="sync-section">[\s\S]*?<\/section>\n/);
if (!sync) throw new Error('No sync section in options.html');

let html = readFileSync(new URL('popup.html', src), 'utf8');
html = insert(html, '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '  <meta name="apple-mobile-web-app-capable" content="yes">\n' +
  '  <meta name="apple-mobile-web-app-title" content="Task Timer">\n' +
  '  <meta name="theme-color" content="#534AB7">\n' +
  '  <link rel="manifest" href="manifest.webmanifest">\n' +
  '  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n' +
  '  <link rel="icon" href="icons/icon-192.png">');
html = insert(html, '<link rel="stylesheet" href="popup.css">',
  '<link rel="stylesheet" href="popup.css">\n  <link rel="stylesheet" href="web.css">');
html = insert(html, '  <template id="row-template">',
  '  <div id="settings" hidden>\n' +
  '    <div class="settings-bar"><h1>Settings</h1><button type="button" id="close-settings">Done</button></div>\n' +
  sync[0].replace(
    /<p class="hint">.*<\/p>/,
    '<p class="hint">Sign in with the same Google account here, in the Firefox add-on and in the desktop app, and they show the same tasks and times. The task names and times are then kept in Google Firebase for your account.</p>') +
  '  </div>\n  <template id="row-template">');
html = insert(html, '<script src="tasks.js"></script>',
  '<script src="web-shim.js"></script>\n  <script src="tasks.js"></script>');
html = insert(html, '<script src="popup.js"></script>',
  ['background.js', 'lib/firebase.js', 'sync-core.js', 'firebase-config.js', 'sync.js', 'sync-bg.js', 'popup.js', 'account.js']
    .map(f => `<script src="${f}"></script>`).join('\n  '));
writeFileSync(new URL('index.html', out), html);

if (process.env.SYNC_EMULATOR === '1') {
  writeFileSync(new URL('firebase-config.js', out), `globalThis.SYNC_CONFIG = ${JSON.stringify({
    firebase: { apiKey: 'demo-key', projectId: 'demo-simple-task-timer', authDomain: 'demo-simple-task-timer.firebaseapp.com' },
    googleWebClientId: '', googleDesktopClientId: '', googleDesktopSecret: '',
    emulator: { auth: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8085 },
  })};\n`);
  console.log('firebase/hosting uses the Firebase emulators');
}
console.log('firebase/hosting is ready');
