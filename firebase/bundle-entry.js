// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Firebase functions that src/sync.js uses. "npm run bundle" makes
// src/lib/firebase.js from this file: one script that sets the global
// FirebaseLib. The add-on cannot load code from the internet, so Firebase is
// in the package. Auth comes from "firebase/auth/web-extension", the build
// with no remote scripts (no sign-in pop-ups or reCAPTCHA).

export { initializeApp } from 'firebase/app';
export {
  initializeAuth, connectAuthEmulator, signInWithCredential, signOut, onAuthStateChanged,
  GoogleAuthProvider,
} from 'firebase/auth/web-extension';
export {
  initializeFirestore, connectFirestoreEmulator, collection, doc, getDocs, onSnapshot, writeBatch,
} from 'firebase/firestore';
export { indexedDBLocalPersistence as authPersistence } from 'firebase/auth/web-extension';
