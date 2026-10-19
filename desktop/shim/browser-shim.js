// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Desktop app: gives the add-on scripts the part of the Firefox "browser" API
// that they use, with the app commands in src-tauri/src/main.rs.
//   storage.local    one JSON file in the app data folder, shared by the
//                    main window and the Preferences window
//   action badge     the text next to the tray icon
//   alarms           timers in this page (the window keeps its timers when
//                    it is hidden: "backgroundThrottling" is "disabled")
//   notifications    system notifications
//   permissions      only "notifications": a saved yes or no
//   runtime messages the listeners in this page first; else the message goes
//                    to the other window, and the main window always answers
//   commands         the global shortcut that shows or hides the main window.
//                    Saved as a Firefox shortcut in "desktopShortcut"; an empty
//                    text means no shortcut. The start value is Alt+W
//                    (Option+W on a Mac), as in the add-on.
// window.close() hides the window.

(function () {
  'use strict';

  const invoke = window.__TAURI__.core.invoke;
  const label = window.__TAURI__.window.getCurrentWindow().label;
  const NOTIFY_KEY = 'desktopNotify';
  const SHORTCUT_KEY = 'desktopShortcut';
  const OPEN = '_execute_action';
  const os = /Mac/.test(navigator.userAgent) ? 'mac' : /Win/.test(navigator.userAgent) ? 'win' : 'linux';
  const isMac = os === 'mac';
  const DEFAULT_SHORTCUT = 'Alt+W';

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

  let data = {};
  let firstRun = false;
  const ready = invoke('load_state').then(text => {
    firstRun = text == null;
    data = text ? JSON.parse(text) : {};
  });
  let writing = Promise.resolve();
  const storageChanged = makeEvent();

  async function get(keys) {
    await ready;
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

  // Saves in order, one write at a time. The app writes only these keys to
  // the file and sends the change to the other window. Then tells the
  // listeners in this page, as Firefox does.
  async function set(items) {
    await ready;
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: copy(data[k]), newValue: copy(v) };
      data[k] = copy(v);
    }
    const saved = copy(items);
    writing = writing.catch(() => {}).then(() => invoke('storage_set', { items: saved }));
    await writing;
    setTimeout(() => storageChanged.fire(changes, 'local'));
  }

  // A change that the other window saved
  window.__TAURI__.event.listen('storage-changed', async ({ payload }) => {
    if (payload.source === label) return;
    await ready;
    for (const [k, c] of Object.entries(payload.changes)) data[k] = copy(c.newValue);
    storageChanged.fire(payload.changes, 'local');
    const s = payload.changes[SHORTCUT_KEY];
    if (s) commandChanged.fire({ name: OPEN, newShortcut: s.newValue, oldShortcut: s.oldValue });
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
    timer.id = setTimeout(() => {
      if (periodInMinutes) timer.id = setInterval(fire, periodInMinutes * 60 * 1000);
      else timers.delete(name);
      fire();
    }, Math.max(0, when - Date.now()));
    timers.set(name, timer);
  }

  // ---- permissions ----

  const permissionAdded = makeEvent();
  const permissionRemoved = makeEvent();
  const asksNotify = p => Array.isArray(p.permissions) && p.permissions.includes('notifications');

  async function contains(p) {
    await ready;
    return asksNotify(p) && data[NOTIFY_KEY] === true;
  }

  async function request(p) {
    if (!asksNotify(p)) return false;
    await set({ [NOTIFY_KEY]: true });
    permissionAdded.fire(p);
    return true;
  }

  // ---- commands: the global shortcut ----

  const commandChanged = makeEvent();

  function shortcut() {
    return typeof data[SHORTCUT_KEY] === 'string' ? data[SHORTCUT_KEY] : DEFAULT_SHORTCUT;
  }

  function register(value) {
    return invoke('set_shortcut', { accelerator: Keys.toAccelerator(value, isMac) });
  }

  // Sets a new shortcut, or none with ''. When the app cannot use it (another
  // app has it), the old shortcut stays and the error goes to the page.
  async function updateCommand({ name, shortcut: next }) {
    await ready;
    const old = shortcut();
    try {
      await register(next);
    } catch (e) {
      await register(old).catch(() => {});
      throw new Error(String(e));
    }
    await set({ [SHORTCUT_KEY]: next });
    commandChanged.fire({ name, newShortcut: next, oldShortcut: old });
  }

  // ---- runtime messages ----

  const messageListeners = [];
  const waiting = new Map();
  let nextId = 0;
  const emit = (name, payload) => window.__TAURI__.event.emit(name, payload);

  // The first listener that gives an answer (not undefined), or undefined
  function answerOf(message) {
    for (const fn of messageListeners) {
      const r = fn(message, { id: 'desktop' });
      if (r !== undefined) return r;
    }
    return undefined;
  }

  // In Firefox, the popup and the background are two pages. Here they are
  // one page, so a listener in this page answers first.
  function sendMessage(message) {
    const here = answerOf(message);
    if (here !== undefined) return Promise.resolve(here);
    const id = label + ':' + ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('No answer from the main window.'));
      }, 120000);
      waiting.set(id, { resolve, reject, timer });
      emit('runtime-message', { id, source: label, message });
    });
  }

  window.__TAURI__.event.listen('runtime-message', ({ payload }) => {
    if (payload.source === label) return;
    const answer = answerOf(payload.message);
    if (answer === undefined && label !== 'main') return;
    Promise.resolve(answer).then(
      value => emit('runtime-reply', { id: payload.id, ok: true, value }),
      e => emit('runtime-reply', { id: payload.id, ok: false, error: String(e && e.message || e) }));
  });

  window.__TAURI__.event.listen('runtime-reply', ({ payload }) => {
    const w = waiting.get(payload.id);
    if (!w) return;
    waiting.delete(payload.id);
    clearTimeout(w.timer);
    if (payload.ok) w.resolve(payload.value);
    else w.reject(new Error(payload.error));
  });

  // ---- runtime ----

  const onStartup = makeEvent();
  const onInstalled = makeEvent();

  window.browser = {
    storage: { local: { get, set }, onChanged: storageChanged },
    alarms: { create: createAlarm, clear: async name => clearAlarm(name), onAlarm: alarmFired },
    action: {
      setBadgeText: ({ text }) => invoke('set_tray_title', { title: text || '' }),
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
    },
    notifications: {
      create: async (id, { title, message }) => {
        await invoke('notify', { title, body: message });
        return id;
      },
    },
    permissions: { contains, request, onAdded: permissionAdded, onRemoved: permissionRemoved },
    runtime: {
      getPlatformInfo: async () => ({ os }),
      getURL: path => path,
      sendMessage,
      onMessage: { addListener: fn => { messageListeners.push(fn); } },
      onStartup,
      onInstalled,
    },
    commands: {
      getAll: async () => { await ready; return [{ name: OPEN, shortcut: shortcut() }]; },
      update: updateCommand,
      reset: name => updateCommand({ name, shortcut: DEFAULT_SHORTCUT }),
      onChanged: commandChanged,
    },
  };

  window.close = () => { invoke('hide_window'); };

  // background.js adds its listeners while the page loads. The main window
  // also sets the saved shortcut.
  if (label === 'main') {
    document.addEventListener('DOMContentLoaded', () => {
      ready.then(() => {
        (firstRun ? onInstalled : onStartup).fire({ reason: 'install' });
        register(shortcut()).catch(e => console.error('Shortcut not set:', e));
      });
    });
  }

  // The shortcut or the tray opened the window: the cursor goes to the name field
  window.__TAURI__.event.listen('opened', () => {
    const name = document.getElementById('name');
    if (name) name.focus();
  });
})();
