// End-to-end test of app/sync.js with the Auth and Firestore emulators:
// two devices with the same Google account, and one device of another user.
// Run: npm test (in firebase/). The rules in firestore.rules apply. The test
// files run one at a time: the rules test clears the database.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('firebase/app');
const auth = require('firebase/auth');
const firestore = require('firebase/firestore');
const Tasks = require('../../app/tasks.js');
const Sync = require('../../app/sync.js');

const lib = {
  initializeApp: app.initializeApp,
  initializeAuth: auth.initializeAuth,
  connectAuthEmulator: auth.connectAuthEmulator,
  signInWithCredential: auth.signInWithCredential,
  signOut: auth.signOut,
  onAuthStateChanged: auth.onAuthStateChanged,
  GoogleAuthProvider: auth.GoogleAuthProvider,
  authPersistence: auth.inMemoryPersistence,
  initializeFirestore: firestore.initializeFirestore,
  connectFirestoreEmulator: firestore.connectFirestoreEmulator,
  collection: firestore.collection,
  doc: firestore.doc,
  getDocs: firestore.getDocs,
  onSnapshot: firestore.onSnapshot,
  writeBatch: firestore.writeBatch,
};

const config = { apiKey: 'demo-key', projectId: 'demo-simple-task-timer', authDomain: 'demo-simple-task-timer.firebaseapp.com' };
const emulator = { auth: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8085 };

// A device: a store in memory that saves like Store.saveTasks, and a sync engine
let devices = 0;
const all = [];
function device(copy = { tasks: [], deleted: {} }) {
  const errors = [];
  const store = {
    copy: JSON.parse(JSON.stringify(copy)),
    loadCopy: async () => JSON.parse(JSON.stringify(store.copy)),
    saveSynced: async c => { store.copy = JSON.parse(JSON.stringify(c)); },
  };
  const sync = Sync.create({ lib, config, store, emulator, name: 'device' + ++devices, log: m => errors.push(m) });
  // A change made by the user on this device
  async function change(fn, now = Date.now()) {
    const before = store.copy.tasks;
    store.copy = Tasks.stamp(before, fn(before, now), store.copy.deleted, now);
    await sync.pushLocal();
  }
  const d = { store, sync, change, errors, names: () => store.copy.tasks.map(t => t.name) };
  all.push(d);
  return d;
}

const googleToken = sub => JSON.stringify({ sub, email: sub + '@example.com', email_verified: true });

async function until(check, what) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  const state = all.map((d, i) => `device ${i + 1}: ${JSON.stringify(d.store.copy)} errors: ${JSON.stringify(d.errors)}`);
  assert.fail('timed out: ' + what + '\n' + state.join('\n'));
}

async function clearData() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-simple-task-timer/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-simple-task-timer/accounts', { method: 'DELETE' });
}

test('two devices of one account sync tasks, starts and deletes; another account sees nothing', async () => {
  await clearData();

  // The laptop has tasks from version 4.1.0 (no updatedAt) before the first sign-in
  const old = [
    { id: 'r', name: 'Report', elapsedMs: 600000, startedAt: null, goalMs: null, goalNotified: false, done: false, createdAt: 1000, lastRunAt: 1000 },
    { id: 'e', name: 'Email', elapsedMs: 0, startedAt: null, goalMs: 1500000, goalNotified: false, done: true, createdAt: 900, lastRunAt: null },
  ];
  const laptop = device({ tasks: old, deleted: {} });
  await laptop.sync.signInWithGoogleIdToken(googleToken('alice'));
  await laptop.sync.syncNow();

  // The phone signs in with the same account and gets both tasks
  const phone = device();
  await phone.sync.signInWithGoogleIdToken(googleToken('alice'));
  assert.equal(phone.sync.user().uid, laptop.sync.user().uid);
  await phone.sync.syncNow();
  assert.deepEqual(phone.names(), ['Report', 'Email']);
  assert.equal(phone.store.copy.tasks[0].elapsedMs, 600000);

  laptop.sync.listen();
  phone.sync.listen();

  // The laptop starts "Report"; then the phone starts a new task a minute
  // later. Only the newer task runs on both devices. (These times are in the
  // past, so that the changes after them are newer.)
  const t0 = Date.now() - 120000;
  await laptop.change((l, now) => Tasks.start(l, 'r', now), t0);
  await until(() => Tasks.runningTask(phone.store.copy.tasks)?.id === 'r', 'phone sees Report running');
  await phone.change((l, now) => Tasks.create(l, 'Call', now, 'c'), t0 + 60000);
  await until(() => Tasks.runningTask(laptop.store.copy.tasks)?.id === 'c', 'laptop sees Call running');
  const report = laptop.store.copy.tasks.find(t => t.id === 'r');
  assert.equal(report.startedAt, null);
  assert.equal(report.elapsedMs, 600000 + 60000);
  assert.deepEqual(laptop.names(), ['Call', 'Report', 'Email']);

  // The phone deletes "Email": it goes from the laptop and does not come back
  await phone.change(l => Tasks.remove(l, 'e'));
  await until(() => !laptop.store.copy.tasks.some(t => t.id === 'e'), 'laptop loses Email');
  assert.ok(laptop.store.copy.deleted.e > 0);
  await laptop.sync.syncNow();
  assert.ok(!laptop.store.copy.tasks.some(t => t.id === 'e'));

  // Both devices change the name: the newer change wins on both
  await laptop.change(l => Tasks.edit(l, 'r', { name: 'Report v1' }, 0), Date.now());
  await phone.change(l => Tasks.edit(l, 'r', { name: 'Report v2' }, 0), Date.now() + 5000);
  await until(() => laptop.store.copy.tasks.find(t => t.id === 'r').name === 'Report v2', 'laptop gets v2');
  await laptop.sync.idle();
  await phone.sync.idle();
  assert.equal(phone.store.copy.tasks.find(t => t.id === 'r').name, 'Report v2');
  assert.deepEqual(laptop.store.copy, phone.store.copy);

  // Another account sees none of these tasks
  const other = device();
  await other.sync.signInWithGoogleIdToken(googleToken('bob'));
  await other.sync.syncNow();
  assert.deepEqual(other.store.copy.tasks, []);

  // Signed out: no more sync
  await phone.sync.signOut();
  await laptop.change((l, now) => Tasks.create(l, 'Late', now, 'late'));
  await new Promise(r => setTimeout(r, 1000));
  assert.ok(!phone.store.copy.tasks.some(t => t.id === 'late'));

  laptop.sync.stop();
  await other.sync.signOut();
  await laptop.sync.signOut();
  for (const d of [laptop, phone, other]) assert.deepEqual(d.errors.filter(e => /error/.test(e)), []);
  // Close the connections, so that the test process can end
  for (const d of [laptop, phone, other]) await app.deleteApp(d.sync.auth.app);
});
