// Unit tests for app/account.js (the Sync part of Preferences). Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.join(__dirname, '../app/account.js'), 'utf8');

// Runs account.js on a fake page and gives back its elements.
async function page(browserApi, web) {
  const els = {};
  for (const id of ['sync-state', 'sync-signin', 'sync-now', 'sync-signout', 'sync-error']) {
    els[id] = { hidden: true, textContent: '', disabled: false, addEventListener() {} };
  }
  const browser = Object.assign({
    storage: {
      local: { get: async d => d },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: async () => {} },
    permissions: { request: async () => true },
  }, browserApi);
  const window = {};
  const ctx = {
    window, browser, crypto: globalThis.crypto, URL, URLSearchParams,
    document: { getElementById: id => els[id] },
    SYNC_CONFIG: { firebase: { projectId: 'p' } },
  };
  if (web) {
    const saved = new Map(Object.entries(web.saved || {}));
    ctx.SIMPLE_TIMER_WEB = true;
    ctx.location = { origin: 'https://app.test', pathname: '/', search: '', hash: web.hash || '' };
    ctx.history = { replaceState: (a, b, url) => { ctx.location.hash = ''; els.url = url; } };
    ctx.localStorage = {
      getItem: k => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, v),
      removeItem: k => saved.delete(k),
    };
  }
  ctx.globalThis = ctx;
  vm.runInNewContext(CODE, ctx);
  await new Promise(r => setTimeout(r, 0));
  return els;
}

function recorder() {
  const sent = [];
  return { sent, runtime: { sendMessage: async m => { sent.push(JSON.parse(JSON.stringify(m))); } } };
}

test('Firefox with the identity API shows the sign-in button', async () => {
  const els = await page({ identity: { getRedirectURL() {}, launchWebAuthFlow() {} } });
  assert.equal(els['sync-signin'].hidden, false);
  assert.match(els['sync-state'].textContent, /Not signed in/);
});

test('a browser with no identity API (Firefox for Android) says sync is not available', async () => {
  const els = await page({});
  assert.equal(els['sync-signin'].hidden, true);
  assert.match(els['sync-state'].textContent, /not available in Firefox for Android/);
});

test('web version: back from Google with the right state, the page signs in', async () => {
  const r = recorder();
  const els = await page({ runtime: r.runtime }, {
    hash: '#state=abc&id_token=TOKEN', saved: { 'simple-task-timer-sign-in': 'abc' },
  });
  assert.deepEqual(r.sent, [{ type: 'sign-in', idToken: 'TOKEN' }]);
  assert.equal(els.url, '/');  // the token leaves the address bar
  assert.equal(els['sync-error'].hidden, true);
});

test('web version: a token from a link that this page did not start is not used', async () => {
  const r = recorder();
  const els = await page({ runtime: r.runtime }, { hash: '#state=other&id_token=TOKEN', saved: {} });
  assert.deepEqual(r.sent, []);
  assert.equal(els['sync-error'].hidden, false);
  assert.match(els['sync-error'].textContent, /did not start on this page/);
});
