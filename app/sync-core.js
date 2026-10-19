// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Sync logic with no Firebase and no browser calls, for app/sync.js and the
// unit tests. The database has one document per task in users/{uid}/tasks:
// the task fields (toDoc), or {deletedAt} for a deleted task. A copy of the
// list is {tasks, deleted}, as in Tasks.merge.

(function (root) {
  'use strict';

  const FIELDS = ['id', 'name', 'elapsedMs', 'startedAt', 'goalMs', 'goalNotified',
    'done', 'createdAt', 'lastRunAt', 'updatedAt'];

  const Tasks = root.Tasks || (typeof require === 'function' ? require('./tasks.js') : null);

  function isTaskData(d) {
    return !!d && typeof d === 'object' && typeof d.id === 'string' && typeof d.name === 'string'
      && typeof d.elapsedMs === 'number';
  }

  function isMarkerData(d) {
    return !!d && typeof d === 'object' && typeof d.deletedAt === 'number';
  }

  // The document of a task: the task fields only. A task saved by 4.1.0 or
  // older has no updatedAt; it gets its createdAt.
  function toDoc(task) {
    const d = {};
    for (const k of FIELDS) d[k] = task[k] === undefined ? null : task[k];
    d.updatedAt = Tasks.changedAt(task);
    return d;
  }

  // The copy {tasks, deleted} in a list of documents [{id, data}]. The
  // newest task comes first, as a new task does in the popup.
  function fromDocs(docs) {
    const tasks = [];
    const deleted = {};
    for (const { id, data } of docs) {
      if (isMarkerData(data)) deleted[id] = data.deletedAt;
      else if (isTaskData(data)) tasks.push(toDoc(data));
    }
    tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { tasks, deleted };
  }

  function sameData(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (a[k] !== b[k]) return false;
    return true;
  }

  // The documents to write so that the database has the merged copy. Writes
  // only what is new or different.
  function writes(merged, remoteDocs) {
    const remote = new Map(remoteDocs.filter(d => d.data).map(d => [d.id, d.data]));
    const out = [];
    for (const t of merged.tasks) {
      const data = toDoc(t);
      const now = remote.get(t.id);
      if (!now || !sameData(now, data)) out.push({ id: t.id, data });
    }
    for (const [id, deletedAt] of Object.entries(merged.deleted)) {
      const now = remote.get(id);
      if (!now || now.deletedAt !== deletedAt) out.push({ id, data: { deletedAt } });
    }
    return out;
  }

  // True when the merge did not change the local copy
  function sameLocal(a, b) {
    return JSON.stringify(a.tasks) === JSON.stringify(b.tasks)
      && sameData(a.deleted, b.deleted);
  }

  // Delete markers older than maxAge can go. A device that was offline for
  // longer than that can bring the deleted task back one time.
  function pruneMarkers(deleted, now, maxAge) {
    const out = {};
    for (const [id, at] of Object.entries(deleted)) if (now - at <= maxAge) out[id] = at;
    return out;
  }

  const api = { FIELDS, toDoc, fromDocs, sameData, writes, sameLocal, pruneMarkers };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
