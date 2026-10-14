// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Preferences page: the shortcut that opens the popup (a Firefox
// command) and the keys that act on a task in the popup. A click on a key box
// starts recording; the next key press is saved at once. Escape cancels.

'use strict';

const $ = id => document.getElementById(id);
const COMMAND = '_execute_action';
let isMac = false;
let keys = Keys.DEFAULT_KEYS;
let statusTimer = null;

function showStatus(text) {
  $('status').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, 3000);
}

function showError(id, text) {
  $(id).textContent = text || '';
  $(id).hidden = !text;
}

// ---- The shortcut that opens the popup ----

async function currentShortcut() {
  const all = await browser.commands.getAll();
  const cmd = all.find(c => c.name === COMMAND);
  return cmd ? cmd.shortcut : '';
}

async function showShortcut() {
  $('open-key').textContent = Keys.shortcutLabel(await currentShortcut(), isMac);
}

async function saveShortcut(shortcut) {
  try {
    await browser.commands.update({ name: COMMAND, shortcut });
    showError('open-error', '');
    showStatus('Saved. ' + Keys.shortcutLabel(shortcut, isMac) + ' opens Simple Task Timer.');
  } catch (e) {
    showError('open-error', 'Firefox did not accept this shortcut: ' + (e && e.message || e));
  }
  await showShortcut();
}

// ---- Keys in the popup ----

function renderKeys() {
  const box = $('key-rows');
  box.textContent = '';
  for (const a of Keys.ACTIONS) {
    const row = $('key-row').content.firstElementChild.cloneNode(true);
    row.querySelector('.label').textContent = a.label;
    const button = row.querySelector('.key');
    button.dataset.action = a.id;
    button.textContent = Keys.keyLabel(keys[a.id]);
    box.append(row);
  }
}

async function saveKey(action, key) {
  const error = Keys.checkKey(keys, action, key);
  if (error) {
    showError('keys-error', error);
    return;
  }
  keys = { ...keys, [action]: key };
  await Store.saveKeys(keys);
  showError('keys-error', '');
  renderKeys();
  const label = Keys.ACTIONS.find(a => a.id === action).label;
  showStatus('Saved. ' + Keys.keyLabel(key) + ' now does "' + label + '".');
}

// ---- Recording ----

let recording = null;  // the key box that waits for a key press

function startRecording(button) {
  stopRecording();
  recording = button;
  button.dataset.before = button.textContent;
  button.textContent = 'Press a key';
  button.classList.add('recording');
}

function stopRecording() {
  if (!recording) return;
  recording.classList.remove('recording');
  if (recording.textContent === 'Press a key') recording.textContent = recording.dataset.before;
  recording = null;
}

function onKeyDown(e) {
  if (!recording) return;
  if (e.key === 'Tab') {
    stopRecording();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopRecording();
    return;
  }
  const button = recording;
  if (button.dataset.shortcut) {
    const r = Keys.shortcutFromEvent(e, isMac);
    if (!r) return;  // only a modifier is down: wait for the key
    stopRecording();
    if (r.error) showError('open-error', r.error);
    else saveShortcut(r.shortcut);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    showError('keys-error', 'Use one key with no Ctrl, Alt or Command.');
    return;
  }
  stopRecording();
  saveKey(button.dataset.action, Keys.keyOf(e));
}

async function init() {
  isMac = (await browser.runtime.getPlatformInfo()).os === 'mac';
  if (isMac) document.querySelector('.undo-key').textContent = 'Command+Z';

  // Firefox for Android has no keyboard shortcuts for add-ons
  if (browser.commands && browser.commands.update) {
    await showShortcut();
  } else {
    $('open-section').hidden = true;
  }

  keys = await Store.loadKeys();
  renderKeys();

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', e => {
    const button = e.target.closest('button.key');
    if (button) startRecording(button);
    else stopRecording();
  });
  $('open-reset').addEventListener('click', async () => {
    await browser.commands.reset(COMMAND);
    // Firefox does not send commands.onChanged for a reset, so tell an open
    // popup. With no popup open, nothing receives the message.
    browser.runtime.sendMessage('shortcut-reset').catch(() => {});
    showError('open-error', '');
    await showShortcut();
    showStatus('Saved. The shortcut is back to ' + $('open-key').textContent + '.');
  });
  $('keys-reset').addEventListener('click', async () => {
    keys = { ...Keys.DEFAULT_KEYS };
    await Store.saveKeys(keys);
    showError('keys-error', '');
    renderKeys();
    showStatus('Saved. All keys are back to the start values.');
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.keys) {
      keys = Keys.withDefaults(changes.keys.newValue);
      renderKeys();
    }
  });
}

init();
