// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Background script: the toolbar badge and the goal notification.
// Nothing ticks here. Two alarms do the work while a task runs:
//   "badge" at each full minute of the task's time, to update the badge
//   "goal"  at the moment the task reaches its goal

'use strict';

const MINUTE = 60 * 1000;
const BADGE_RUNNING = '#534AB7';
const BADGE_REACHED = '#3B6D11';

async function showBadge(task, now) {
  if (!task) {
    await browser.action.setBadgeText({ text: '' });
    return;
  }
  const reached = Tasks.goalReached(task, now);
  await browser.action.setBadgeText({ text: Tasks.badgeText(Tasks.shownMs(task, now)) });
  await browser.action.setBadgeBackgroundColor({ color: reached ? BADGE_REACHED : BADGE_RUNNING });
  if (browser.action.setBadgeTextColor) await browser.action.setBadgeTextColor({ color: '#ffffff' });
}

// Sets the badge and the alarms from the stored list
async function refresh() {
  const now = Date.now();
  const task = Tasks.runningTask(await Store.loadTasks());
  await Promise.all([browser.alarms.clear('badge'), browser.alarms.clear('goal')]);
  await showBadge(task, now);
  if (!task) return;

  const toNextMinute = MINUTE - (Tasks.shownMs(task, now) % MINUTE);
  browser.alarms.create('badge', { when: now + toNextMinute, periodInMinutes: 1 });

  const goalAt = Tasks.goalTime(task);
  if (goalAt != null && !task.goalNotified) {
    browser.alarms.create('goal', { when: Math.max(goalAt, now) });
  }
}

async function notify(task) {
  if (!browser.notifications || !(await Store.canNotify())) return;
  await browser.notifications.create('goal-' + task.id, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/icon-96.png'),
    title: 'Goal reached',
    message: `"${task.name}" reached its ${Tasks.formatShort(task.goalMs)} goal. The timer keeps counting.`,
  });
}

async function onGoalAlarm() {
  const now = Date.now();
  const tasks = await Store.loadTasks();
  const task = Tasks.runningTask(tasks);
  if (!task || task.goalNotified) return;
  if (!Tasks.goalReached(task, now)) {
    await refresh(); // The alarm came early: set it again
    return;
  }
  // The save calls refresh() through storage.onChanged, and the badge turns green
  await Store.saveTasks(Tasks.setGoalNotified(tasks, task.id));
  await notify(task);
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'goal') onGoalAlarm();
  else if (alarm.name === 'badge') {
    Store.loadTasks().then(tasks => showBadge(Tasks.runningTask(tasks), Date.now()));
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tasks) refresh();
});

browser.runtime.onStartup.addListener(refresh);
// An update from 3.x brings the old tasks. The save calls refresh().
browser.runtime.onInstalled.addListener(() => Store.importV3().finally(refresh));
