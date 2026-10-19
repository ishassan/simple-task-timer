// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Makes firefox/build, the Firefox add-on: the app files from app/ and the
// add-on manifest. web-ext builds and runs the add-on from that folder.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const app = new URL('../app/', here);
const out = new URL('build/', here);

if (!existsSync(new URL('lib/firebase.js', app))) {
  throw new Error('app/lib/firebase.js is missing: run "npm run bundle" in firebase/ first');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of readdirSync(app)) {
  cpSync(new URL(name, app), new URL(name, out), { recursive: true });
}
// The add-on does not use the script that makes the PNG icons
rmSync(new URL('icons/render.sh', out), { force: true });
copyFileSync(new URL('manifest.json', here), new URL('manifest.json', out));
console.log('firefox/build is ready');
