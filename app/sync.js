// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Sync with a Google account through Firebase (see docs/desktop-and-sync-plan.md).
// Sync.create gets the Firebase functions (lib), the Firebase config and a
// store with loadCopy() and saveSynced(copy). The add-on and the desktop app
// give the Firebase bundle (lib/firebase.js) and Store; the emulator test
// gives the Firebase modules and a store in memory.
//
// Each run reads the local copy, merges it with the database documents
// (Tasks.merge), saves the result locally when it changed, and writes the
// documents that the database does not have yet. Runs go one at a time.

(function (root) {
  'use strict';

  const Tasks = root.Tasks || (typeof require === 'function' ? require('./tasks.js') : null);
  const SyncCore = root.SyncCore || (typeof require === 'function' ? require('./sync-core.js') : null);

  const MARKER_AGE = 90 * 24 * 60 * 60 * 1000;
  const BATCH = 400;  // Firestore takes at most 500 writes in a batch

  // firestoreSettings: for initializeFirestore, such as
  // {experimentalForceLongPolling: true} in the desktop app
  function create({ lib, config, store, emulator, name, firestoreSettings = {}, log = () => {} }) {
    const app = lib.initializeApp(config, name || '[DEFAULT]');
    const auth = lib.initializeAuth(app, { persistence: lib.authPersistence });
    const db = lib.initializeFirestore(app, firestoreSettings);
    if (emulator) {
      lib.connectAuthEmulator(auth, emulator.auth, { disableWarnings: true });
      lib.connectFirestoreEmulator(db, emulator.firestoreHost, emulator.firestorePort);
    }

    let user = null;
    let lastDocs = null;   // the database documents of the last run
    let queue = Promise.resolve();
    let stopListen = null;
    const userListeners = [];

    lib.onAuthStateChanged(auth, u => {
      user = u;
      lastDocs = null;
      for (const fn of userListeners) fn(u);
    });

    const tasksOf = uid => lib.collection(db, 'users', uid, 'tasks');

    function docsOf(snap) {
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }

    async function run(remoteDocs) {
      const local = await store.loadCopy();
      const merged = Tasks.merge(local, SyncCore.fromDocs(remoteDocs));
      merged.deleted = SyncCore.pruneMarkers(merged.deleted, Date.now(), MARKER_AGE);
      if (!SyncCore.sameLocal(local, merged)) await store.saveSynced(merged);

      const writes = SyncCore.writes(merged, remoteDocs);
      const uid = user && user.uid;
      if (!uid) return;
      for (let i = 0; i < writes.length; i += BATCH) {
        const batch = lib.writeBatch(db);
        for (const w of writes.slice(i, i + BATCH)) batch.set(lib.doc(tasksOf(uid), w.id), w.data);
        await batch.commit();
      }
      // The database now has the merged copy
      const byId = new Map(remoteDocs.map(d => [d.id, d]));
      for (const w of writes) byId.set(w.id, w);
      lastDocs = [...byId.values()];
      if (writes.length) log(`sync: wrote ${writes.length}`);
    }

    // Runs one at a time, in order. An error does not stop the next run.
    function enqueue(fn) {
      queue = queue.then(fn).catch(e => log('sync error: ' + (e && e.message || e)));
      return queue;
    }

    return {
      auth,

      user: () => user,

      // fn(user or null) at each sign-in and sign-out, and once at the start
      onUser(fn) {
        userListeners.push(fn);
      },

      // Waits until Firebase has read the saved sign-in
      ready: () => auth.authStateReady(),

      signInWithGoogleIdToken(idToken) {
        return lib.signInWithCredential(auth, lib.GoogleAuthProvider.credential(idToken));
      },

      async signOut() {
        if (stopListen) stopListen();
        stopListen = null;
        await lib.signOut(auth);
      },

      // Reads all documents and merges once
      syncNow() {
        return enqueue(async () => {
          if (!user) return;
          await run(docsOf(await lib.getDocs(tasksOf(user.uid))));
        });
      },

      // A local change: merge with the documents of the last run, and write
      // what changed. With no last run, reads the documents first.
      pushLocal() {
        return enqueue(async () => {
          if (!user) return;
          await run(lastDocs || docsOf(await lib.getDocs(tasksOf(user.uid))));
        });
      },

      // Merges at each change in the database, until stop() or signOut()
      listen() {
        if (stopListen || !user) return;
        const unsubscribe = lib.onSnapshot(tasksOf(user.uid), snap => {
          const docs = docsOf(snap);
          log(`sync: database has ${docs.length} documents`);
          enqueue(() => run(docs));
        }, e => log('sync listen error: ' + (e && e.message || e)));
        stopListen = () => { unsubscribe(); };
      },

      stop() {
        if (stopListen) stopListen();
        stopListen = null;
      },

      // Waits for the runs that are in the queue
      idle: () => queue,
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
