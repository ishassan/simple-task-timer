// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Storage and permission helpers for the popup and the background script.
// storage.local keys: tasks (the task list), notifyPromptDismissed (true
// after "Not now" on the notification question).

(function (root) {
  'use strict';

  const NOTIFY = { permissions: ['notifications'] };

  async function loadTasks() {
    const r = await browser.storage.local.get({ tasks: [] });
    return Array.isArray(r.tasks) ? r.tasks : [];
  }

  function saveTasks(tasks) {
    return browser.storage.local.set({ tasks });
  }

  // Reads the newest list, applies fn(list, now), and saves the result.
  // Returns the list from before the change (for Undo) and the new list.
  async function change(fn) {
    const before = await loadTasks();
    const after = fn(before, Date.now());
    await saveTasks(after);
    return { before, after };
  }

  async function promptDismissed() {
    const r = await browser.storage.local.get({ notifyPromptDismissed: false });
    return r.notifyPromptDismissed === true;
  }

  function dismissPrompt() {
    return browser.storage.local.set({ notifyPromptDismissed: true });
  }

  function canNotify() {
    return browser.permissions.contains(NOTIFY);
  }

  // Must run inside a click handler, before any await
  function askToNotify() {
    return browser.permissions.request(NOTIFY);
  }

  root.Store = { loadTasks, saveTasks, change, promptDismissed, dismissPrompt, canNotify, askToNotify };
})(globalThis);
