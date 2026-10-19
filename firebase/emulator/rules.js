// Tests for firestore.rules in the Firestore emulator. Run: npm test (in firebase/).
// The name has no "test" in it, so "node --test" in the repo root does not run it.
'use strict';

const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, collection, getDocs } = require('firebase/firestore');

let env;

const task = (id, fields = {}) => ({
  id, name: 'Report', elapsedMs: 0, startedAt: 1000, goalMs: null, goalNotified: false,
  done: false, createdAt: 1000, lastRunAt: 1000, updatedAt: 1000, ...fields,
});

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-simple-task-timer',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
  });
});

test.after(() => env.cleanup());
test.beforeEach(() => env.clearFirestore());

const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

test('a user writes, reads and deletes the own tasks', async () => {
  const ref = doc(db('alice'), 'users/alice/tasks/t1');
  await assertSucceeds(setDoc(ref, task('t1')));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(db('alice'), 'users/alice/tasks')));
  await assertSucceeds(setDoc(ref, { deletedAt: 2000 }));
  await assertSucceeds(deleteDoc(ref));
});

test('a user cannot read or write the tasks of another user', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'users/bob/tasks/t1'), task('t1')));
  await assertFails(getDoc(doc(db('alice'), 'users/bob/tasks/t1')));
  await assertFails(getDocs(collection(db('alice'), 'users/bob/tasks')));
  await assertFails(setDoc(doc(db('alice'), 'users/bob/tasks/t2'), task('t2')));
  await assertFails(deleteDoc(doc(db('alice'), 'users/bob/tasks/t1')));
});

test('no access without sign-in', async () => {
  await assertFails(getDoc(doc(db(null), 'users/alice/tasks/t1')));
  await assertFails(setDoc(doc(db(null), 'users/alice/tasks/t1'), task('t1')));
});

test('a task must have the right fields and types', async () => {
  const ref = id => doc(db('alice'), 'users/alice/tasks/' + id);
  await assertFails(setDoc(ref('t1'), task('other')));                       // id is not the document ID
  await assertFails(setDoc(ref('t1'), task('t1', { name: 'x'.repeat(201) })));
  await assertFails(setDoc(ref('t1'), task('t1', { elapsedMs: -1 })));
  await assertFails(setDoc(ref('t1'), task('t1', { elapsedMs: '5' })));
  await assertFails(setDoc(ref('t1'), task('t1', { done: 'yes' })));
  await assertFails(setDoc(ref('t1'), task('t1', { extra: 1 })));
  const { updatedAt, ...noStamp } = task('t1');
  await assertFails(setDoc(ref('t1'), noStamp));
  await assertSucceeds(setDoc(ref('t1'), task('t1', { startedAt: null, lastRunAt: null, goalMs: 1500000 })));
  // Task IDs are UUIDs (36 characters): a long ID cannot fill the database
  const long = 'x'.repeat(65);
  await assertFails(setDoc(ref(long), task(long)));
  await assertFails(setDoc(ref(long), { deletedAt: 5 }));
  await assertSucceeds(setDoc(ref('x'.repeat(64)), task('x'.repeat(64))));
});

test('a delete marker has only deletedAt', async () => {
  const ref = doc(db('alice'), 'users/alice/tasks/t1');
  await assertFails(setDoc(ref, { deletedAt: 'now' }));
  await assertFails(setDoc(ref, { deletedAt: 5, name: 'x' }));
  await assertSucceeds(setDoc(ref, { deletedAt: 5 }));
});

test('other paths are closed', async () => {
  await assertFails(setDoc(doc(db('alice'), 'users/alice'), { a: 1 }));
  await assertFails(setDoc(doc(db('alice'), 'other/x'), { a: 1 }));
  await assertFails(getDoc(doc(db('alice'), 'users/alice/settings/x')));
});
