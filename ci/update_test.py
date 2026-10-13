#!/usr/bin/env python3
"""Test the update from 3.11.0 to this version in headless Firefox: the
tasks made in 3.11.0 must show in the new version.

Usage:
    pip install selenium
    python3 ci/update_test.py [path to the add-on src folder]

The 3.11.0 code comes from the git tag v3.11.0. Set FIREFOX_BIN to use a
Firefox that is not in the usual place. Run by .github/workflows/goal-test.yml.

Steps:
1. Install 3.11.0 with a test script in its main page. The script makes two
   tasks with the 3.11.0 buttons ("Old report" with a 30 minute goal, started;
   "Old email" with no goal, not started) and sends the stored data back.
2. Install this version over it (an update, the same add-on ID). A test
   script in the popup sends back the stored tasks and the rows it shows.
3. Install this version again. The tasks must not be added a second time.

Firefox runs as in goal_test.py: headless, temporary profile, no focus.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from goal_test import MAC, front_app, running_apps, start_firefox  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src')
OLD_REF = 'v3.11.0'

OLD_BG_JS = '''
browser.tabs.create({url: 'main.html', active: false});
'''

OLD_HARNESS_JS = '''
(async function () {
  const PORT = %d;
  const post = d => fetch('http://127.0.0.1:' + PORT + '/result', {method: 'POST', mode: 'no-cors', body: JSON.stringify(d)});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errs = [];
  window.addEventListener('error', e => errs.push(String(e.message)));
  const $ = id => document.getElementById(id);
  // 3.11.0 shows alert() and confirm() boxes at start. They would stop the page.
  window.alert = () => {};
  window.confirm = () => false;
  try {
    for (let i = 0; i < 100 && $('new-btn').disabled; i++) await sleep(100);
    await sleep(500);
    function add(text, hours, mins, indefinite, start) {
      $('new-txt').value = text;
      $('new-goal-hours').value = hours;
      $('new-goal-mins').value = mins;
      $('new-goal-indef').checked = indefinite;
      $('new-start').checked = start;
      $('new-btn').click();
    }
    add('Old report', 0, 30, false, true);
    await sleep(300);
    add('Old email', 0, 0, true, false);
    await sleep(2500);
  } catch (e) {
    errs.push('old harness: ' + (e && e.stack || e));
  }
  await post({phase: 'old', version: browser.runtime.getManifest().version,
              tasks: localStorage.getItem('tasks'), errs});
})();
'''

NEW_BG_JS = '''
browser.tabs.create({url: 'popup.html', active: false});
'''

NEW_HARNESS_JS = '''
(async function () {
  const PORT = %d;
  const post = d => fetch('http://127.0.0.1:' + PORT + '/result', {method: 'POST', mode: 'no-cors', body: JSON.stringify(d)});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errs = [];
  window.addEventListener('error', e => errs.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => errs.push(String(e.reason)));
  const load = async () => (await browser.storage.local.get({tasks: []})).tasks;
  for (let i = 0; i < 50 && (await load()).length < 2; i++) await sleep(100);
  await sleep(1000);
  await post({
    phase: 'new',
    version: browser.runtime.getManifest().version,
    tasks: await load(),
    imported: (await browser.storage.local.get('v3Imported')).v3Imported,
    rows: [...document.querySelectorAll('#list .task')].map(li => ({
      name: li.querySelector('.name').textContent,
      running: li.classList.contains('running'),
      goal: li.querySelector('.goal').hidden ? null : li.querySelector('.goal-text').textContent,
    })),
    badge: await browser.action.getBadgeText({}),
    now: Date.now(),
    errs,
  });
})();
'''

results = []


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        results.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        pass


def old_src(work):
    """Writes the src folder of OLD_REF to work/old and returns its path."""
    tar = subprocess.run(['git', '-C', ROOT, 'archive', '--format=tar', OLD_REF, 'src'],
                         capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(tar)) as t:
        t.extractall(os.path.join(work, 'old'), filter='data')
    return os.path.join(work, 'old', 'src')


def make_xpi(src, out, bg_js, page, harness_js):
    """Copies src, adds bg_js to the background and harness_js to page, and zips it."""
    copy = out + '.d'
    shutil.copytree(src, copy, ignore=shutil.ignore_patterns('.amo-upload-uuid'))
    with open(os.path.join(copy, 'test-bg.js'), 'w') as f:
        f.write(bg_js)
    with open(os.path.join(copy, 'test-harness.js'), 'w') as f:
        f.write(harness_js)
    manifest_path = os.path.join(copy, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)
    manifest['background']['scripts'].append('test-bg.js')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f)
    html_path = os.path.join(copy, page)
    with open(html_path, encoding='utf-8') as f:
        html = f.read()
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html.replace('</body>', '<script src="test-harness.js"></script></body>', 1))
    with zipfile.ZipFile(out, 'w') as z:
        for root, _, files in os.walk(copy):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, copy))
    return out


def wait_for(count, seconds):
    for _ in range(seconds * 4):
        if len(results) >= count:
            return results[count - 1]
        time.sleep(0.25)
    return None


def main():
    server = HTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    work = tempfile.mkdtemp()
    old_xpi = make_xpi(old_src(work), os.path.join(work, 'old.xpi'), OLD_BG_JS, 'main.html',
                       OLD_HARNESS_JS % port)
    new_xpi = make_xpi(SRC, os.path.join(work, 'new.xpi'), NEW_BG_JS, 'popup.html',
                       NEW_HARNESS_JS % port)

    apps_before = running_apps() if MAC else set()
    fronts = [front_app()] if MAC else []
    profile = None
    try:
        driver, profile = start_firefox()
        try:
            driver.install_addon(old_xpi, temporary=True)
            if wait_for(1, 60):
                driver.install_addon(new_xpi, temporary=True)
                if wait_for(2, 60):
                    driver.install_addon(new_xpi, temporary=True)
                    wait_for(3, 60)
        finally:
            if MAC:
                fronts.append(front_app())
            driver.quit()
    finally:
        if profile:
            subprocess.run(['pkill', '-f', profile])
            shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)
        server.shutdown()

    lines, ok = [], True

    def check(name, cond, detail=''):
        nonlocal ok
        ok &= bool(cond)
        line = ('PASS' if cond else 'FAIL') + '  ' + name
        if not cond and detail != '':
            line += '  (' + str(detail) + ')'
        lines.append(line)

    old, new, again = (results + [None] * 3)[:3]
    old_tasks = json.loads(old['tasks'] or '[]') if old else []
    check('3.11.0 ran and stored two tasks', old and old['version'] == '3.11.0' and len(old_tasks) == 2,
          old)
    check('3.11.0 marks "Old report" as running', any(
        t.get('text') == 'Old report' and t.get('last_tick') for t in old_tasks), old_tasks)

    tasks = new['tasks'] if new else []
    by_name = {t['name']: t for t in tasks}
    report, email = by_name.get('Old report'), by_name.get('Old email')
    check('the update runs the new version', new and new['version'] != '3.11.0', new and new['version'])
    check('the new version has the two 3.11.0 tasks, in the same order',
          [t['name'] for t in tasks] == ['Old report', 'Old email'], tasks)
    if report and new:
        shown = report['elapsedMs'] + (new['now'] - report['startedAt'] if report['startedAt'] else 0)
        check('"Old report" still runs, with its time from 3.11.0',
              report['startedAt'] is not None and shown >= 2000, report)
        check('"Old report" keeps its 30 minute goal', report['goalMs'] == 30 * 60 * 1000, report)
    if email:
        check('"Old email" is paused and has no goal',
              email['startedAt'] is None and email['goalMs'] is None, email)
    check('the popup shows both tasks', new and [r['name'] for r in new['rows']] == ['Old report', 'Old email'],
          new and new['rows'])
    check('the popup shows "Old report" as running with its goal', new and new['rows'] and
          new['rows'][0]['running'] and new['rows'][0]['goal'] == 'goal 30m', new and new['rows'])
    check('the badge shows the running time', new and re.fullmatch(r'\d+m', new['badge'] or ''),
          new and new['badge'])
    check('the import is marked as done', new and new['imported'] is True, new and new['imported'])
    check('a second update does not add the tasks again',
          again and [t['id'] for t in again['tasks']] == [t['id'] for t in tasks], again and again['tasks'])
    errs = [e for r in results for e in r.get('errs', [])]
    check('no script errors', not errs, errs)
    if MAC:
        asns = [re.search(r'ASN:0x[0-9a-f]+-0x[0-9a-f]+', f) for f in fronts]
        new_front = [x.group(0) for x in asns if x and x.group(0) not in apps_before]
        check('no app started by the test came to the front', not new_front, ' | '.join(fronts))

    print('\n'.join(lines))
    print('RESULT:', 'ALL PASS' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
