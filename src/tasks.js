// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Task list logic with no browser calls. The popup, the background script
// and the unit tests all use it. Each change returns a new list and does not
// change the list it gets.
//
// A task: {id, name, elapsedMs, startedAt, goalMs, goalNotified, done, createdAt, lastRunAt}
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

  // The running task, else the task (not done) that ran last, else null
  function lastTask(tasks) {
    const running = runningTask(tasks);
    if (running) return running;
    let last = null;
    for (const t of tasks) {
      if (!t.done && t.lastRunAt != null && (!last || t.lastRunAt > last.lastRunAt)) last = t;
    }
    return last;
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
      lastRunAt: now,
    };
    return [task, ...pauseAll(tasks, now)];
  }

  // Starts a task and pauses the one that runs. A done task comes back.
  function start(tasks, id, now) {
    return update(pauseAll(tasks, now), id, t => ({ ...t, startedAt: now, lastRunAt: now, done: false }));
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

  // Converts the task list of version 3.x and adds it after the list.
  // A 3.x task: {text, current_hours, current_mins, current_secs, goal_hours,
  // goal_mins, indefinite, notified, last_tick}. Very old 3.x data has
  // {current, goal} in hours instead. A task with a last_tick ran: the time
  // since that tick counts, as it did in 3.x. Only the task that ticked last
  // keeps running, and none does when the list already has a running task.
  function fromV3(old, tasks, now, makeId) {
    if (!Array.isArray(old)) return tasks;
    const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
    let list = tasks;
    const added = [];
    for (const o of old) {
      if (!o || typeof o !== 'object') continue;
      const oldHours = o.current_hours === undefined;
      const elapsedMs = oldHours
        ? Math.round(num(o.current) * HOUR)
        : num(o.current_hours) * HOUR + num(o.current_mins) * MINUTE + num(o.current_secs) * SECOND;
      const goal = oldHours
        ? Math.round(num(o.goal) * HOUR)
        : num(o.goal_hours) * HOUR + num(o.goal_mins) * MINUTE;
      const tick = typeof o.last_tick === 'number' ? Math.min(o.last_tick, now) : null;
      const task = {
        id: makeId(),
        name: String(o.text == null ? '' : o.text).trim() || nextName(list),
        elapsedMs,
        startedAt: tick,
        goalMs: o.indefinite || goal <= 0 ? null : goal,
        goalNotified: false,
        done: false,
        createdAt: now,
        lastRunAt: tick,
      };
      task.goalNotified = o.notified === true && goalReached(task, now);
      added.push(task);
      list = [...list, task];
    }

    let keep = null;
    if (!runningTask(tasks)) {
      for (const t of added) if (isRunning(t) && (!keep || t.startedAt > keep.startedAt)) keep = t;
    }
    return list.map(t => (added.includes(t) && t !== keep ? stopped(t, now) : t));
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
    isRunning, shownMs, goalReached, goalTime, runningTask, lastTask, nextName,
    create, start, pause, reset, markDone, remove, removeDone, edit, setGoalNotified, fromV3,
    parseDuration, formatClock, formatShort, badgeText,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
