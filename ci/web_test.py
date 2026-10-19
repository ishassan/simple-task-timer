#!/usr/bin/env python3
"""Test the web version (webapp/) in headless WebKit, the engine of Safari on
the iPhone: two iPhone-sized pages are two devices. Both sign in to the
Firebase emulators, and a task started on one shows on the other.

Usage (needs Java 21 or newer for the emulators):
    pip install playwright && playwright install webkit
    cd firebase && npx firebase emulators:exec --project demo-simple-task-timer \
        --only auth,firestore "python3 ../ci/web_test.py"

The script makes a test build of the web version (SYNC_EMULATOR=1) and serves
it on 127.0.0.1:5055. It saves a screenshot to ci-out/web-iphone.png.
"""
import functools
import http.server
import os
import subprocess
import threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'http://127.0.0.1:5055/'
OUT = os.path.join(ROOT, 'ci-out', 'web-iphone.png')
results = []

subprocess.run(['node', os.path.join(ROOT, 'webapp', 'build.mjs')], check=True,
               env={**os.environ, 'SYNC_EMULATOR': '1'})
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(ROOT, 'firebase', 'hosting'))
handler.log_message = lambda *a: None
server = http.server.ThreadingHTTPServer(('127.0.0.1', 5055), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
os.makedirs(os.path.dirname(OUT), exist_ok=True)


def check(name, ok, info=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f'  ({info})' if info else ''))


with sync_playwright() as p:
    b = p.webkit.launch()
    dev = p.devices['iPhone 15']
    errors = []
    pages = []
    for n in ('a', 'b'):
        ctx = b.new_context(**dev)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, n=n: errors.append(f'{n}: {e}'))
        pg.on('console', lambda m, n=n: errors.append(f'{n} console: {m.text}') if m.type == 'error' else None)
        pg.goto(URL)
        pages.append(pg)
    a, bb = pages

    a.wait_for_selector('#sync-signin:not([hidden])', timeout=10000)
    check('sign-in button shows', True)
    check('no gear button (the Sync part is on the page)', not a.is_visible('#open-prefs'))
    a.click('#sync-signin')
    a.wait_for_function("document.getElementById('sync-state').textContent.includes('Signed in')", timeout=20000)
    check('page A signs in', True, a.text_content('#sync-state'))

    a.fill('#name', 'From A')
    a.press('#name', 'Enter')
    a.wait_for_selector('#list .task .name:text("From A")', timeout=5000)
    check('page A starts a task', True)
    a.wait_for_timeout(1500)
    check('page title shows the time', '·' in a.title(), a.title())

    bb.click('#sync-signin')
    bb.wait_for_function("document.getElementById('sync-state').textContent.includes('Signed in')", timeout=20000)
    try:
        bb.wait_for_selector('#list .task .name:text("From A")', timeout=20000)
        check('page B gets the task from A', True)
    except Exception as e:
        check('page B gets the task from A', False, str(e)[:100])

    bb.fill('#name', 'From B')
    bb.press('#name', 'Enter')
    try:
        a.wait_for_selector('#list .task .name:text("From B")', timeout=30000)
        check('page A gets the task from B at once (live)', True)
    except Exception as e:
        check('page A gets the task from B at once (live)', False, str(e)[:100])
    a.wait_for_timeout(1500)
    running = a.eval_on_selector_all('#list .task', 'els => els.map(e => e.querySelector(".name").textContent + ":" + e.className)')
    check('only one task runs on A after B starts one', sum('running' in r for r in running) <= 1, str(running))

    before = len(errors)
    check('no script errors before the reload', not errors, str(errors[:3]))
    # A reload stops the open requests of the old page, and WebKit logs them
    a.reload()
    a.wait_for_selector('#list .task .name:text("From B")', timeout=10000)
    check('page A keeps the tasks after a reload', True)
    a.screenshot(path=OUT)

    width = a.evaluate('document.documentElement.scrollWidth')
    check('no side scroll at phone width', width <= dev['viewport']['width'], f'{width}px')
    after = [e for e in errors[before:] if not ('access control checks' in e and 'channel?' in e)]
    check('after the reload, only the stopped requests of the old page', not after, str(after[:3]))
    b.close()

server.shutdown()
print('RESULT:', 'ALL PASS' if all(results) else 'FAIL')
raise SystemExit(0 if all(results) else 1)
