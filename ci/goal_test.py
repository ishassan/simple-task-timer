#!/usr/bin/env python3
"""Check what happens when a task reaches its goal, in headless Firefox.

A task with a goal must keep running after the goal and send one desktop
notification. An indefinite task must not send a notification.

Usage:
    pip install selenium
    python3 ci/goal_test.py [path to the add-on src folder]

The script copies the add-on and adds two test scripts to the copy: a seed
script (background page) that stores the settings and tasks and opens
main.html, and a harness script (main.html) that records what happens and
sends the results by HTTP POST to a local server in this script. WebDriver
cannot run scripts in moz-extension pages, so the results come back this way.

Firefox runs headless with a temporary profile, the sound muted and the
system notification banners off, so nothing shows on the screen. On macOS
the script also checks that no app it started came to the front.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

from selenium import webdriver
from selenium.webdriver.firefox.options import Options

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src')
ADDON_ID = '{5f590989-34a7-4c7a-b219-5de25a64db43}'
UUID = '11111111-2222-3333-4444-555555555555'

# Default settings, plus the old stop-at-goal settings (removed in 3.11.0)
# that profiles from older versions still have
SETTINGS = {
    'no-overtime': 'true', 'stop-timer': 'true', 'notify': 'false', 'show-popup': 'true',
    'play-sound': 'true', 'loop-sound': 'false', 'background-running': 'true',
    'track-history': 'true', 'custom-dialogs': 'true', 'update-time': '1',
    'chart-update-time': '3', 'enable-charts': 'true', 'sound-type': '1', 'custom-sound': '',
    'launches': '0', 'small-window-alerted': 'true', 'hide-notice': 'true',
    'translate-hidden': 'true', 'opened': 'false',
}


def task(name, cur, goal, indefinite=False, running=True):
    return {'text': name, 'description': '',
            'current_hours': cur[0], 'current_mins': cur[1], 'current_secs': cur[2],
            'goal_hours': goal[0], 'goal_mins': goal[1], 'indefinite': indefinite,
            'notified': False, 'running': False, 'last_tick': None,
            'settings': {'exclude-totals': False, 'exclude-charts': False},
            '_start': running}


TASKS = [
    task('goal', (0, 0, 55), (0, 1)),                  # reaches its 1 min goal in about 5 s
    task('indef', (0, 0, 55), (0, 1), indefinite=True),
    task('over', (2, 10, 0), (1, 30), running=False),  # already past a 1h30m goal
]

SEED_JS = '''
localStorage.clear();
var seed = %s;
for (var k in seed.settings) localStorage[k] = seed.settings[k];
localStorage['old-version'] = chrome.runtime.getManifest().version;
seed.tasks.forEach(function(x) { if (x._start) x.last_tick = Date.now(); delete x._start; });
localStorage['tasks'] = JSON.stringify(seed.tasks);
chrome.tabs.create({url: 'main.html', active: false});
'''

HARNESS_JS = '''
(function() {
    var notes = [], errs = [];
    function post(data) {
        fetch('http://127.0.0.1:%d/result', {method: 'POST', mode: 'no-cors', body: JSON.stringify(data)});
    }
    function snap() {
        return tasks.map(function(t) {
            return {cur: [t.current_hours, t.current_mins, t.current_secs], running: !!t.last_tick};
        });
    }
    $(function() { setTimeout(function() {
        // Record notifications and errors (the real calls still run)
        try {
            if (chrome.notifications) {
                var create = chrome.notifications.create.bind(chrome.notifications);
                chrome.notifications.create = function(id, o, cb) {
                    notes.push({api: 'notifications', title: o.title, message: o.message});
                    return create(id, o, function(x) {
                        if (chrome.runtime.lastError) errs.push(String(chrome.runtime.lastError.message));
                        if (cb) cb(x);
                    });
                };
            }
            var N = window.Notification;
            window.Notification = function(title, o) {
                notes.push({api: 'web', title: title, message: o && o.body});
                return new N(title, o);
            };
            window.Notification.permission = N.permission;
            window.Notification.requestPermission = N.requestPermission.bind(N);
            var js_error_orig = js_error;
            window.js_error = function(e) { errs.push(String(e && e.stack || e)); return js_error_orig.apply(this, arguments); };
        } catch (e) { errs.push('harness: ' + e); }

        setTimeout(function() {
            var s1 = snap();
            setTimeout(function() {
                var s2 = snap();
                var row = {done: $('#task-0').hasClass('done'), running: $('#task-0').hasClass('running'),
                           toggle_disabled: !!$('#task-0 button.toggle').attr('disabled'),
                           current: $('#task-0 td.current').text(), over_done: $('#task-2').hasClass('done'),
                           popup: $('#alarm-menu').is(':visible'), error_shown: js_error_shown};
                var st = {noOvertime: $('#no-overtime').length, stopTimer: $('#stop-timer').length,
                          notify: $('#notify').length, popup: $('#show-popup').length, sound: $('#play-sound').length};
                var errs_before_save = errs.slice();
                try {
                    $('#close-alarm').click();
                    $('#tools-button').click();
                    $('#save-settings').click();
                } catch (e) { errs.push('save: ' + e); }
                setTimeout(function() {
                    var p = (typeof browser != 'undefined' && browser.notifications) ? browser.notifications.getAll() : Promise.resolve(null);
                    p.then(function(all) {
                        post({version: chrome.runtime.getManifest().version, s1: s1, s2: s2, notes: notes,
                              errs: errs_before_save, save_errs: errs.slice(errs_before_save.length),
                              save_error_shown: js_error_shown, row: row, st: st,
                              active_notifications: all ? Object.keys(all) : null});
                    });
                }, 1000);
            }, 3000);
        }, 8000);
    }, 1000); });
})();
'''

result = {}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        result['data'] = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        pass


def running_apps():
    out = subprocess.run(['lsappinfo', 'list'], capture_output=True, text=True).stdout
    return set(re.findall(r'ASN:0x[0-9a-f]+-0x[0-9a-f]+', out))


def front_app():
    asn = subprocess.run(['lsappinfo', 'front'], capture_output=True, text=True).stdout.strip()
    out = subprocess.run(['lsappinfo', 'info', '-only', 'name', asn],
                         capture_output=True, text=True).stdout
    return out.split('\n')[0].split('(')[0].strip()  # app name and ASN


def build_xpi(port):
    work = tempfile.mkdtemp()
    src = os.path.join(work, 'src')
    shutil.copytree(SRC, src)
    with open(os.path.join(src, 'scripts', 'test-seed.js'), 'w') as f:
        f.write(SEED_JS % json.dumps({'settings': SETTINGS, 'tasks': TASKS}))
    with open(os.path.join(src, 'scripts', 'test-harness.js'), 'w') as f:
        f.write(HARNESS_JS % port)

    manifest_path = os.path.join(src, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)
    manifest['background']['scripts'].append('scripts/test-seed.js')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f)

    html_path = os.path.join(src, 'main.html')
    with open(html_path, encoding='utf-8') as f:
        html = f.read()
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html.replace('</body>', '<script src="scripts/test-harness.js"></script></body>', 1))

    xpi = os.path.join(work, 'addon.xpi')
    with zipfile.ZipFile(xpi, 'w') as z:
        for root, _, files in os.walk(src):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, src))
    return xpi


def main():
    server = HTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    opts = Options()
    opts.add_argument('-headless')
    opts.add_argument('--width=1400')   # a small window makes the page ask a question
    opts.add_argument('--height=1000')
    opts.set_preference('extensions.webextensions.uuids', json.dumps({ADDON_ID: UUID}))
    opts.set_preference('media.volume_scale', '0.0')        # no sound
    opts.set_preference('alerts.useSystemBackend', False)  # no system notification banners

    mac = sys.platform == 'darwin'
    apps_before = running_apps() if mac else set()
    fronts = [front_app()] if mac else []
    driver = webdriver.Firefox(options=opts)
    try:
        driver.install_addon(build_xpi(port), temporary=True)
        time.sleep(3)
        if mac:
            fronts.append(front_app())
        for _ in range(60):
            if 'data' in result:
                break
            time.sleep(0.5)
    finally:
        if mac:
            fronts.append(front_app())
        driver.quit()
        server.shutdown()

    results, ok = [], True

    def check(name, cond, detail=''):
        nonlocal ok
        ok &= bool(cond)
        line = ('PASS' if cond else 'FAIL') + '  ' + name
        if detail != '':
            line += '  (' + str(detail) + ')'
        results.append(line)

    r = result.get('data')
    if not r:
        print('FAIL  no result from the harness')
        sys.exit(1)

    s1, s2, notes, row, st = r['s1'], r['s2'], r['notes'], r['row'], r['st']
    secs = lambda c: c[0] * 3600 + c[1] * 60 + c[2]
    goal_notes = [n for n in notes if '"goal"' in (n['message'] or '')]
    check('goal task passed its goal (current > 0:01:00)', secs(s1[0]['cur']) > 60, s1[0]['cur'])
    check('goal task is still running after the goal', s1[0]['running'] and s2[0]['running'])
    check('goal task keeps counting after the goal', secs(s2[0]['cur']) > secs(s1[0]['cur']),
          '%s -> %s' % (s1[0]['cur'], s2[0]['cur']))
    check('exactly one goal notification was sent', len(goal_notes) == 1, notes)
    check('notification says the task reached its goal',
          any(n['message'] == 'Task "goal" has reached its goal!' for n in notes))
    check('Firefox accepted the notification',
          r['active_notifications'] is not None and len(r['active_notifications']) == 1,
          r['active_notifications'])
    check('indefinite task sends no notification', not any('"indef"' in (n['message'] or '') for n in notes))
    check('indefinite task keeps running', s2[1]['running'])
    check('row is marked done, start/stop button stays enabled',
          row['done'] and row['running'] and not row['toggle_disabled'], row)
    check('task at 2h10m with a 1h30m goal is marked done', row['over_done'])
    check('in-page popup still shows', row['popup'])
    check('no script errors', not r['errs'] and not row['error_shown'], r['errs'])
    check('settings page has no stop-at-goal or notify options',
          st['noOvertime'] == 0 and st['stopTimer'] == 0 and st['notify'] == 0, st)
    check('popup and sound options are still there', st['popup'] == 1 and st['sound'] == 1, st)
    check('saving settings gives no error', not r['save_errs'] and not r['save_error_shown'], r['save_errs'])
    if mac:
        asns = [re.search(r'ASN:0x[0-9a-f]+-0x[0-9a-f]+', f) for f in fronts]
        new_front = [a.group(0) for a in asns if a and a.group(0) not in apps_before]
        check('no app started by the test came to the front', not new_front, ' | '.join(fronts))

    print('add-on version under test:', r['version'])
    print('\n'.join(results))
    print('RESULT:', 'ALL PASS' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
