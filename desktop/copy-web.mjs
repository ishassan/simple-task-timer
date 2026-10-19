// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Makes desktop/web, the pages of the desktop app, from the add-on files in
// src. Tauri runs this script before each build (see src-tauri/tauri.conf.json).
//   index.html    popup.html with two more scripts: browser-shim.js (before
//                 the add-on scripts) gives them the "browser" API, and
//                 background.js runs the badge and the goal alarm in the same page
//   options.html  the Preferences page with browser-shim.js, the texts for a
//                 shortcut that works in all apps, and a "Turn off" button

import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const src = new URL('../src/', here);
const out = new URL('web/', here);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

for (const name of ['tasks.js', 'keys.js', 'store.js', 'background.js', 'popup.js', 'popup.css', 'options.css']) {
  copyFileSync(new URL(name, src), new URL(name, out));
}
cpSync(new URL('icons/', src), new URL('icons/', out), { recursive: true });
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
  '<script src="background.js"></script>\n  <script src="popup.js"></script>');
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
console.log('desktop/web is ready');
