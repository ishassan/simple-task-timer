// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Task list logic with no browser calls. The popup, the background script
// and the unit tests all use it. Each change returns a new list and does not
// change the list it gets.
//
// A task: {id, name, elapsedMs, startedAt, goalMs, goalNotified, done, createdAt}
// A task runs when startedAt is a timestamp. Its time is then
// elapsedMs + (now - startedAt), so it needs no ticking.

(function (root) {
  'use strict';

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;

  function isRunning(task) {
    return task.startedAt != null;
  }

  function shownMs(task, now) {
    return task.elapsedMs + (isRunning(task) ? Math.max(0, now - task.startedAt) : 0);
  }

  function goalReached(task, now) {
    return task.goalMs != null && shownMs(task, now) >= task.goalMs;
  }

  // The time when a running task reaches its goal, or null
  function goalTime(task) {
    if (!isRunning(task) || task.goalMs == null) return null;
    return task.startedAt + (task.goalMs - task.elapsedMs);
  }

  function runningTask(tasks) {
    return tasks.find(isRunning) || null;
  }

  // "Task N": N is 1 + the highest number in a task named "Task <number>"
  function nextName(tasks) {
    let max = 0;
    for (const t of tasks) {
      const m = /^Task (\d+)$/.exec(t.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return 'Task ' + (max + 1);
  }

  function stopped(task, now) {
    if (!isRunning(task)) return task;
    return { ...task, elapsedMs: shownMs(task, now), startedAt: null };
  }

  function pauseAll(tasks, now) {
    return tasks.map(t => stopped(t, now));
  }

  function update(tasks, id, fn) {
    return tasks.map(t => (t.id === id ? fn(t) : t));
  }

  // Makes a new task at the top of the list and starts it
  function create(tasks, name, now, id) {
    const clean = (name || '').trim();
    const task = {
      id,
      name: clean || nextName(tasks),
      elapsedMs: 0,
      startedAt: now,
      goalMs: null,
      goalNotified: false,
      done: false,
      createdAt: now,
    };
    return [task, ...pauseAll(tasks, now)];
  }

  // Starts a task and pauses the one that runs. A done task comes back.
  function start(tasks, id, now) {
    return update(pauseAll(tasks, now), id, t => ({ ...t, startedAt: now, done: false }));
  }

  function pause(tasks, id, now) {
    return update(tasks, id, t => stopped(t, now));
  }

  function reset(tasks, id) {
    return update(tasks, id, t => ({ ...t, elapsedMs: 0, startedAt: null, goalNotified: false }));
  }

  function markDone(tasks, id, now) {
    return update(tasks, id, t => ({ ...stopped(t, now), done: true }));
  }

  function remove(tasks, id) {
    return tasks.filter(t => t.id !== id);
  }

  function removeDone(tasks) {
    return tasks.filter(t => !t.done);
  }

  // Changes name, time or goal. A field that is undefined does not change.
  // The goal can notify again when the new time or goal puts the task below it.
  function edit(tasks, id, changes, now) {
    return update(tasks, id, t => {
      const next = { ...t };
      if (changes.name !== undefined) next.name = changes.name.trim() || t.name;
      if (changes.elapsedMs !== undefined) {
        next.elapsedMs = changes.elapsedMs;
        if (isRunning(t)) next.startedAt = now;
      }
      if (changes.goalMs !== undefined) next.goalMs = changes.goalMs;
      next.goalNotified = t.goalNotified && goalReached(next, now);
      return next;
    });
  }

  function setGoalNotified(tasks, id) {
    return update(tasks, id, t => ({ ...t, goalNotified: true }));
  }

  // Reads a duration. Returns milliseconds, null for an empty text, or NaN
  // for a text it cannot read.
  //   "1:20:00" = h:mm:ss, "20:00" = m:ss, "90" = minutes,
  //   "45m", "1h", "1h 5m", "1.5h", "30s", "1h5m10s"
  function parseDuration(text) {
    const s = String(text == null ? '' : text).trim().toLowerCase();
    if (s === '') return null;

    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * MINUTE);

    if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
      const parts = s.split(':').map(Number);
      if (parts.slice(1).some(p => p > 59)) return NaN;
      const [h, m, sec] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
      return h * HOUR + m * MINUTE + sec * SECOND;
    }

    const re = /(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)\s*/y;
    let ms = 0;
    let pos = 0;
    while (pos < s.length) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m) return NaN;
      const unit = m[2][0] === 'h' ? HOUR : m[2][0] === 'm' ? MINUTE : SECOND;
      ms += Number(m[1]) * unit;
      pos = re.lastIndex;
    }
    return Math.round(ms);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // 0:27:41
  function formatClock(ms) {
    const total = Math.floor(Math.max(0, ms) / SECOND);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h + ':' + pad(m) + ':' + pad(s);
  }

  // 25m, 1h, 1h 5m, 45s
  function formatShort(ms) {
    const total = Math.round(Math.max(0, ms) / SECOND);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (s && !h) parts.push(s + 's');
    return parts.join(' ') || '0m';
  }

  // Toolbar badge, at most 4 characters: 0m, 25m, 1:05, 12h
  function badgeText(ms) {
    const mins = Math.floor(Math.max(0, ms) / MINUTE);
    if (mins < 60) return mins + 'm';
    const h = Math.floor(mins / 60);
    if (h < 10) return h + ':' + pad(mins % 60);
    return h + 'h';
  }

  const api = {
    isRunning, shownMs, goalReached, goalTime, runningTask, nextName,
    create, start, pause, reset, markDone, remove, removeDone, edit, setGoalNotified,
    parseDuration, formatClock, formatShort, badgeText,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
