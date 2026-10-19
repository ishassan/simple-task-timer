#!/usr/bin/env python3
"""Test the sign-in of Firefox for Android in headless Firefox: the web
version gets the Google token and sends it on to the add-on.

Usage:
    pip install selenium
    node web/build.mjs        # makes firebase/hosting
    python3 firefox/tests/hand_off_test.py [path to the add-on folder, firefox/build when not given]

Firefox for Android has no identity.launchWebAuthFlow, so the add-on
Preferences page goes to Google, and Google sends the token to the web
version. The web version sends it on to the add-on Preferences page
(app/account.js). This test does the last two steps with no Google: it
opens the web version (served from this script) with a test token in the
URL fragment, as Google does, and checks that:
- the add-on gets the token when the state is the one it saved
- the add-on does not use a token with another state
- a page on a site that the add-on does not name cannot open the add-on page

The test copy of the add-on names 127.0.0.1 in web_accessible_resources in
place of the web version's site, and has no Firebase project, so nothing
goes to Firebase. Firefox starts the same way as in goal_test.py.
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from functools import partial
from http.server import BaseHTTPRequestHandler, HTTPServer, SimpleHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import goal_test  # noqa: E402  (start_firefox, the profile prefs and the add-on UUID)

ROOT = goal_test.ROOT
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'firefox', 'build')
WEB = os.path.join(ROOT, 'firebase', 'hosting')
UUID = goal_test.UUID
GOOD = 'a' * 32
BAD = 'b' * 32

messages = []

# Saves the sign-in state twice: at the start, and once more after the
# first return from the web version uses it
TEST_BG_JS = '''
let arms = 0;
function arm() {
  if (arms++ < 2) browser.storage.local.set({signInHandOff: {state: '%s', at: Date.now()}});
}
arm();
browser.storage.onChanged.addListener(c => {
  if (c.signInHandOff && !('newValue' in c.signInHandOff)) arm();
});
browser.runtime.onMessage.addListener(m => {
  if (m && m.type === 'sign-in') {
    fetch('http://127.0.0.1:%d/message', {method: 'POST', mode: 'no-cors', body: JSON.stringify(m)});
  }
  return undefined;
});
'''


class Results(BaseHTTPRequestHandler):
    def do_POST(self):
        messages.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        pass


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def serve(handler):
    server = HTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def build_xpi(results_port):
    work = tempfile.mkdtemp()
    src = os.path.join(work, 'src')
    shutil.copytree(SRC, src)
    with open(os.path.join(src, 'test-bg.js'), 'w') as f:
        f.write(TEST_BG_JS % (GOOD, results_port))
    with open(os.path.join(src, 'firebase-config.js'), 'w') as f:
        f.write("globalThis.SYNC_CONFIG = {firebase: null, googleWebClientId: 'test', "
                "webAppUrl: 'http://127.0.0.1/', emulator: null};\n")
    path = os.path.join(src, 'manifest.json')
    with open(path) as f:
        manifest = json.load(f)
    manifest['background']['scripts'].append('test-bg.js')
    manifest['web_accessible_resources'][0]['matches'] = ['http://127.0.0.1/*']
    with open(path, 'w') as f:
        json.dump(manifest, f)
    xpi = os.path.join(work, 'addon.xpi')
    with zipfile.ZipFile(xpi, 'w') as z:
        for root, _, files in os.walk(src):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, src))
    return xpi


def wait_url(driver, start, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        url = driver.current_url
        if url.startswith(start):
            return url
        time.sleep(0.2)
    return driver.current_url


def main():
    if not os.path.exists(os.path.join(WEB, 'index.html')):
        print('firebase/hosting is missing: run "node web/build.mjs" first')
        return 1
    results = serve(Results)
    web = serve(partial(Quiet, directory=WEB))
    web_port = web.server_address[1]
    checks, ok = [], True

    def check(name, cond, detail=''):
        nonlocal ok
        ok &= bool(cond)
        checks.append(('PASS' if cond else 'FAIL') + '  ' + name + (f'  ({detail})' if detail else ''))

    profile = None
    try:
        driver, profile = goal_test.start_firefox()
        try:
            driver.install_addon(build_xpi(results.server_address[1]), temporary=True)
            time.sleep(2)
            options = f'moz-extension://{UUID}/options.html'

            # Another state: not used
            driver.get(f'http://127.0.0.1:{web_port}/#state=ext.{UUID}.{BAD}&id_token=TOKEN-1')
            url = wait_url(driver, options)
            check('the web version opens the add-on Preferences page', url.startswith(options), url)
            time.sleep(2)
            check('a token with another state is not used', not messages, messages)

            # The right state: the add-on uses the token
            driver.get(f'http://127.0.0.1:{web_port}/#state=ext.{UUID}.{GOOD}&id_token=TOKEN-2')
            wait_url(driver, options)
            time.sleep(2)
            check('the add-on signs in with the token of its state',
                  {'type': 'sign-in', 'idToken': 'TOKEN-2'} in messages, messages)
            check('the token leaves the address bar', driver.current_url == options, driver.current_url)

            # The state was used once: the same link again does not sign in
            messages.clear()
            driver.get(f'http://127.0.0.1:{web_port}/#state=ext.{UUID}.{GOOD}&id_token=TOKEN-3')
            wait_url(driver, options)
            time.sleep(2)
            check('the same state a second time is not used', not messages, messages)

            # A site that the add-on does not name cannot open the add-on page
            driver.get(f'http://localhost:{web_port}/#state=ext.{UUID}.{GOOD}&id_token=TOKEN-4')
            time.sleep(4)
            check('another site cannot open the add-on page',
                  not driver.current_url.startswith('moz-extension:') and not messages, driver.current_url)
        finally:
            driver.quit()
    finally:
        if profile:
            import subprocess
            subprocess.run(['pkill', '-f', profile])
            shutil.rmtree(profile, ignore_errors=True)
        results.shutdown()
        web.shutdown()

    print('\n'.join(checks))
    print('ALL PASS' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
