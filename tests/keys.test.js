// Unit tests for src/keys.js. Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/keys.js');

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
