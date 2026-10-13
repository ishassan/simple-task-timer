// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Storage and permission helpers for the popup and the background script.
// storage.local keys: tasks (the task list), notifyPromptDismissed (true
// after "Not now" on the notification question), v3Imported (true after the
// 3.x tasks were added to the list).

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

  // Version 3.x kept its tasks as JSON in localStorage['tasks']. Adds them to
  // the list one time. The 3.x data stays where it is.
  async function importV3() {
    const r = await browser.storage.local.get({ v3Imported: false });
    if (r.v3Imported) return;
    let old = null;
    try {
      old = JSON.parse(localStorage.getItem('tasks'));
    } catch (e) {
      // No localStorage, or no valid 3.x data: there is nothing to add
    }
    const tasks = Tasks.fromV3(old, await loadTasks(), Date.now(), () => crypto.randomUUID());
    await browser.storage.local.set({ tasks, v3Imported: true });
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

  root.Store = { loadTasks, saveTasks, change, importV3, promptDismissed, dismissPrompt, canNotify, askToNotify };
})(globalThis);
