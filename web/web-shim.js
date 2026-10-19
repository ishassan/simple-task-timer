// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Web version: gives the add-on scripts the part of the Firefox "browser" API
// that they use, in a normal web page. The popup, the background and sync
// run in this one page.
//   storage.local    one JSON value in localStorage. A change in another tab
//                    comes in with the "storage" event.
//   action badge     the page title
//   alarms           timers in this page (they run only while the page is open)
//   notifications    none: a web page cannot show an alert at a set time when
//                    it is closed, so the page says "no permission"
//   runtime messages the listeners in this page
//   commands         none (no shortcut that opens the page)
//   identity         Google sign-in with a full-page redirect (see account.js)
// window.close() does nothing.

(function () {
  'use strict';

  const KEY = 'simple-task-timer';
  const TITLE = document.title;
  const os = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios'
    : /Android/.test(navigator.userAgent) ? 'android'
      : /Mac/.test(navigator.userAgent) ? 'mac' : /Win/.test(navigator.userAgent) ? 'win' : 'linux';

  globalThis.SIMPLE_TIMER_WEB = true;

  function makeEvent() {
    const fns = [];
    return {
      addListener: fn => { fns.push(fn); },
      removeListener: fn => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); },
      hasListener: fn => fns.includes(fn),
      fire: (...args) => { for (const fn of [...fns]) fn(...args); },
    };
  }

  const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  // ---- storage.local ----

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  let data = read();
  const firstRun = localStorage.getItem(KEY) == null;
  const storageChanged = makeEvent();

  async function get(keys) {
    if (keys == null) return copy(data);
    if (typeof keys === 'string') keys = [keys];
    const out = {};
    if (Array.isArray(keys)) {
      for (const k of keys) if (k in data) out[k] = copy(data[k]);
    } else {
      for (const [k, fallback] of Object.entries(keys)) out[k] = k in data ? copy(data[k]) : fallback;
    }
    return out;
  }

  async function set(items) {
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: copy(data[k]), newValue: copy(v) };
      data[k] = copy(v);
    }
    localStorage.setItem(KEY, JSON.stringify(data));
    setTimeout(() => storageChanged.fire(changes, 'local'));
  }

  // Another tab saved: tell the listeners in this page what changed
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const next = read();
    const changes = {};
    for (const k of new Set([...Object.keys(data), ...Object.keys(next)])) {
      if (JSON.stringify(data[k]) !== JSON.stringify(next[k])) changes[k] = { oldValue: data[k], newValue: next[k] };
    }
    data = next;
    if (Object.keys(changes).length) storageChanged.fire(changes, 'local');
  });

  // ---- alarms ----

  const timers = new Map();
  const alarmFired = makeEvent();

  function clearAlarm(name) {
    const timer = timers.get(name);
    if (!timer) return false;
    clearTimeout(timer.id);
    clearInterval(timer.id);
    timers.delete(name);
    return true;
  }

  function createAlarm(name, { when, periodInMinutes }) {
    clearAlarm(name);
    const fire = () => alarmFired.fire({ name, scheduledTime: Date.now() });
    const timer = {};
    const start = when == null ? Date.now() + periodInMinutes * 60 * 1000 : when;
    timer.id = setTimeout(() => {
      if (periodInMinutes) timer.id = setInterval(fire, periodInMinutes * 60 * 1000);
      else timers.delete(name);
      fire();
    }, Math.max(0, start - Date.now()));
    timers.set(name, timer);
  }

  // ---- runtime messages ----

  const messageListeners = [];

  function sendMessage(message) {
    for (const fn of messageListeners) {
      const r = fn(message, { id: 'web' });
      if (r !== undefined) return Promise.resolve(r);
    }
    return Promise.reject(new Error('No answer in this page.'));
  }

  const onStartup = makeEvent();
  const onInstalled = makeEvent();
  const never = makeEvent();

  window.browser = {
    storage: { local: { get, set }, onChanged: storageChanged },
    alarms: { create: createAlarm, clear: async name => clearAlarm(name), onAlarm: alarmFired },
    action: {
      setBadgeText: async ({ text }) => { document.title = text ? `${text} · ${TITLE}` : TITLE; },
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
    },
    notifications: { create: async id => id },
    permissions: { contains: async () => false, request: async () => false, onAdded: never, onRemoved: never },
    runtime: {
      getPlatformInfo: async () => ({ os }),
      getURL: path => new URL(path, location.href).href,
      sendMessage,
      onMessage: { addListener: fn => { messageListeners.push(fn); } },
      onStartup,
      onInstalled,
    },
  };

  window.close = () => {};

  // background.js adds its listeners while the page loads
  document.addEventListener('DOMContentLoaded', () => {
    (firstRun ? onInstalled : onStartup).fire({ reason: 'install' });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.error('No offline copy:', e));
  }
})();
