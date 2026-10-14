// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Key logic with no browser calls, for the popup, the Preferences page and
// the unit tests.
//
// Two kinds of keys:
// - Row keys: one key that acts on the focused task in the popup. The user
//   can change them. A key is stored as KeyboardEvent.key, letters in lower
//   case. "Delete" also matches Backspace (the Mac delete key).
// - The shortcut that opens the popup: a Firefox command such as "Alt+W".
//   Firefox checks it, and these rules follow Firefox's rules: at most two
//   modifiers, Shift alone is not enough, and only some key names. The same
//   shortcut closes the popup.

(function (root) {
  'use strict';

  const DEFAULT_KEYS = { toggle: ' ', edit: 'e', reset: 'r', done: 'd', delete: 'Delete' };

  const ACTIONS = [
    { id: 'toggle', label: 'Start or pause' },
    { id: 'edit', label: 'Edit' },
    { id: 'reset', label: 'Reset' },
    { id: 'done', label: 'Mark done' },
    { id: 'delete', label: 'Delete' },
  ];

  // Keys that the popup uses for moving and that the user cannot give to an action
  const FIXED = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Enter', 'Tab'];

  // The key of a keydown event as the popup stores it
  function keyOf(e) {
    if (e.key === 'Backspace') return 'Delete';
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }

  function keyLabel(key) {
    if (key === ' ') return 'Space';
    if (key === 'Delete') return 'Delete';
    return key.length === 1 ? key.toUpperCase() : key;
  }

  // The key in a tooltip: "Reset (R)", "Delete (Delete key)"
  function keyHint(key) {
    return key === 'Delete' ? 'Delete key' : keyLabel(key);
  }

  // The stored keys, with the default for each missing or bad entry
  function withDefaults(keys) {
    const out = { ...DEFAULT_KEYS };
    if (keys && typeof keys === 'object') {
      for (const a of ACTIONS) {
        if (typeof keys[a.id] === 'string' && keys[a.id] !== '') out[a.id] = keys[a.id];
      }
    }
    return out;
  }

  // The action for a key, or null
  function actionFor(keys, key) {
    const k = withDefaults(keys);
    return ACTIONS.map(a => a.id).find(id => k[id] === key) || null;
  }

  // Returns an error text for a row key that cannot be used, or null
  function checkKey(keys, action, key) {
    if (FIXED.includes(key)) return keyLabel(key) + ' moves in the list. Use another key.';
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) {
      return 'Use a letter, a number, Space or Delete.';
    }
    const other = actionFor(keys, key);
    if (other && other !== action) {
      const label = ACTIONS.find(a => a.id === other).label;
      return keyLabel(key) + ' is already the key for "' + label + '".';
    }
    return null;
  }

  // ---- The shortcut that opens the popup ----

  const CODE_KEYS = {
    Comma: 'Comma', Period: 'Period', Home: 'Home', End: 'End', PageUp: 'PageUp',
    PageDown: 'PageDown', Space: 'Space', Insert: 'Insert', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };

  // The Firefox name of the key, from KeyboardEvent.code. The code does not
  // change with the keyboard layout or with Option on a Mac (Option+W types "∑").
  function shortcutKey(code) {
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (m) return m[1];
    if (/^F([1-9]|1[0-9])$/.test(code)) return code;
    return CODE_KEYS[code] || null;
  }

  // Makes a Firefox shortcut from a keydown event.
  // Returns {shortcut} or {error}, or null while only modifiers are down.
  function shortcutFromEvent(e, isMac) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'OS'].includes(e.key)) return null;
    const key = shortcutKey(e.code);
    if (!key) return { error: 'Firefox does not allow this key in a shortcut.' };
    if (e.metaKey && !isMac) return { error: 'Firefox does not allow the Windows key in a shortcut.' };
    const mods = [];
    if (e.ctrlKey) mods.push(isMac ? 'MacCtrl' : 'Ctrl');
    if (e.metaKey) mods.push('Command');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    const fkey = /^F\d+$/.test(key);
    if (mods.length > 2) return { error: 'Use at most two modifier keys.' };
    if (!fkey && mods.filter(m => m !== 'Shift').length === 0) {
      return { error: 'Hold Alt, Ctrl' + (isMac ? ', Command' : '') + ' or one of them with Shift, then press a key.' };
    }
    return { shortcut: mods.concat(key).join('+') };
  }

  // True if a keydown event is the shortcut (a Firefox command such as
  // "Alt+W"). The order of the modifiers does not matter. On a Mac, "Ctrl" in
  // a shortcut is the Command key and "MacCtrl" is the Control key.
  function matchesShortcut(e, shortcut, isMac) {
    if (!shortcut) return false;
    const r = shortcutFromEvent(e, isMac);
    if (!r || !r.shortcut) return false;
    const parts = s => {
      const p = s.split('+');
      const mods = p.slice(0, -1).map(m => (isMac && m === 'Ctrl' ? 'Command' : m)).sort();
      return mods.concat(p[p.length - 1]).join('+');
    };
    return parts(r.shortcut) === parts(shortcut);
  }

  // "Alt+Shift+W" as the user sees it
  function shortcutLabel(shortcut, isMac) {
    if (!shortcut) return 'Not set';
    const mac = { Alt: 'Option', Command: 'Command', MacCtrl: 'Control', Ctrl: 'Command', Shift: 'Shift' };
    return shortcut.split('+').map(p => (isMac && mac[p] ? mac[p] : p)).join('+');
  }

  const api = {
    DEFAULT_KEYS, ACTIONS, FIXED, keyOf, keyLabel, keyHint, withDefaults, actionFor, checkKey,
    shortcutKey, shortcutFromEvent, matchesShortcut, shortcutLabel,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Keys = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
