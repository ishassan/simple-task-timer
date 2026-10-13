#!/usr/bin/env python3
"""Test the add-on in headless Firefox: the task buttons, Undo, the goal,
the badge and the optional notification.

Usage:
    pip install selenium
    python3 ci/goal_test.py [path to the add-on src folder]

Set FIREFOX_BIN to use a Firefox that is not in the usual place.
Run by .github/workflows/goal-test.yml.

The script copies the add-on and adds two test scripts to the copy:
- test-bg.js (background): records each notification the add-on creates and
  opens popup.html in a background tab.
- test-harness.js (popup.html): clicks the buttons, reads the stored tasks
  and the badge, and sends the results by HTTP POST to a local server in
  this script. WebDriver cannot run scripts in moz-extension pages, so the
  results come back this way.

Phase A runs with no notification permission. Then the script grants the
optional "notifications" permission from the privileged browser context
(geckodriver --allow-system-access), and phase B checks the notification.

Firefox runs headless with a temporary profile, the sound muted and the
system notification banners off, so nothing shows on the screen. On macOS,
Firefox started by an app that cannot read Firefox's data folder stops at
once, so the script starts it with "open -g" and connects to it. On macOS
the script also checks that no app it started came to the front.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src')
ADDON_ID = '{5f590989-34a7-4c7a-b219-5de25a64db43}'
UUID = '11111111-2222-3333-4444-555555555555'
MAC = sys.platform == 'darwin'

PREFS = {
    'extensions.webextensions.uuids': json.dumps({ADDON_ID: UUID}),
    'media.volume_scale': '0.0',          # no sound
    'alerts.useSystemBackend': False,     # no system notification banners
    'alerts.totalOpenTime': 120000,
    'browser.shell.checkDefaultBrowser': False,
    'browser.startup.homepage_override.mstone': 'ignore',
    'datareporting.policy.dataSubmissionEnabled': False,
    'app.update.disabledForTesting': True,
}

TEST_BG_JS = '''
const testNotes = [];
function testHook() {
  if (!browser.notifications || browser.notifications.testHooked) return;
  const create = browser.notifications.create.bind(browser.notifications);
  browser.notifications.create = (id, o) => {
    testNotes.push({id, title: o.title, message: o.message});
    return create(id, o);
  };
  browser.notifications.testHooked = true;
}
testHook();
browser.permissions.onAdded.addListener(testHook);
browser.runtime.onMessage.addListener(m => m === 'test-notes' ? Promise.resolve(testNotes) : undefined);
browser.tabs.create({url: 'popup.html', active: false});
'''

HARNESS_JS = '''
(async function () {
  const PORT = %d;
  const post = d => fetch('http://127.0.0.1:' + PORT + '/result', {method: 'POST', mode: 'no-cors', body: JSON.stringify(d)});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errs = [];
  window.addEventListener('error', e => errs.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => errs.push(String(e.reason)));
  const checks = [];
  const check = (name, cond, detail) => checks.push({name, ok: !!cond, detail: detail === undefined ? '' : JSON.stringify(detail)});
  const load = async () => (await browser.storage.local.get({tasks: []})).tasks;
  const task = async name => (await load()).find(t => t.name === name);
  const row = (name, where) => [...document.querySelectorAll((where || '#list') + ' .task')]
    .find(li => li.querySelector('.name').textContent === name);
  const visible = id => !document.getElementById(id).hidden;
  async function until(fn, ms) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
    return null;
  }
  async function submitNew(name) {
    const before = (await load()).length;
    document.getElementById('name').value = name;
    document.getElementById('new-task').requestSubmit();
    await until(async () => (await load()).length > before);
    await sleep(100);
  }
  async function edit(name, values) {
    row(name).querySelector('.name').click();
    await sleep(100);
    const form = document.querySelector('form.edit');
    for (const [k, v] of Object.entries(values)) form.querySelector('[name="' + k + '"]').value = v;
    form.requestSubmit();
    await sleep(300);
    return form;
  }
  const notes = () => browser.runtime.sendMessage('test-notes');

  try {
    await sleep(500);
    await browser.storage.local.clear();
    await sleep(300);

    // ---- Phase A: no notification permission ----
    check('the list starts empty and shows the empty line', visible('empty') && (await load()).length === 0);
    check('the name field shows the next name', document.getElementById('name').placeholder === 'Task 1',
          document.getElementById('name').placeholder);

    await submitNew('');
    let list = await load();
    check('Start with no name makes "Task 1" and it runs',
          list.length === 1 && list[0].name === 'Task 1' && list[0].startedAt != null, list);
    check('the running row is marked running', row('Task 1') && row('Task 1').classList.contains('running'));

    await submitNew('');
    list = await load();
    check('a second start makes "Task 2" at the top', list[0].name === 'Task 2', list.map(t => t.name));
    check('"Task 2" runs and "Task 1" is paused',
          list[0].startedAt != null && list[1].startedAt == null && list[1].elapsedMs > 0, list);

    await submitNew('Write report');
    check('Enter with a name makes and starts that task', (await task('Write report')).startedAt != null);

    row('Task 1').querySelector('.toggle').click();
    await sleep(300);
    list = await load();
    check('Start on a row runs it and pauses the others',
          list.filter(t => t.startedAt != null).map(t => t.name).join() === 'Task 1', list);
    row('Task 1').querySelector('.toggle').click();
    await sleep(300);
    check('Pause stops the task', (await task('Task 1')).startedAt == null);
    row('Task 1').querySelector('.toggle').click();
    await sleep(300);

    row('Task 1').querySelector('.reset').click();
    await sleep(300);
    let t1 = await task('Task 1');
    check('Reset sets the time to zero and stops the task', t1.elapsedMs === 0 && t1.startedAt == null, t1);
    check('Reset shows an Undo toast', visible('toast') &&
          document.getElementById('toast-text').textContent === 'Reset "Task 1"');
    document.getElementById('undo').click();
    await sleep(300);
    t1 = await task('Task 1');
    check('Undo brings back the running task', t1.startedAt != null, t1);
    check('Undo hides the toast', !visible('toast'));

    row('Task 2').querySelector('.done').click();
    await sleep(300);
    check('Done moves the task to the Done group', (await task('Task 2')).done === true &&
          !row('Task 2') && row('Task 2', '#done-list') && visible('done-group') &&
          document.getElementById('done-title').textContent === 'Done (1)');
    row('Task 2', '#done-list').querySelector('.toggle').click();
    await sleep(300);
    let t2 = await task('Task 2');
    check('Start on a done task brings it back and runs it', !t2.done && t2.startedAt != null && row('Task 2'), t2);

    row('Task 2').querySelector('.delete').click();
    await sleep(300);
    check('Delete removes a running task', !(await task('Task 2')) && !row('Task 2'));
    document.getElementById('undo').click();
    await sleep(300);
    check('Undo brings back the deleted task', !!(await task('Task 2')) && !!row('Task 2'));

    row('Task 2').querySelector('.done').click();
    await sleep(200);
    row('Write report').querySelector('.done').click();
    await sleep(200);
    document.getElementById('delete-done').click();
    await sleep(300);
    list = await load();
    check('Delete all removes only the done tasks', list.map(t => t.name).join() === 'Task 1', list.map(t => t.name));
    document.getElementById('undo').click();
    await sleep(300);
    check('Undo brings back the done tasks', (await load()).filter(t => t.done).length === 2);
    check('the next name counts done tasks', document.getElementById('name').placeholder === 'Task 3',
          document.getElementById('name').placeholder);

    // ---- Keys ----
    const key = (el, k, more) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({key: k, bubbles: true, cancelable: true}, more || {})));
    const nameField = document.getElementById('name');
    const focusedName = () => document.activeElement && document.activeElement.classList.contains('task')
      ? document.activeElement.querySelector('.name').textContent : (document.activeElement || {}).id;
    nameField.focus();
    key(nameField, ' ');
    await sleep(300);
    check('Space in the empty name field resumes the last task', (await task('Task 1')).startedAt != null);
    key(nameField, ' ');
    await sleep(300);
    check('Space in the empty name field pauses the running task', (await task('Task 1')).startedAt == null &&
          nameField.value === '');
    key(nameField, 'ArrowDown');
    check('Down arrow in the name field goes to the first row', focusedName() === 'Task 1', focusedName());
    key(document.activeElement, ' ');
    await sleep(300);
    check('Space on a row starts it, and the row keeps the focus',
          (await task('Task 1')).startedAt != null && focusedName() === 'Task 1', focusedName());
    key(document.activeElement, 'r');
    await sleep(300);
    check('R resets the row', (await task('Task 1')).elapsedMs === 0 && (await task('Task 1')).startedAt == null);
    key(document.activeElement, 'z', {ctrlKey: true});
    await sleep(300);
    check('Ctrl+Z is Undo', (await task('Task 1')).startedAt != null && !visible('toast'));
    key(document.activeElement, 'e');
    await sleep(200);
    const keyForm = document.querySelector('form.edit');
    check('E opens the edit area', !!keyForm && keyForm.closest('.task').dataset.id === (await task('Task 1')).id);
    key(document.activeElement, 'Escape');
    await sleep(200);
    check('Escape closes the edit area and goes back to the row',
          !document.querySelector('form.edit') && focusedName() === 'Task 1', focusedName());
    key(document.activeElement, ' ');
    await sleep(300);
    check('Space on a row pauses it', (await task('Task 1')).startedAt == null);
    key(document.activeElement, 'ArrowUp');
    check('Up arrow on the first row goes back to the name field', document.activeElement === nameField);

    let form = await edit('Task 1', {goal: 'abc'});
    check('a bad goal shows an error and is not saved',
          !form.querySelector('.error').hidden && (await task('Task 1')).goalMs == null);
    form.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await sleep(200);
    check('Escape closes the edit area', !document.querySelector('form.edit'));

    await edit('Task 1', {name: 'Goal A', time: '0:00', goal: '0:03'});
    t1 = await task('Goal A');
    check('edit saves the name, the time and the goal',
          t1 && t1.goalMs === 3000 && t1.elapsedMs === 0, t1);
    row('Goal A').querySelector('.toggle').click();
    await sleep(200);
    check('a goal with no permission shows the notification question', visible('notify-prompt'));

    const reached = await until(async () => (await task('Goal A')).goalNotified, 8000);
    check('the background marks the goal as reached', !!reached);
    const s1 = (await task('Goal A'));
    await sleep(1500);
    const s2 = (await task('Goal A'));
    const shown = t => t.elapsedMs + (t.startedAt != null ? Date.now() - t.startedAt : 0);
    check('the task keeps counting after the goal', s2.startedAt != null && shown(s2) > 3000, shown(s2));
    const color = await browser.action.getBadgeBackgroundColor({});
    check('the badge turns green at the goal', color.slice(0, 3).join() === '59,109,17', color);
    check('the badge shows the time', (await browser.action.getBadgeText({})) === '0m',
          await browser.action.getBadgeText({}));
    check('the row shows the goal is reached', row('Goal A').classList.contains('reached') &&
          row('Goal A').querySelector('.goal-text').textContent === 'goal 3s reached',
          row('Goal A').querySelector('.goal-text').textContent);
    check('no notification without the permission', (await notes()).length === 0, await notes());

    document.getElementById('notify-later').click();
    await sleep(300);
    check('"Not now" hides the question and remembers it', !visible('notify-prompt') &&
          (await browser.storage.local.get('notifyPromptDismissed')).notifyPromptDismissed === true);

    await post({phase: 'a', version: browser.runtime.getManifest().version, checks: checks.splice(0), errs: errs.slice()});

    // ---- Phase B: the test grants the permission ----
    await until(() => browser.permissions.contains({permissions: ['notifications']}), 30000);
    await submitNew('Goal B');
    await edit('Goal B', {time: '0:00', goal: '0:02'});
    await until(async () => (await task('Goal B')).goalNotified, 8000);
    await sleep(3000);
    const sent = (await notes()).filter(n => n.message.includes('"Goal B"'));
    check('exactly one notification at the goal', sent.length === 1, await notes());
    check('the notification says the goal is reached', sent[0] && sent[0].title === 'Goal reached' &&
          sent[0].message === '"Goal B" reached its 2s goal. The timer keeps counting.', sent);
    const all = browser.notifications ? Object.keys(await browser.notifications.getAll()) : null;
    check('Firefox accepted the notification', all && all.length === 1, all);
    check('the task still runs after the notification', (await task('Goal B')).startedAt != null);
  } catch (e) {
    errs.push('harness: ' + (e && e.stack || e));
  }
  await post({phase: 'b', checks, errs});
})();
'''

result = {}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        result[data['phase']] = data
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        pass


GRANT_JS = '''
const [id, done] = arguments;
const {ExtensionPermissions} = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
const policy = WebExtensionPolicy.getByID(id);
ExtensionPermissions.add(id, {permissions: ['notifications'], origins: []}, policy.extension)
  .then(() => done(true), e => done(String(e)));
'''


def running_apps():
    out = subprocess.run(['lsappinfo', 'list'], capture_output=True, text=True).stdout
    return set(re.findall(r'ASN:0x[0-9a-f]+-0x[0-9a-f]+', out))


def front_app():
    asn = subprocess.run(['lsappinfo', 'front'], capture_output=True, text=True).stdout.strip()
    out = subprocess.run(['lsappinfo', 'info', '-only', 'name', asn],
                         capture_output=True, text=True).stdout
    return out.split('\n')[0].split('(')[0].strip()  # app name and ASN


def wait_for(phase, seconds):
    for _ in range(seconds * 4):
        if phase in result:
            return result[phase]
        time.sleep(0.25)
    return None


def build_xpi(port):
    work = tempfile.mkdtemp()
    src = os.path.join(work, 'src')
    shutil.copytree(SRC, src, ignore=shutil.ignore_patterns('.amo-upload-uuid'))
    with open(os.path.join(src, 'test-bg.js'), 'w') as f:
        f.write(TEST_BG_JS)
    with open(os.path.join(src, 'test-harness.js'), 'w') as f:
        f.write(HARNESS_JS % port)

    manifest_path = os.path.join(src, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)
    manifest['background']['scripts'].append('test-bg.js')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f)

    html_path = os.path.join(src, 'popup.html')
    with open(html_path, encoding='utf-8') as f:
        html = f.read()
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html.replace('</body>', '<script src="test-harness.js"></script></body>', 1))

    xpi = os.path.join(work, 'addon.xpi')
    with zipfile.ZipFile(xpi, 'w') as z:
        for root, _, files in os.walk(src):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, src))
    return xpi


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_firefox():
    """Returns (driver, profile folder or None)."""
    if not MAC:
        opts = Options()
        if os.environ.get('FIREFOX_BIN'):
            opts.binary_location = os.environ['FIREFOX_BIN']
        opts.add_argument('-headless')
        for k, v in PREFS.items():
            opts.set_preference(k, v)
        service = Service(service_args=['--allow-system-access'])
        return webdriver.Firefox(options=opts, service=service), None

    profile = tempfile.mkdtemp(prefix='stt-test-profile-')
    port = free_port()
    prefs = dict(PREFS, **{'marionette.port': port})
    with open(os.path.join(profile, 'user.js'), 'w') as f:
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    app = os.environ.get('FIREFOX_BIN', '/Applications/Firefox.app')
    app = re.sub(r'/Contents/MacOS/firefox$', '', app)
    subprocess.run(['open', '-g', '-n', '-a', app, '--args', '--headless', '--no-remote',
                    '--profile', profile, '--marionette', '-remote-allow-system-access'], check=True)
    for _ in range(60):
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                break
        time.sleep(0.5)
    service = Service(service_args=['--connect-existing', '--marionette-port', str(port),
                                    '--allow-system-access'])
    return webdriver.Firefox(options=Options(), service=service), profile


def main():
    with open(os.path.join(SRC, 'manifest.json')) as f:
        manifest = json.load(f)

    server = HTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    apps_before = running_apps() if MAC else set()
    fronts = [front_app()] if MAC else []
    profile = None
    granted = None
    try:
        driver, profile = start_firefox()
        try:
            driver.install_addon(build_xpi(port), temporary=True)
            time.sleep(2)
            if MAC:
                fronts.append(front_app())
            if wait_for('a', 60):
                with driver.context(driver.CONTEXT_CHROME):
                    granted = driver.execute_async_script(GRANT_JS, ADDON_ID)
                wait_for('b', 40)
        finally:
            if MAC:
                fronts.append(front_app())
            driver.quit()
    finally:
        if profile:
            subprocess.run(['pkill', '-f', profile])
            shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()

    results, ok = [], True

    def check(name, cond, detail=''):
        nonlocal ok
        ok &= bool(cond)
        line = ('PASS' if cond else 'FAIL') + '  ' + name
        if detail != '':
            line += '  (' + str(detail) + ')'
        results.append(line)

    check('a shortcut opens the popup (Alt+W)',
          manifest.get('commands', {}).get('_execute_action', {}).get('suggested_key', {}).get('default') == 'Alt+W')
    check('notifications is only an optional permission',
          'notifications' not in manifest.get('permissions', []) and
          'notifications' in manifest.get('optional_permissions', []))
    a, b = result.get('a'), result.get('b')
    if not a:
        results.append('FAIL  no result from phase A')
        ok = False
    for phase in (a, b):
        if not phase:
            continue
        for c in phase['checks']:
            check(c['name'], c['ok'], '' if c['ok'] else c['detail'])
    check('the test granted the notification permission', granted is True, granted)
    if not b:
        results.append('FAIL  no result from phase B')
        ok = False
    errs = (a or {}).get('errs', []) + (b or {}).get('errs', [])
    check('no script errors', not errs, errs)
    if MAC:
        asns = [re.search(r'ASN:0x[0-9a-f]+-0x[0-9a-f]+', f) for f in fronts]
        new_front = [x.group(0) for x in asns if x and x.group(0) not in apps_before]
        check('no app started by the test came to the front', not new_front, ' | '.join(fronts))

    if a:
        print('add-on version under test:', a['version'])
    print('\n'.join(results))
    print('RESULT:', 'ALL PASS' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
