// Unit tests for src/sync-core.js. Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/sync-core.js');

function task(id, fields = {}) {
  return {
    id, name: id, elapsedMs: 0, startedAt: null, goalMs: null, goalNotified: false,
    done: false, createdAt: 0, lastRunAt: null, updatedAt: 0, ...fields,
  };
}

test('fromDocs makes the task list (newest first) and the delete markers', () => {
  const docs = [
    { id: 'a', data: task('a', { createdAt: 10 }) },
    { id: 'gone', data: { deletedAt: 7 } },
    { id: 'b', data: task('b', { createdAt: 30 }) },
  ];
  const r = S.fromDocs(docs);
  assert.deepEqual(r.tasks.map(t => t.id), ['b', 'a']);
  assert.deepEqual(r.deleted, { gone: 7 });
});

test('fromDocs skips documents that are not a task or a marker', () => {
  const r = S.fromDocs([{ id: 'x', data: { name: 'no fields' } }, { id: 'y', data: null }]);
  assert.deepEqual(r, { tasks: [], deleted: {} });
});

test('toDoc gives every task field and a stamp; a 4.1.0 task gets its createdAt', () => {
  const old = task('a', { createdAt: 50 });
  delete old.updatedAt;
  assert.equal(S.toDoc(old).updatedAt, 50);
  assert.deepEqual(Object.keys(S.toDoc(task('b'))).sort(), [
    'createdAt', 'done', 'elapsedMs', 'goalMs', 'goalNotified', 'id', 'lastRunAt', 'name', 'startedAt', 'updatedAt',
  ]);
  assert.equal(S.toDoc({ ...task('c'), extra: 1 }).extra, undefined);
});

test('writes: only the tasks and markers that the database does not have yet', () => {
  const remote = [
    { id: 'same', data: task('same', { updatedAt: 5 }) },
    { id: 'old', data: task('old', { updatedAt: 1 }) },
    { id: 'gone', data: { deletedAt: 3 } },
  ];
  const merged = {
    tasks: [task('same', { updatedAt: 5 }), task('old', { updatedAt: 9, name: 'new' }), task('new', { updatedAt: 4 })],
    deleted: { gone: 3, other: 8 },
  };
  const w = S.writes(merged, remote);
  assert.deepEqual(w.map(x => x.id).sort(), ['new', 'old', 'other']);
  assert.deepEqual(w.find(x => x.id === 'other').data, { deletedAt: 8 });
  assert.equal(w.find(x => x.id === 'old').data.name, 'new');
});

test('writes: nothing when both sides are the same', () => {
  const docs = [{ id: 'a', data: task('a', { updatedAt: 2 }) }, { id: 'z', data: { deletedAt: 1 } }];
  assert.deepEqual(S.writes(S.fromDocs(docs), docs), []);
});

test('same compares the saved data, so a task saved locally and read back is the same', () => {
  const t = task('a', { updatedAt: 2 });
  assert.equal(S.sameData(S.toDoc(t), JSON.parse(JSON.stringify(S.toDoc(t)))), true);
  assert.equal(S.sameData(S.toDoc(t), S.toDoc({ ...t, name: 'b' })), false);
});

test('sameLocal is true when the merge changed nothing in the local copy', () => {
  const local = { tasks: [task('a')], deleted: { x: 1 } };
  assert.equal(S.sameLocal(local, { tasks: [task('a')], deleted: { x: 1 } }), true);
  assert.equal(S.sameLocal(local, { tasks: [task('a')], deleted: {} }), false);
  assert.equal(S.sameLocal(local, { tasks: [task('a', { name: 'b' })], deleted: { x: 1 } }), false);
});

test('pruneMarkers removes markers older than the limit', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(S.pruneMarkers({ a: 0, b: 80 * day }, 100 * day, 90 * day), { b: 80 * day });
});
