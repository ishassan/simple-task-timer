// Unit tests for src/tasks.js. Run: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/tasks.js');

const MIN = 60 * 1000;
let ids = 0;
const id = () => 'id' + ++ids;

function names(tasks) {
  return tasks.map(t => t.name);
}

test('a task with no name gets the next "Task N" name', () => {
  let list = T.create([], '', 0, id());
  list = T.create(list, '  ', 1, id());
  list = T.create(list, 'Email', 2, id());
  list = T.create(list, '', 3, id());
  assert.deepEqual(names(list), ['Task 3', 'Email', 'Task 2', 'Task 1']);
});

test('"Task N" uses the highest number, done tasks count, other names do not', () => {
  const list = [
    { name: 'Task 7', done: true },
    { name: 'Task 2' },
    { name: 'Task 9 notes' },
    { name: 'task 20' },
  ];
  assert.equal(T.nextName(list), 'Task 8');
  assert.equal(T.nextName([]), 'Task 1');
});

test('only one task runs: create and start pause the running task', () => {
  let list = T.create([], '', 0, 'a');
  list = T.create(list, '', 10 * MIN, 'b');
  const a = list.find(t => t.id === 'a');
  assert.equal(a.startedAt, null);
  assert.equal(a.elapsedMs, 10 * MIN);
  assert.equal(T.runningTask(list).id, 'b');

  list = T.start(list, 'a', 15 * MIN);
  assert.equal(T.runningTask(list).id, 'a');
  assert.equal(list.filter(T.isRunning).length, 1);
  assert.equal(list.find(t => t.id === 'b').elapsedMs, 5 * MIN);
});

test('time adds up over a pause and over a long closed gap', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.pause(list, 'x', 3 * MIN);
  assert.equal(T.shownMs(list[0], 100 * MIN), 3 * MIN);
  list = T.start(list, 'x', 100 * MIN);
  // Firefox closed for 8 hours: the task keeps counting by the clock
  assert.equal(T.shownMs(list[0], 100 * MIN + 8 * 60 * MIN), 3 * MIN + 8 * 60 * MIN);
});

test('lastTask is the running task, else the task that ran last', () => {
  let list = T.create([], 'a', 0, 'a');
  list = T.create(list, 'b', 10, 'b');
  list = T.start(list, 'a', 20);
  assert.equal(T.lastTask(list).id, 'a');
  list = T.pause(list, 'a', 30);
  assert.equal(T.lastTask(list).id, 'a');
  list = T.markDone(list, 'a', 40);
  assert.equal(T.lastTask(list).id, 'b');
  assert.equal(T.lastTask(T.removeDone(T.markDone(list, 'b', 50))), null);
  assert.equal(T.lastTask([]), null);
});

test('reset sets the time to zero and stops the task', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.edit(list, 'x', { goalMs: MIN }, 0);
  list = T.setGoalNotified(list, 'x');
  list = T.reset(list, 'x');
  assert.equal(list[0].elapsedMs, 0);
  assert.equal(list[0].startedAt, null);
  assert.equal(list[0].goalNotified, false);
});

test('done stops the task and keeps its time; start brings it back', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.markDone(list, 'x', 4 * MIN);
  assert.equal(list[0].done, true);
  assert.equal(list[0].startedAt, null);
  assert.equal(list[0].elapsedMs, 4 * MIN);
  list = T.start(list, 'x', 5 * MIN);
  assert.equal(list[0].done, false);
  assert.equal(T.shownMs(list[0], 6 * MIN), 5 * MIN);
});

test('delete removes one task; delete all done keeps the others', () => {
  let list = T.create([], 'a', 0, 'a');
  list = T.create(list, 'b', 0, 'b');
  list = T.create(list, 'c', 0, 'c');
  list = T.markDone(list, 'a', 1);
  list = T.markDone(list, 'c', 1);
  assert.deepEqual(names(T.removeDone(list)), ['b']);
  assert.deepEqual(names(T.remove(list, 'b')), ['c', 'a']);
});

test('changes do not change the list they get (Undo keeps the old list)', () => {
  const before = T.create([], 'a', 0, 'a');
  const copy = JSON.parse(JSON.stringify(before));
  T.remove(before, 'a');
  T.reset(before, 'a');
  T.markDone(before, 'a', 5);
  T.edit(before, 'a', { name: 'z', elapsedMs: 9, goalMs: 9 }, 5);
  assert.deepEqual(before, copy);
});

test('edit of a running task sets its time from now', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.edit(list, 'x', { elapsedMs: 20 * MIN }, 50 * MIN);
  assert.equal(T.shownMs(list[0], 51 * MIN), 21 * MIN);
  assert.ok(T.isRunning(list[0]));
});

test('edit keeps the old name when the new name is empty', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.edit(list, 'x', { name: '   ' }, 0);
  assert.equal(list[0].name, 'x');
});

test('the goal is reached once, and a higher goal can notify again', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.edit(list, 'x', { goalMs: 25 * MIN }, 0);
  assert.equal(T.goalTime(list[0]), 25 * MIN);
  assert.equal(T.goalReached(list[0], 24 * MIN), false);
  assert.equal(T.goalReached(list[0], 25 * MIN), true);

  list = T.setGoalNotified(list, 'x');
  // A lower goal that is still reached: no second notification
  list = T.edit(list, 'x', { goalMs: 20 * MIN }, 30 * MIN);
  assert.equal(list[0].goalNotified, true);
  // A higher goal: it can notify again
  list = T.edit(list, 'x', { goalMs: 45 * MIN }, 30 * MIN);
  assert.equal(list[0].goalNotified, false);
  // No goal
  list = T.edit(list, 'x', { goalMs: null }, 30 * MIN);
  assert.equal(T.goalTime(list[0]), null);
});

test('a paused task has no goal time', () => {
  let list = T.create([], 'x', 0, 'x');
  list = T.edit(list, 'x', { goalMs: MIN }, 0);
  list = T.pause(list, 'x', 10);
  assert.equal(T.goalTime(list[0]), null);
});

test('parseDuration reads the loose formats', () => {
  const cases = {
    '1:20:00': 80 * MIN,
    '20:00': 20 * MIN,
    '0:30': 30 * 1000,
    '90': 90 * MIN,
    '1.5': 90 * 1000,
    '45m': 45 * MIN,
    '45 min': 45 * MIN,
    '1h': 60 * MIN,
    '1h 5m': 65 * MIN,
    '1h5m': 65 * MIN,
    '1.5h': 90 * MIN,
    '2 hours 3 minutes': 123 * MIN,
    '30s': 30 * 1000,
    '1H 5M': 65 * MIN,
  };
  for (const [text, ms] of Object.entries(cases)) assert.equal(T.parseDuration(text), ms, text);
  assert.equal(T.parseDuration(''), null);
  assert.equal(T.parseDuration('   '), null);
  for (const bad of ['abc', '1:70', '1x', '5 m s', 'h', '1ms', '-5', '1::2']) {
    assert.ok(Number.isNaN(T.parseDuration(bad)), bad);
  }
});

test('formats', () => {
  assert.equal(T.formatClock(0), '0:00:00');
  assert.equal(T.formatClock(27 * MIN + 41 * 1000 + 999), '0:27:41');
  assert.equal(T.formatClock(125 * 60 * MIN), '125:00:00');
  assert.equal(T.formatShort(25 * MIN), '25m');
  assert.equal(T.formatShort(60 * MIN), '1h');
  assert.equal(T.formatShort(65 * MIN), '1h 5m');
  assert.equal(T.formatShort(45 * 1000), '45s');
  assert.equal(T.badgeText(59 * 1000), '0m');
  assert.equal(T.badgeText(25 * MIN), '25m');
  assert.equal(T.badgeText(65 * MIN), '1:05');
  assert.equal(T.badgeText(12 * 60 * MIN + 30 * MIN), '12h');
});
