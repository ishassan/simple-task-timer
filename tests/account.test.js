// Unit tests for app/account.js (the Sync part of Preferences). Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.join(__dirname, '../app/account.js'), 'utf8');

const UUID = '11111111-2222-3333-4444-555555555555';
const WEB_APP = 'https://app.test/';

// Runs account.js on a fake page and gives back its elements.
//   web:   the web version, with web.hash and web.saved (localStorage)
//   addon: the add-on, with addon.hash and addon.stored (storage.local)
async function page(browserApi, web, addon) {
  const els = {};
  for (const id of ['sync-state', 'sync-signin', 'sync-now', 'sync-signout', 'sync-error']) {
    const el = { hidden: true, textContent: '', disabled: false, listeners: {} };
    el.addEventListener = (type, fn) => { el.listeners[type] = fn; };
    el.click = () => el.listeners.click();
    els[id] = el;
  }
  const stored = new Map(Object.entries((addon && addon.stored) || {}));
  const browser = Object.assign({
    storage: {
      local: {
        get: async d => {
          const out = {};
          for (const [k, v] of Object.entries(d)) out[k] = stored.has(k) ? stored.get(k) : v;
          return out;
        },
        set: async o => { for (const [k, v] of Object.entries(o)) stored.set(k, JSON.parse(JSON.stringify(v))); },
        remove: async k => { stored.delete(k); },
      },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: async () => {} },
    permissions: { request: async () => true },
  }, browserApi);
  browser.runtime.getURL = p => `moz-extension://${UUID}/${p.replace(/^\//, '')}`;
  const window = {};
  const ctx = {
    window, browser, crypto: globalThis.crypto, URL, URLSearchParams, setTimeout,
    document: { getElementById: id => els[id] },
    SYNC_CONFIG: { firebase: { projectId: 'p' }, googleWebClientId: 'client', webAppUrl: WEB_APP },
  };
  const loc = web
    ? { origin: 'https://app.test', pathname: '/', search: '', hash: web.hash || '' }
    : { origin: `moz-extension://${UUID}`, pathname: '/options.html', search: '', hash: (addon && addon.hash) || '' };
  loc.assign = url => { els.went = url; };
  loc.replace = url => { els.went = url; };
  ctx.location = loc;
  ctx.history = { replaceState: (a, b, url) => { loc.hash = ''; els.url = url; } };
  if (web) {
    const saved = new Map(Object.entries(web.saved || {}));
    ctx.SIMPLE_TIMER_WEB = true;
    ctx.localStorage = {
      getItem: k => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, v),
      removeItem: k => saved.delete(k),
    };
  }
  ctx.globalThis = ctx;
  vm.runInNewContext(CODE, ctx);
  await new Promise(r => setTimeout(r, 0));
  els.stored = stored;
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

test('Firefox for Android (no identity API) shows the sign-in button', async () => {
  const els = await page({});
  assert.equal(els['sync-signin'].hidden, false);
  assert.match(els['sync-state'].textContent, /Not signed in/);
});

test('Firefox for Android: sign-in goes to Google, which sends the token to the web version', async () => {
  const els = await page({});
  els['sync-signin'].click();
  await new Promise(r => setTimeout(r, 0));
  const url = new URL(els.went);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('redirect_uri'), WEB_APP);
  assert.equal(url.searchParams.get('client_id'), 'client');
  const saved = els.stored.get('signInHandOff');
  assert.match(saved.state, /^[0-9a-f]{32}$/);
  assert.equal(url.searchParams.get('state'), `ext.${UUID}.${saved.state}`);
});

test('web version: a sign-in for the add-on goes on to the add-on Preferences page', async () => {
  const r = recorder();
  const state = `ext.${UUID}.${'a'.repeat(32)}`;
  const els = await page({ runtime: r.runtime }, { hash: `#state=${state}&id_token=TOKEN`, saved: {} });
  assert.deepEqual(r.sent, []);  // the web version does not sign in with it
  const to = new URL(els.went);
  assert.equal(to.protocol + to.host + to.pathname, `moz-extension:${UUID}/options.html`);
  const params = new URLSearchParams(to.hash.slice(1));
  assert.equal(params.get('state'), state);
  assert.equal(params.get('id_token'), 'TOKEN');
});

test('web version: a sign-in state that is not an add-on ID goes nowhere', async () => {
  const r = recorder();
  const els = await page({ runtime: r.runtime }, { hash: '#state=ext.evil.example/x.aa&id_token=TOKEN', saved: {} });
  assert.equal(els.went, undefined);
  assert.deepEqual(r.sent, []);
  assert.equal(els['sync-error'].hidden, false);
});

test('add-on: back from the web version with the right state, Preferences signs in', async () => {
  const r = recorder();
  const s = 'b'.repeat(32);
  const els = await page({ runtime: r.runtime }, null, {
    hash: `#state=ext.${UUID}.${s}&id_token=TOKEN`,
    stored: { signInHandOff: { state: s, at: Date.now() } },
  });
  assert.deepEqual(r.sent, [{ type: 'sign-in', idToken: 'TOKEN' }]);
  assert.equal(els.url, '/options.html');  // the token leaves the address bar
  assert.equal(els.stored.has('signInHandOff'), false);  // the state is used once
  assert.equal(els['sync-error'].hidden, true);
});

test('add-on: a token that this add-on did not ask for is not used', async () => {
  const r = recorder();
  const els = await page({ runtime: r.runtime }, null, {
    hash: `#state=ext.${UUID}.${'c'.repeat(32)}&id_token=TOKEN`,
    stored: { signInHandOff: { state: 'd'.repeat(32), at: Date.now() } },
  });
  assert.deepEqual(r.sent, []);
  assert.match(els['sync-error'].textContent, /did not start here/);
});

test('add-on: a sign-in older than 30 minutes is not used', async () => {
  const r = recorder();
  const s = 'e'.repeat(32);
  const els = await page({ runtime: r.runtime }, null, {
    hash: `#state=ext.${UUID}.${s}&id_token=TOKEN`,
    stored: { signInHandOff: { state: s, at: Date.now() - 31 * 60 * 1000 } },
  });
  assert.deepEqual(r.sent, []);
  assert.equal(els['sync-error'].hidden, false);
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
