// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The popup: the only page of the add-on.

'use strict';

const $ = id => document.getElementById(id);
const UNDO_MS = 6000;

let tasks = [];
let editingId = null;   // the task whose edit area is open
let canNotify = false;
let promptDismissed = false;
let toastTimer = null;
let undoList = null;
let rowKeys = Keys.DEFAULT_KEYS;  // the keys that act on a focused row
let openShortcut = '';            // the Firefox shortcut that opens the popup
let isMac = false;

// ---- Changes ----

// Applies fn(list, now) to the stored list and shows the result at once.
// With a message, shows an Undo toast that puts back the old list.
async function act(fn, message) {
  const { before, after } = await Store.change(fn);
  tasks = after;
  render();
  if (message) showToast(message, before);
}

function startNew(name) {
  return act((list, now) => Tasks.create(list, name, now, crypto.randomUUID()));
}

function quoted(id) {
  const t = tasks.find(x => x.id === id);
  return t ? `"${t.name}"` : 'Task';
}

const actions = {
  toggle(id) {
    const t = tasks.find(x => x.id === id);
    if (t && Tasks.isRunning(t)) return act((list, now) => Tasks.pause(list, id, now));
    return act((list, now) => Tasks.start(list, id, now));
  },
  reset(id) {
    return act(list => Tasks.reset(list, id), `Reset ${quoted(id)}`);
  },
  done(id) {
    return act((list, now) => Tasks.markDone(list, id, now), `${quoted(id)} is done`);
  },
  delete(id) {
    if (editingId === id) editingId = null;
    return act(list => Tasks.remove(list, id), `Deleted ${quoted(id)}`);
  },
};

// ---- Undo toast ----

function showToast(message, before) {
  undoList = before;
  $('toast-text').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, UNDO_MS);
}

function hideToast() {
  $('toast').hidden = true;
  undoList = null;
}

async function undo() {
  if (!undoList) return;
  const list = undoList;
  hideToast();
  await Store.saveTasks(list);
  tasks = list;
  render();
}

// ---- Drawing ----

// A tooltip with the action and its key: "Reset (R)"
function setTip(button, label, action) {
  button.title = `${label} (${Keys.keyHint(rowKeys[action])})`;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-keyshortcuts', Keys.keyLabel(rowKeys[action]));
}

function setToggle(button, running) {
  setTip(button, running ? 'Pause' : 'Start', 'toggle');
  button.querySelector('use').setAttribute('href', running ? '#i-pause' : '#i-play');
}

// Updates the parts of a row that change every second
function paintRow(li, task, now) {
  const running = Tasks.isRunning(task);
  const reached = Tasks.goalReached(task, now);
  li.classList.toggle('running', running);
  li.classList.toggle('reached', reached);
  li.querySelector('.time').textContent = Tasks.formatClock(Tasks.shownMs(task, now));
  const toggle = li.querySelector('.toggle');
  if (!task.done) setToggle(toggle, running);

  const goal = li.querySelector('.goal');
  if (!goal) return;
  goal.hidden = task.goalMs == null;
  if (task.goalMs == null) return;
  const part = task.goalMs > 0 ? Math.min(1, Tasks.shownMs(task, now) / task.goalMs) : 1;
  goal.querySelector('.fill').style.width = (part * 100).toFixed(1) + '%';
  goal.querySelector('.goal-text').textContent =
    'goal ' + Tasks.formatShort(task.goalMs) + (reached ? ' reached' : '');
}

function makeRow(task, templateId, now) {
  const li = $(templateId).content.firstElementChild.cloneNode(true);
  li.dataset.id = task.id;
  li.tabIndex = -1; // the arrow keys move the focus between rows
  li.querySelector('.name').textContent = task.name;
  li.querySelector('.name').title = task.name;
  if (task.done) setTip(li.querySelector('.toggle'), 'Start again', 'toggle');
  for (const [cls, label] of [['reset', 'Reset'], ['done', 'Done'], ['delete', 'Delete']]) {
    const button = li.querySelector('.' + cls);
    if (button) setTip(button, label, cls);
  }
  paintRow(li, task, now);
  return li;
}

// A field of the edit area: name, time or goal
function field(form, key) {
  return form.querySelector(`[name="${key}"]`);
}

// Reads what the user typed in the open edit area, so a redraw keeps it
function readEdit() {
  const form = document.querySelector('form.edit');
  if (!form) return null;
  const active = document.activeElement;
  return {
    id: form.closest('.task').dataset.id,
    values: { name: field(form, 'name').value, time: field(form, 'time').value, goal: field(form, 'goal').value },
    initial: form.initial,
    focus: active && active.form === form ? active.name : null,
  };
}

function openEdit(li, task, kept) {
  const form = $('edit-template').content.firstElementChild.cloneNode(true);
  const initial = {
    name: task.name,
    time: Tasks.formatClock(Tasks.shownMs(task, Date.now())),
    goal: task.goalMs == null ? '' : Tasks.formatShort(task.goalMs),
  };
  form.initial = kept ? kept.initial : initial;
  const values = kept ? kept.values : initial;
  field(form, 'name').value = values.name;
  field(form, 'time').value = values.time;
  field(form, 'goal').value = values.goal;
  li.appendChild(form);

  form.addEventListener('submit', e => {
    e.preventDefault();
    saveEdit(form, task.id);
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEdit();
    }
  });
  form.addEventListener('input', () => { form.querySelector('.error').hidden = true; });
  for (const chip of form.querySelectorAll('[data-goal]')) {
    chip.addEventListener('click', () => {
      field(form, 'goal').value = chip.dataset.goal;
      saveEdit(form, task.id);
    });
  }

  const start = kept && kept.focus ? kept.focus : 'name';
  field(form, start).focus();
  if (!kept) field(form, start).select();
}

function closeEdit() {
  const id = editingId;
  editingId = null;
  render();
  focusTask(id);
}

function saveEdit(form, id) {
  const error = form.querySelector('.error');
  const changes = { name: field(form, 'name').value };

  // A field the user did not change does not change the task. Then the
  // time of a running task does not go back to the time the form opened with.
  if (field(form, 'time').value.trim() !== form.initial.time) {
    const ms = Tasks.parseDuration(field(form, 'time').value);
    if (ms == null || Number.isNaN(ms)) {
      error.textContent = 'Write the time like 1:20:00, 45m or 1h 5m.';
      error.hidden = false;
      field(form, 'time').focus();
      return;
    }
    changes.elapsedMs = ms;
  }
  if (field(form, 'goal').value.trim() !== form.initial.goal) {
    const ms = Tasks.parseDuration(field(form, 'goal').value);
    if (Number.isNaN(ms) || ms === 0) {
      error.textContent = 'Write the goal like 25m, 1h or 1:30:00, or leave it empty.';
      error.hidden = false;
      field(form, 'goal').focus();
      return;
    }
    changes.goalMs = ms;
  }

  editingId = null;
  act((list, now) => Tasks.edit(list, id, changes, now)).then(() => focusTask(id));
}

// ---- Keyboard focus ----

// The rows the arrow keys can reach: the list, and the Done group when open
function focusableRows() {
  return [...document.querySelectorAll('#list .task, #done-group[open] #done-list .task')];
}

function focusTask(id) {
  const li = id && document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
  if (li) li.focus();
  else $('name').focus();
}

function focusRow(index) {
  const rows = focusableRows();
  if (index < 0 || rows.length === 0) $('name').focus();
  else rows[Math.min(index, rows.length - 1)].focus();
}

function render() {
  const now = Date.now();
  const kept = readEdit();
  const focused = document.activeElement;
  const focusedId = focused && focused.classList && focused.classList.contains('task') ? focused.dataset.id : null;
  const focusedIndex = focusedId ? focusableRows().indexOf(focused) : -1;
  if (editingId && !tasks.some(t => t.id === editingId && !t.done)) editingId = null;

  const active = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  const list = $('list');
  list.replaceChildren(...active.map(t => makeRow(t, 'row-template', now)));
  $('empty').hidden = active.length > 0;

  $('done-group').hidden = done.length === 0;
  $('done-title').textContent = `Done (${done.length})`;
  $('done-list').replaceChildren(...done.map(t => makeRow(t, 'done-template', now)));

  $('name').placeholder = Tasks.nextName(tasks);

  if (editingId) {
    const li = list.querySelector(`[data-id="${CSS.escape(editingId)}"]`);
    const task = tasks.find(t => t.id === editingId);
    openEdit(li, task, kept && kept.id === editingId ? kept : null);
  } else if (focusedId) {
    // Keep the keyboard focus on the same task, or on the row that took its place
    const li = document.querySelector(`.task[data-id="${CSS.escape(focusedId)}"]`);
    if (li && focusableRows().includes(li)) li.focus();
    else focusRow(focusedIndex);
  }
  renderPrompt();
}

function renderPrompt() {
  const hasGoal = tasks.some(t => t.goalMs != null);
  $('notify-prompt').hidden = !hasGoal || canNotify || promptDismissed;
}

function tick() {
  const now = Date.now();
  for (const li of document.querySelectorAll('.task')) {
    const task = tasks.find(t => t.id === li.dataset.id);
    if (task) paintRow(li, task, now);
  }
}

// ---- Keys ----

// Space in the empty name field pauses or resumes the last task
function toggleLast() {
  const task = Tasks.lastTask(tasks);
  if (task) actions.toggle(task.id);
}

function onKey(e) {
  if (e.defaultPrevented || e.altKey) return;
  const target = e.target;
  const inText = target instanceof HTMLInputElement;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !inText) {
    if (undoList) {
      e.preventDefault();
      undo();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) return;

  if (target === $('name')) {
    if (e.key === ' ' && $('name').value === '') {
      e.preventDefault();
      toggleLast();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(0);
    }
    return;
  }

  // The rest works on a focused row (not on its buttons or its edit area)
  if (!target.classList || !target.classList.contains('task')) return;
  const id = target.dataset.id;
  const inDone = !!target.closest('#done-list');
  const index = focusableRows().indexOf(target);
  const key = Keys.keyOf(e);
  // Arrows, Enter and Escape are fixed. The other keys come from Preferences.
  const action = key === 'Enter' ? 'edit' : Keys.actionFor(rowKeys, key);
  if (key === 'ArrowDown') focusRow(index + 1);
  else if (key === 'ArrowUp') focusRow(index - 1);
  else if (key === 'Escape') $('name').focus();
  else if (action === 'toggle') actions.toggle(id);
  else if (action === 'edit') {
    if (!inDone) {
      editingId = id;
      render();
    }
  } else if (action === 'reset') {
    if (!inDone) actions.reset(id);
  } else if (action === 'done') {
    if (!inDone) actions.done(id);
  } else if (action === 'delete') actions.delete(id);
  else return;
  e.preventDefault();
}

// The shortcut that opens the popup also closes it. Firefox does this when
// the focus is not in a text field. In a text field, the field takes the key
// and types it (Option+W types "∑" on a Mac), so the popup closes itself.
function onShortcut(e) {
  const t = e.target;
  const inText = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable;
  if (!inText || !Keys.matchesShortcut(e, openShortcut, isMac)) return;
  e.preventDefault();
  e.stopPropagation();
  window.close();
}

// Firefox for Android has no keyboard shortcuts for add-ons
async function loadShortcut() {
  if (!browser.commands || !browser.commands.getAll) return '';
  const cmd = (await browser.commands.getAll()).find(c => c.name === '_execute_action');
  return cmd && cmd.shortcut ? cmd.shortcut : '';
}

// ---- Events ----

function wire() {
  document.addEventListener('keydown', onShortcut, true);
  document.addEventListener('keydown', onKey);
  if (browser.commands && browser.commands.onChanged) {
    browser.commands.onChanged.addListener(c => {
      if (c.name === '_execute_action') openShortcut = c.newShortcut || '';
    });
  }
  // The Preferences page sends this after a reset (Firefox sends no onChanged)
  browser.runtime.onMessage.addListener(m => {
    if (m === 'shortcut-reset') loadShortcut().then(s => { openShortcut = s; });
  });

  $('new-task').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('name').value;
    $('name').value = '';
    editingId = null;
    startNew(name).then(() => $('name').focus());
  });

  function onListClick(e) {
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;
    const button = e.target.closest('button');
    if (button && button.closest('.line')) {
      for (const name of Object.keys(actions)) {
        if (button.classList.contains(name)) return actions[name](id);
      }
      return;
    }
    // A click on the row (not a button, not the edit area) opens or closes the edit area
    if (e.target.closest('.line') && li.closest('#list')) {
      editingId = editingId === id ? null : id;
      render();
    }
  }
  $('list').addEventListener('click', onListClick);
  $('done-list').addEventListener('click', onListClick);

  $('delete-done').addEventListener('click', e => {
    e.preventDefault(); // do not open or close the group
    e.stopPropagation();
    const count = tasks.filter(t => t.done).length;
    act(list => Tasks.removeDone(list), `Deleted ${count} done ${count === 1 ? 'task' : 'tasks'}`);
  });

  $('undo').addEventListener('click', undo);

  $('notify-on').addEventListener('click', () => {
    // permissions.request must run in the click, before any await
    Store.askToNotify().then(granted => {
      canNotify = granted;
      renderPrompt();
    });
  });
  $('notify-later').addEventListener('click', () => {
    promptDismissed = true;
    renderPrompt();
    Store.dismissPrompt();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tasks) {
      tasks = changes.tasks.newValue || [];
      render();
    }
    if (area === 'local' && changes.keys) {
      rowKeys = Keys.withDefaults(changes.keys.newValue);
      render();  // the tooltips show the keys
    }
  });
  browser.permissions.onAdded.addListener(() => Store.canNotify().then(v => { canNotify = v; renderPrompt(); }));
  browser.permissions.onRemoved.addListener(() => Store.canNotify().then(v => { canNotify = v; renderPrompt(); }));
}

async function init() {
  wire();
  // On a phone, the keyboard would cover the list, so do not focus there
  if (!matchMedia('(pointer: coarse)').matches) $('name').focus();
  let platform;
  [tasks, canNotify, promptDismissed, platform, rowKeys, openShortcut] = await Promise.all([
    Store.loadTasks(), Store.canNotify(), Store.promptDismissed(), browser.runtime.getPlatformInfo(),
    Store.loadKeys(), loadShortcut(),
  ]);
  isMac = platform.os === 'mac';
  // Firefox for Android shows the popup as a full page. Some devices do not
  // report a touch pointer, so the platform sets the phone layout.
  $('undo').title = `Undo (${isMac ? 'Command' : 'Ctrl'}+Z)`;
  if (platform.os === 'android') {
    document.documentElement.classList.add('android');
    $('name').blur();
  }
  render();
  setInterval(tick, 1000);
}

init();
