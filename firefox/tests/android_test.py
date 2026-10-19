#!/usr/bin/env python3
"""Load the add-on into Firefox for Android on an emulator and take screenshots.

Run by .github/workflows/android-test.yml after the emulator has started.
It also tests the Sync sign-in of Firefox for Android up to Google: the web
version (firebase/hosting, served from this script) gets a test token in the
URL fragment, as Google sends it, and must send it on to the add-on.
The screenshots are for a person to look at. The script only fails when the
add-on could not be loaded at all; other steps are best effort, and each one
is reported as OK or MISSED at the end.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import threading
import xml.etree.ElementTree as ET
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler

PKG = 'org.mozilla.firefox'
DEVICE = 'emulator-5554'
APK = 'firefox.apk'
OUT = 'ci-out'

results = []
shot_no = 0

# "adb reverse" sends this port on the emulator to the same port on this computer
WEB_PORT = 8097
WEB_HOST = f'http://127.0.0.1:{WEB_PORT}'
HAND_OFF_STATE = 'a' * 32
posted = []  # what the add-on test script sent: its UUID, and each sign-in message

TEST_BG_JS = """
browser.tabs.create({url: 'popup.html', active: false});
// For the sign-in test: the state that the Preferences page saves when you
// click Sign in, and a copy of each sign-in message for this script
const host = '%s';
async function post(d) {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(host + '/posted', {method: 'POST', mode: 'no-cors', body: JSON.stringify(d)});
      return;
    } catch (e) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
browser.storage.local.set({signInHandOff: {state: '%s', at: Date.now()}});
const uuid = new URL(browser.runtime.getURL('/')).host;
post({uuid});
// A second way to give the UUID: a page load in a background tab
browser.tabs.create({url: host + '/uuid?' + uuid, active: false});
browser.runtime.onMessage.addListener(m => {
  if (m && m.type === 'sign-in') post(m);
  return undefined;
});
""" % (WEB_HOST, HAND_OFF_STATE)


class WebServer(SimpleHTTPRequestHandler):
    """Serves the web version, and takes the posts of the add-on test script."""

    def do_GET(self):
        if self.path.startswith('/uuid?'):
            posted.append({'uuid': self.path.split('?', 1)[1]})
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        posted.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        pass


def start_web_server():
    server = HTTPServer(('127.0.0.1', WEB_PORT), partial(WebServer, directory=os.path.join('firebase', 'hosting')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def adb(*args, check=True):
    return subprocess.run(['adb', '-s', DEVICE, *args], check=check,
                          capture_output=True, text=True).stdout


def ui_xml():
    # uiautomator sometimes fails while the screen is changing, so try again.
    for _ in range(3):
        adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml', check=False)
        xml = adb('exec-out', 'cat', '/sdcard/ui.xml', check=False)
        if xml.startswith('<?xml'):
            return xml
        time.sleep(1)
    return ''


def shot(name):
    """Save a screenshot and the screen's UI tree (the tree helps fix this script)."""
    global shot_no
    shot_no += 1
    base = os.path.join(OUT, f'{shot_no:02d}-{name}')
    with open(base + '.png', 'wb') as f:
        f.write(subprocess.run(['adb', '-s', DEVICE, 'exec-out', 'screencap', '-p'],
                               capture_output=True).stdout)
    with open(base + '.xml', 'w') as f:
        f.write(ui_xml())
    print(f'screenshot: {base}.png')


def find(pattern):
    """Return the center of the first element whose text, description or id matches."""
    xml = ui_xml()
    if not xml:
        return None
    rx = re.compile(pattern, re.I)
    for node in ET.fromstring(xml).iter('node'):
        for key in ('text', 'content-desc', 'resource-id'):
            if rx.search(node.get(key, '')):
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
                return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def close_not_responding_popup():
    """The slow emulator often shows "<app> isn't responding"; choose Wait."""
    pos = find(r'^android:id/aerr_wait$')
    if pos:
        adb('shell', 'input', 'tap', str(pos[0]), str(pos[1]))
        time.sleep(1.5)
    return bool(pos)


def tap(pattern, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        pos = find(pattern)
        if pos:
            adb('shell', 'input', 'tap', str(pos[0]), str(pos[1]))
            time.sleep(1.5)
            return True
        close_not_responding_popup()
        time.sleep(1)
    print(f'not found: {pattern}')
    return False


def scroll_down():
    adb('shell', 'input', 'swipe', '540', '1800', '540', '700', '300')
    time.sleep(1)


def back():
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(1)


def record(step, ok):
    results.append((step, ok))
    print(f'{"OK" if ok else "MISSED"}: {step}')


def open_menu():
    return tap(r'^(Main menu|More options|Menu)$')


def skip_first_run_screens():
    """Close the welcome screens and permission prompts until the home screen shows."""
    for i in range(20):
        if find(r'Search or enter address|ADDRESSBAR_URL_BOX|composable_toolbar|'
                r'mozac_browser_toolbar_url_view'):
            return True
        if tap(r"^(Not now|Not Now|Skip|Maybe later|No thanks|Continue|Got it|"
               r"Close|Dismiss|Start browsing|Allow|Don.t allow|Cancel)$", timeout=3):
            shot(f'welcome-step-{i + 1}')
        else:
            time.sleep(2)
    return False


def enable_remote_debugging():
    """web-ext needs 'Remote debugging via USB' turned on in Firefox settings."""
    if not (open_menu() and tap(r'^Settings$')):
        return False
    for _ in range(12):
        if find(r'Remote debugging via USB'):
            tap(r'Remote debugging via USB')
            shot('remote-debugging-setting')
            back()
            return True
        scroll_down()
    return False


def test_copy():
    """Copy the add-on (firefox/build) and add a test script that opens popup.html in a tab.

    Firefox for Android can open the popup from its menu, but the menu
    changes between versions. The tab makes sure the test reaches the popup.
    The copy also lets the web version on this computer open its
    Preferences page (in place of the real web version's site).
    """
    copy = os.path.join(tempfile.mkdtemp(), 'src')
    shutil.copytree(os.path.join('firefox', 'build'), copy)
    with open(os.path.join(copy, 'test-bg.js'), 'w') as f:
        f.write(TEST_BG_JS)
    path = os.path.join(copy, 'manifest.json')
    with open(path) as f:
        manifest = json.load(f)
    manifest['background']['scripts'].append('test-bg.js')
    manifest['web_accessible_resources'][0]['matches'] = ['http://127.0.0.1/*']
    with open(path, 'w') as f:
        json.dump(manifest, f)
    return copy


def fills_width():
    """True when the task form is as wide as the page (no empty strip at the right)."""
    xml = ui_xml()
    if not xml:
        return False
    nodes = list(ET.fromstring(xml).iter('node'))
    box = lambda n: list(map(int, re.findall(r'\d+', n.get('bounds', ''))))
    page = next((box(n) for n in nodes if n.get('class') == 'android.webkit.WebView'), None)
    form = next((box(n) for n in nodes if n.get('resource-id') == 'new-task'), None)
    print('page', page, 'form', form)
    return bool(page and form) and form[2] >= page[2] - 2


def on_popup():
    return bool(find(r'^name$|^start$'))


def main():
    os.makedirs(OUT, exist_ok=True)
    start_web_server()
    adb('wait-for-device')
    adb('reverse', f'tcp:{WEB_PORT}', f'tcp:{WEB_PORT}', check=False)
    # Hide "<app> isn't responding" popups; the slow emulator triggers them a lot.
    adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1', check=False)
    time.sleep(20)  # let the home screen finish starting
    close_not_responding_popup()
    adb('install', '-r', APK)
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
    time.sleep(10)
    shot('firefox-first-start')

    record('Closed the welcome screens', skip_first_run_screens())
    shot('firefox-home')
    record('Turned on remote debugging', enable_remote_debugging())
    shot('back-from-settings')

    log_path = os.path.join(OUT, 'web-ext.log')
    log = open(log_path, 'w')
    webext = subprocess.Popen(
        ['web-ext', 'run', '--target', 'firefox-android', '--adb-device', DEVICE,
         '--firefox-apk', PKG, '--source-dir', test_copy(), '--no-input', '--verbose'],
        stdout=log, stderr=subprocess.STDOUT)
    loaded = False
    end = time.time() + 240
    while time.time() < end and webext.poll() is None:
        with open(log_path) as f:
            if re.search(r'Installed .* as a temporary add-on', f.read()):
                loaded = True
                break
        time.sleep(3)
    record('Loaded the add-on into Firefox for Android', loaded)
    if not loaded:
        webext.kill()
        shot('add-on-not-loaded')
        adb('logcat', '-d', check=False)
        return finish()

    # Firefox shows a "Simple Task Timer was added" sheet; close it.
    time.sleep(8)
    shot('after-install')
    tap(r'^OK$', timeout=5)

    # Open the popup the way a user would: menu, Extensions, Simple Task
    # Timer. The menu lists add-on buttons only while a web page shows; on the
    # home screen, "Extensions" opens the add-on manager. So open a page first.
    # On Android the popup opens as a page.
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
        '-d', 'https://example.com/', PKG, check=False)
    time.sleep(8)
    shot('web-page')
    from_menu = False
    if open_menu():
        shot('main-menu')
        if tap(r'mainMenu\.extensions|^Extensions'):
            shot('extensions-menu')
            if find(r'^Recommended$'):
                back()  # the add-on manager, not the list of add-on buttons
            elif tap(r'^Simple Task Timer$'):
                time.sleep(4)
                from_menu = on_popup()
    shot('after-menu')
    record('Opened the popup from the Firefox menu', from_menu)
    if not from_menu:
        for _ in range(3):  # go back to the browser
            if find(r'Search or enter address|ADDRESSBAR_URL_BOX|composable_toolbar|'
                    r'mozac_browser_toolbar_url_view|TabCounterTestTags.tabCounter|'
                    r'ADDRESSBAR_TABS_COUNTER'):
                break
            back()

    # The test script opened popup.html in a tab: go to that tab
    opened = from_menu
    if not opened:
        tap(r'TabCounterTestTags.tabCounter|ADDRESSBAR_TABS_COUNTER', timeout=5)
        time.sleep(2)
        shot('tabs')
        tap(r'Simple Task Timer|popup\.html', timeout=5)
        time.sleep(3)
        opened = on_popup()
    shot('popup')
    record('Opened the popup page', opened)
    record('The popup page fills the screen width', opened and fills_width())

    # Start a task with no name: one tap on Start gives "Task 1"
    started = tap(r'^start$')
    time.sleep(2)
    shot('task-1-started')
    record('Start with no name made "Task 1"', started and bool(find(r'^Task 1$')))

    # Start a named task with Enter
    added = tap(r'^name$')
    if added:
        adb('shell', 'input', 'text', 'Android%stest%stask')
        adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER')
        back()  # hide the keyboard
    time.sleep(2)
    shot('task-added')
    record('Enter made and started a named task', added and bool(find(r'Android test task')))
    time.sleep(5)
    shot('five-seconds-later')

    record('The web version sent the sign-in on to the add-on', hand_off())

    webext.kill()
    return finish()


def hand_off():
    """Open the web version with a test token, as Google does after a sign-in.

    The add-on test script saved the state, so the add-on must take the
    token. Firebase then refuses the test token, and Preferences shows that.
    """
    uuid = next((p['uuid'] for p in posted if 'uuid' in p), None)
    print('posted:', posted)
    if not uuid:
        print('the add-on test script sent no UUID')
        shot('no-uuid')
        return False
    url = f'{WEB_HOST}/#state=ext.{uuid}.{HAND_OFF_STATE}&id_token=TEST-TOKEN'
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', f"'{url}'", PKG, check=False)
    end = time.time() + 60
    while time.time() < end and {'type': 'sign-in', 'idToken': 'TEST-TOKEN'} not in posted:
        close_not_responding_popup()
        time.sleep(2)
    time.sleep(3)
    shot('sign-in-hand-off')
    return {'type': 'sign-in', 'idToken': 'TEST-TOKEN'} in posted


def finish():
    with open(os.path.join(OUT, 'logcat.txt'), 'w') as f:
        f.write(adb('logcat', '-d', check=False))
    lines = ['| Step | Result |', '|---|---|']
    lines += [f'| {step} | {"OK" if ok else "MISSED"} |' for step, ok in results]
    lines.append('\nScreenshots are in the **android-screenshots** artifact.')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    loaded = any(ok for step, ok in results if step.startswith('Loaded'))
    return 0 if loaded else 1


if __name__ == '__main__':
    sys.exit(main())
