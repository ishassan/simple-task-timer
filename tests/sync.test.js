// Unit tests for the sync stamps and the merge in app/tasks.js. Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../app/tasks.js');

const MIN = 60 * 1000;

function task(id, fields = {}) {
  return {
    id, name: id, elapsedMs: 0, startedAt: null, goalMs: null, goalNotified: false,
    done: false, createdAt: 0, lastRunAt: null, updatedAt: 0, ...fields,
  };
}

function byId(tasks) {
  return Object.fromEntries(tasks.map(t => [t.id, t]));
}

test('stamp: a new or changed task gets the time, a task with no change keeps its stamp', () => {
  const prev = [task('a', { updatedAt: 5 }), task('b', { updatedAt: 6 })];
  const next = [task('c'), { ...prev[0], name: 'A' }, prev[1]];
  const { tasks } = T.stamp(prev, next, {}, 100);
  const t = byId(tasks);
  assert.equal(t.c.updatedAt, 100);
  assert.equal(t.a.updatedAt, 100);
  assert.equal(t.b.updatedAt, 6);
});

test('stamp: a task saved by 4.1.0 (no updatedAt) and not changed stays without a stamp', () => {
  const old = task('a');
  delete old.updatedAt;
  const { tasks } = T.stamp([old], [old], {}, 100);
  assert.equal(tasks[0].updatedAt, undefined);
});

test('stamp: the old stamp in an Undo list does not hide the change', () => {
  // Undo saves the list from before a reset, with the old stamp
  const before = [task('a', { elapsedMs: 9 * MIN, updatedAt: 5 })];
  const saved = [task('a', { elapsedMs: 0, updatedAt: 50 })];
  const { tasks } = T.stamp(saved, before, {}, 60);
  assert.equal(tasks[0].elapsedMs, 9 * MIN);
  assert.equal(tasks[0].updatedAt, 60);
});

test('stamp: a deleted task leaves a marker, and Undo of the delete removes the marker', () => {
  const list = [task('a', { updatedAt: 5 }), task('b', { updatedAt: 5 })];
  const del = T.stamp(list, T.remove(list, 'a'), { old: 1 }, 100);
  assert.deepEqual(del.deleted, { old: 1, a: 100 });
  assert.deepEqual(del.tasks.map(t => t.id), ['b']);

  const undo = T.stamp(del.tasks, list, del.deleted, 110);
  assert.deepEqual(undo.deleted, { old: 1 });
  assert.equal(byId(undo.tasks).a.updatedAt, 110);
});

test('stamp does not change the lists and the markers it gets', () => {
  const prev = [task('a'), task('b')];
  const next = [{ ...prev[0], name: 'x' }];
  const deleted = { z: 1 };
  const copies = JSON.stringify([prev, next, deleted]);
  T.stamp(prev, next, deleted, 100);
  assert.equal(JSON.stringify([prev, next, deleted]), copies);
});

test('merge: for each task the newest change wins', () => {
  const local = { tasks: [task('a', { name: 'old', updatedAt: 10 }), task('b', { name: 'new', updatedAt: 30 })], deleted: {} };
  const remote = { tasks: [task('a', { name: 'new', updatedAt: 20 }), task('b', { name: 'old', updatedAt: 25 })], deleted: {} };
  const t = byId(T.merge(local, remote).tasks);
  assert.equal(t.a.name, 'new');
  assert.equal(t.b.name, 'new');
});

test('merge: a delete marker wins over an older or same-time task, a newer task wins over it', () => {
  const local = { tasks: [task('a', { updatedAt: 10 }), task('b', { updatedAt: 20 }), task('c', { updatedAt: 40 })], deleted: {} };
  const remote = { tasks: [], deleted: { a: 15, b: 20, c: 30 } };
  const merged = T.merge(local, remote);
  assert.deepEqual(merged.tasks.map(t => t.id), ['c']);
  assert.deepEqual(merged.deleted, { a: 15, b: 20 });
});

test('merge: the markers of both sides are kept, with the newest time', () => {
  const merged = T.merge({ tasks: [], deleted: { a: 5, b: 9 } }, { tasks: [], deleted: { a: 7, c: 1 } });
  assert.deepEqual(merged.deleted, { a: 7, b: 9, c: 1 });
});

test('merge: a task with no updatedAt counts as changed at its createdAt', () => {
  const old = task('a', { name: 'old', createdAt: 50 });
  delete old.updatedAt;
  const local = { tasks: [old], deleted: {} };
  assert.equal(T.merge(local, { tasks: [task('a', { name: 'new', updatedAt: 40 })], deleted: {} }).tasks[0].name, 'old');
  assert.equal(T.merge(local, { tasks: [task('a', { name: 'new', updatedAt: 60 })], deleted: {} }).tasks[0].name, 'new');
  assert.deepEqual(T.merge(local, { tasks: [], deleted: { a: 50 } }).tasks, []);
});

test('merge: only one task runs; the others pause when the newest one started', () => {
  // Laptop: "a" runs since minute 0. Phone: "b" started at minute 10.
  const laptop = { tasks: [task('a', { startedAt: 0, updatedAt: 0 })], deleted: {} };
  const phone = { tasks: [task('b', { startedAt: 10 * MIN, updatedAt: 10 * MIN, createdAt: 10 * MIN })], deleted: {} };
  for (const merged of [T.merge(laptop, phone), T.merge(phone, laptop)]) {
    const t = byId(merged.tasks);
    assert.equal(T.runningTask(merged.tasks).id, 'b');
    assert.equal(t.a.startedAt, null);
    assert.equal(t.a.elapsedMs, 10 * MIN);
    assert.equal(t.a.updatedAt, 10 * MIN);
  }
});

test('merge gives the same tasks on both devices', () => {
  const a = {
    tasks: [task('x', { name: 'x2', updatedAt: 9 }), task('y', { startedAt: 3, updatedAt: 3 }), task('z', { updatedAt: 1 })],
    deleted: { w: 4 },
  };
  const b = {
    tasks: [task('x', { name: 'x1', updatedAt: 8 }), task('w', { updatedAt: 2 }), task('v', { startedAt: 7, updatedAt: 7, createdAt: 7 })],
    deleted: { z: 5 },
  };
  const ab = T.merge(a, b);
  const ba = T.merge(b, a);
  assert.deepEqual(byId(ab.tasks), byId(ba.tasks));
  assert.deepEqual(ab.deleted, ba.deleted);
  assert.deepEqual(Object.keys(byId(ab.tasks)).sort(), ['v', 'x', 'y']);
  assert.equal(T.runningTask(ab.tasks).id, 'v');
});

test('merge keeps the local order and puts a new task from the other side by its createdAt', () => {
  const local = { tasks: [task('c', { createdAt: 30 }), task('a', { createdAt: 10 })], deleted: {} };
  const remote = { tasks: [task('d', { createdAt: 40 }), task('b', { createdAt: 20 }), task('a', { createdAt: 10 })], deleted: {} };
  assert.deepEqual(T.merge(local, remote).tasks.map(t => t.id), ['d', 'c', 'b', 'a']);
  const old = { tasks: [task('e', { createdAt: 1 })], deleted: {} };
  assert.deepEqual(T.merge(local, old).tasks.map(t => t.id), ['c', 'a', 'e']);
});

test('merge does not change the copies it gets', () => {
  const local = { tasks: [task('a', { startedAt: 0 })], deleted: { q: 1 } };
  const remote = { tasks: [task('b', { startedAt: 5, updatedAt: 5 })], deleted: { r: 2 } };
  const copies = JSON.stringify([local, remote]);
  T.merge(local, remote);
  assert.equal(JSON.stringify([local, remote]), copies);
});
