// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Keeps a copy of the page files, so that the web version opens with no
// network. It gets each file from the network first, so a new version shows
// at once; the copy is only for when the network fails.

const CACHE = 'simple-task-timer';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(response => {
    if (response.ok) {
      const saved = response.clone();
      caches.open(CACHE).then(c => c.put(e.request, saved));
    }
    return response;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
