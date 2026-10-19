// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Sync part of the Preferences page: sign in with Google, sign out,
// sync now, and the state. The Google ID token comes from:
//   - the desktop app: the app command google_sign_in (system browser)
//   - the add-on: browser.identity.launchWebAuthFlow (a Firefox window)
//   - the web version: the page goes to Google, and Google sends it back to
//     the page with the token in the URL fragment (webSignIn, webReturn)
//   - the emulator in tests: a test token, which only the Auth emulator takes
// Firefox for Android has no launchWebAuthFlow, so sync is not available there.
// The token goes to the background (sync-bg.js), which signs in to Firebase.

(function () {
  'use strict';

  const cfg = globalThis.SYNC_CONFIG || {};
  const $ = id => document.getElementById(id);
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  // Sync sends the Google account email and the sign-in to Firebase. Firefox
  // asks the user for this (optional data collection in the manifest).
  const DATA = ['authenticationInfo', 'personallyIdentifyingInfo'];

  function randomText() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  const WEB_STATE = 'simple-task-timer-sign-in';

  function canSignIn() {
    if (cfg.emulator || window.__TAURI__ || globalThis.SIMPLE_TIMER_WEB) return true;
    return typeof browser.identity?.launchWebAuthFlow === 'function';
  }

  async function googleIdToken() {
    if (cfg.emulator) {
      return JSON.stringify({ sub: 'emulator-user', email: 'test@example.com', email_verified: true });
    }
    if (window.__TAURI__) {
      return window.__TAURI__.core.invoke('google_sign_in', {
        clientId: cfg.googleDesktopClientId, clientSecret: cfg.googleDesktopSecret,
      });
    }
    if (globalThis.SIMPLE_TIMER_WEB) return webSignIn();
    const url = authUrl(browser.identity.getRedirectURL(), {});
    const back = await browser.identity.launchWebAuthFlow({ url, interactive: true });
    return tokenOf(new URLSearchParams(new URL(back).hash.slice(1)));
  }

  function authUrl(redirect, more) {
    return AUTH_URL + '?' + new URLSearchParams({
      client_id: cfg.googleWebClientId,
      response_type: 'id_token',
      redirect_uri: redirect,
      scope: 'openid email',
      nonce: randomText(),
      prompt: 'select_account',
      ...more,
    });
  }

  function tokenOf(params) {
    if (params.get('error')) throw new Error('Google sign-in stopped: ' + params.get('error'));
    const token = params.get('id_token');
    if (!token) throw new Error('Google gave no ID token.');
    return token;
  }

  // The page goes away to Google, so this never ends here
  function webSignIn() {
    const state = randomText();
    localStorage.setItem(WEB_STATE, state);
    location.assign(authUrl(location.origin + location.pathname, { state }));
    return new Promise(() => {});
  }

  // Back from Google: the token is in the URL fragment. The "state" must be
  // the one that this page sent, so that a link from another site cannot
  // sign this page in to another account.
  async function webReturn() {
    if (!/[#&](id_token|error)=/.test(location.hash)) return;
    const params = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const state = localStorage.getItem(WEB_STATE);
    localStorage.removeItem(WEB_STATE);
    if (!state || params.get('state') !== state) throw new Error('This sign-in did not start on this page. Try again.');
    await browser.runtime.sendMessage({ type: 'sign-in', idToken: tokenOf(params) });
  }

  function showSyncError(text) {
    $('sync-error').textContent = text || '';
    $('sync-error').hidden = !text;
  }

  function render(status) {
    const s = status || {};
    const signedIn = !!s.email;
    const can = canSignIn();
    $('sync-signin').hidden = !s.available || !can || signedIn;
    $('sync-now').hidden = !signedIn;
    $('sync-signout').hidden = !signedIn;
    if (!can) {
      $('sync-state').textContent = 'Sync is not available in Firefox for Android: it has no Google sign-in for add-ons. Your tasks stay on this device.';
    } else if (!s.available) {
      $('sync-state').textContent = 'Sync is not set up in this build.';
    } else if (!signedIn) {
      $('sync-state').textContent = 'Not signed in. Your tasks stay on this device.';
    } else {
      const when = s.lastSync ? new Date(s.lastSync).toLocaleTimeString() : 'not yet';
      $('sync-state').textContent = `Signed in as ${s.email}. Last sync: ${when}.`;
    }
    if (s.error) showSyncError('Sync error: ' + s.error);
  }

  // Must run in the click, before any await. The desktop app has no such question.
  function askForData() {
    if (window.__TAURI__ || globalThis.SIMPLE_TIMER_WEB || cfg.emulator) return Promise.resolve(true);
    // A Firefox with no built-in data consent has no data_collection: go on
    return browser.permissions.request({ data_collection: DATA }).catch(() => true);
  }

  async function busy(button, fn) {
    button.disabled = true;
    showSyncError('');
    try {
      await fn();
    } catch (e) {
      showSyncError(String(e && e.message || e));
    } finally {
      button.disabled = false;
    }
  }

  async function init() {
    const r = await browser.storage.local.get({ syncStatus: null });
    render(r.syncStatus || { available: !!cfg.firebase });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.syncStatus) render(changes.syncStatus.newValue);
    });
    $('sync-signin').addEventListener('click', () => {
      const asked = askForData();
      busy($('sync-signin'), async () => {
        if (!(await asked)) throw new Error('Sync needs your OK to send your Google account email to Firebase.');
        const idToken = await googleIdToken();
        await browser.runtime.sendMessage({ type: 'sign-in', idToken });
      });
    });
    $('sync-now').addEventListener('click', () => busy($('sync-now'), () => browser.runtime.sendMessage({ type: 'sync-now' })));
    $('sync-signout').addEventListener('click', () => busy($('sync-signout'), () => browser.runtime.sendMessage({ type: 'sign-out' })));
    if (globalThis.SIMPLE_TIMER_WEB) busy($('sync-signin'), webReturn);
  }

  init();
})();
