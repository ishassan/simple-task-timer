// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Sync part of the Preferences page: sign in with Google, sign out,
// sync now, and the state. The Google ID token comes from:
//   - the desktop app: the app command google_sign_in (system browser)
//   - the add-on: browser.identity.launchWebAuthFlow (a Firefox window)
//   - the emulator in tests: a test token, which only the Auth emulator takes
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

  async function googleIdToken() {
    if (cfg.emulator) {
      return JSON.stringify({ sub: 'emulator-user', email: 'test@example.com', email_verified: true });
    }
    if (window.__TAURI__) {
      return window.__TAURI__.core.invoke('google_sign_in', {
        clientId: cfg.googleDesktopClientId, clientSecret: cfg.googleDesktopSecret,
      });
    }
    const redirect = browser.identity.getRedirectURL();
    const nonce = randomText();
    const url = AUTH_URL + '?' + new URLSearchParams({
      client_id: cfg.googleWebClientId,
      response_type: 'id_token',
      redirect_uri: redirect,
      scope: 'openid email',
      nonce,
      prompt: 'select_account',
    });
    const back = await browser.identity.launchWebAuthFlow({ url, interactive: true });
    const params = new URLSearchParams(new URL(back).hash.slice(1));
    if (params.get('error')) throw new Error('Google sign-in stopped: ' + params.get('error'));
    const token = params.get('id_token');
    if (!token) throw new Error('Google gave no ID token.');
    return token;
  }

  function showSyncError(text) {
    $('sync-error').textContent = text || '';
    $('sync-error').hidden = !text;
  }

  function render(status) {
    const s = status || {};
    const signedIn = !!s.email;
    $('sync-signin').hidden = !s.available || signedIn;
    $('sync-now').hidden = !signedIn;
    $('sync-signout').hidden = !signedIn;
    if (!s.available) {
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
    if (window.__TAURI__ || cfg.emulator) return Promise.resolve(true);
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
  }

  init();
})();
