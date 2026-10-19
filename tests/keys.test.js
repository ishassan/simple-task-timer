// Unit tests for app/keys.js. Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../app/keys.js');

const ev = (key, code, mods) => Object.assign({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, mods || {});

test('keyOf stores letters in lower case and Backspace as Delete', () => {
  assert.equal(K.keyOf(ev('R')), 'r');
  assert.equal(K.keyOf(ev(' ')), ' ');
  assert.equal(K.keyOf(ev('Backspace')), 'Delete');
  assert.equal(K.keyOf(ev('Delete')), 'Delete');
});

test('actionFor uses the stored keys, with defaults for missing ones', () => {
  assert.equal(K.actionFor({}, 'r'), 'reset');
  assert.equal(K.actionFor({ reset: 'x' }, 'x'), 'reset');
  assert.equal(K.actionFor({ reset: 'x' }, 'r'), null);
  assert.equal(K.actionFor({ toggle: 'p' }, ' '), null);
  assert.equal(K.actionFor(null, 'Delete'), 'delete');
  assert.deepEqual(K.withDefaults({ edit: '', done: 5 }), K.DEFAULT_KEYS);
});

test('checkKey refuses keys that move in the list and keys of other actions', () => {
  assert.match(K.checkKey({}, 'reset', 'ArrowDown'), /moves in the list/);
  assert.match(K.checkKey({}, 'reset', 'd'), /already the key for "Mark done"/);
  assert.match(K.checkKey({}, 'reset', 'Shift'), /Use a letter/);
  assert.equal(K.checkKey({}, 'reset', 'r'), null);
  assert.equal(K.checkKey({}, 'reset', 'x'), null);
});

test('labels', () => {
  assert.equal(K.keyLabel(' '), 'Space');
  assert.equal(K.keyLabel('r'), 'R');
  assert.equal(K.keyHint('Delete'), 'Delete key');
  assert.equal(K.keyHint(' '), 'Space');
  assert.equal(K.shortcutLabel('Alt+W', true), 'Option+W');
  assert.equal(K.shortcutLabel('MacCtrl+Shift+T', true), 'Control+Shift+T');
  assert.equal(K.shortcutLabel('Alt+W', false), 'Alt+W');
  assert.equal(K.shortcutLabel('', false), 'Not set');
});

test('shortcutFromEvent follows the Firefox rules', () => {
  // Option+W on a Mac types "∑", but the code is still KeyW
  assert.deepEqual(K.shortcutFromEvent(ev('∑', 'KeyW', { altKey: true }), true), { shortcut: 'Alt+W' });
  assert.deepEqual(K.shortcutFromEvent(ev('T', 'KeyT', { ctrlKey: true, shiftKey: true }), false), { shortcut: 'Ctrl+Shift+T' });
  assert.deepEqual(K.shortcutFromEvent(ev('t', 'KeyT', { ctrlKey: true }), true), { shortcut: 'MacCtrl+T' });
  assert.deepEqual(K.shortcutFromEvent(ev('t', 'KeyT', { metaKey: true }), true), { shortcut: 'Command+T' });
  assert.deepEqual(K.shortcutFromEvent(ev('F2', 'F2'), false), { shortcut: 'F2' });
  assert.deepEqual(K.shortcutFromEvent(ev('ArrowUp', 'ArrowUp', { altKey: true }), false), { shortcut: 'Alt+Up' });
  assert.equal(K.shortcutFromEvent(ev('Alt', 'AltLeft', { altKey: true }), false), null);
  assert.ok(K.shortcutFromEvent(ev('w', 'KeyW'), false).error);
  assert.ok(K.shortcutFromEvent(ev('W', 'KeyW', { shiftKey: true }), false).error);
  assert.ok(K.shortcutFromEvent(ev('w', 'KeyW', { ctrlKey: true, altKey: true, shiftKey: true }), false).error);
  assert.ok(K.shortcutFromEvent(ev('/', 'Slash', { altKey: true }), false).error);
  assert.ok(K.shortcutFromEvent(ev('w', 'KeyW', { metaKey: true }), false).error);
});

test('matchesShortcut finds the shortcut that opens the popup', () => {
  // Option+W on a Mac types "∑" in a text field, but it is still the shortcut
  assert.equal(K.matchesShortcut(ev('∑', 'KeyW', { altKey: true }), 'Alt+W', true), true);
  assert.equal(K.matchesShortcut(ev('w', 'KeyW', { altKey: true }), 'Alt+W', false), true);
  assert.equal(K.matchesShortcut(ev('w', 'KeyW'), 'Alt+W', false), false);
  assert.equal(K.matchesShortcut(ev('W', 'KeyW', { altKey: true, shiftKey: true }), 'Alt+W', false), false);
  assert.equal(K.matchesShortcut(ev('e', 'KeyE', { altKey: true }), 'Alt+W', false), false);
  // The order of the modifiers does not matter
  assert.equal(K.matchesShortcut(ev('Y', 'KeyY', { altKey: true, shiftKey: true }), 'Shift+Alt+Y', false), true);
  // On a Mac, "Ctrl" in a shortcut is the Command key, and "MacCtrl" is Control
  assert.equal(K.matchesShortcut(ev('y', 'KeyY', { metaKey: true }), 'Ctrl+Y', true), true);
  assert.equal(K.matchesShortcut(ev('y', 'KeyY', { ctrlKey: true }), 'Ctrl+Y', true), false);
  assert.equal(K.matchesShortcut(ev('y', 'KeyY', { ctrlKey: true }), 'MacCtrl+Y', true), true);
  assert.equal(K.matchesShortcut(ev('y', 'KeyY', { ctrlKey: true }), 'Ctrl+Y', false), true);
  // No shortcut set
  assert.equal(K.matchesShortcut(ev('∑', 'KeyW', { altKey: true }), '', true), false);
  assert.equal(K.matchesShortcut(ev('∑', 'KeyW', { altKey: true }), undefined, true), false);
});

test('toAccelerator gives the desktop app shortcut for a Firefox shortcut', () => {
  assert.equal(K.toAccelerator('Alt+W', true), 'Alt+W');
  assert.equal(K.toAccelerator('MacCtrl+Alt+W', true), 'Control+Alt+W');
  assert.equal(K.toAccelerator('Command+Shift+Up', true), 'Super+Shift+Up');
  assert.equal(K.toAccelerator('Ctrl+Shift+5', true), 'Super+Shift+5');
  assert.equal(K.toAccelerator('Ctrl+Alt+W', false), 'Control+Alt+W');
  assert.equal(K.toAccelerator('F9', false), 'F9');
  assert.equal(K.toAccelerator('', true), '');
});
