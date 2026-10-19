#!/usr/bin/env python3
"""Make the screenshots for the Firefox Add-ons (AMO) page, 1280x800 each.

Usage:
    pip install selenium pillow
    python3 firefox/tests/amo_screenshots.py

The images go to firefox/screenshots/. Each scene uses demo tasks. A scene script in
popup.html stores the tasks and does the clicks (open the edit area, delete a
task). The script takes two images in headless Firefox: the popup page, and
the Firefox window with the add-on button and its badge. Firefox does not put
an open popup panel in a window image, so the script puts the popup image
under the button, with a panel border and shadow.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import goal_test as g  # noqa: E402

OUT = os.path.join(g.ROOT, 'firefox', 'screenshots')
RAW = tempfile.mkdtemp()
SCALE = 1.5
g.PREFS['layout.css.devPixelsPerPx'] = str(SCALE)
WID = '_5f590989-34a7-4c7a-b219-5de25a64db43_-browser-action'
BASE = 'moz-extension://%s/' % g.UUID

SCENE_JS = r'''
(async function () {
  const scene = new URLSearchParams(location.search).get('scene');
  if (!scene) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = Date.now(), M = 60000, S = 1000;
  const t = (id, name, ms, o) => Object.assign({id, name, elapsedMs: ms, startedAt: null, goalMs: null,
    goalNotified: false, done: false, createdAt: 0, lastRunAt: now - M}, o || {});
  const running = scene === 'seed-reached'
    ? t('a', 'Project report', 26*M + 4*S, {elapsedMs: 0, startedAt: now - (26*M + 4*S), goalMs: 25*M, goalNotified: true, lastRunAt: now})
    : t('a', 'Project report', 0, {startedAt: now - (18*M + 12*S), goalMs: 25*M, lastRunAt: now});
  const list = [
    running,
    t('b', 'Review pull requests', 42*M + 10*S, {goalMs: 45*M}),
    t('c', 'Reply to emails', 6*M + 5*S),
    t('d', 'Plan next sprint', 1*60*M + 15*M, {goalMs: 60*M, goalNotified: true}),
    t('e', 'Team standup', 15*M, {done: true}),
    t('f', 'Fix the login bug', 1*60*M + 32*M, {done: true}),
  ];
  if (scene.startsWith('seed')) {
    const tasks = scene === 'seed-edit' ? list.filter(x => x.id !== 'd') : list;
    await browser.storage.local.set({v3Imported: true, notifyPromptDismissed: true, tasks});
    document.title = 'ready-' + scene;
    return;
  }
  await sleep(600);
  if (scene === 'edit') {
    document.querySelector('.task[data-id="b"] .name').click();
    await sleep(200);
    const f = document.querySelector('form.edit');
    f.querySelector('[name="goal"]').focus();
  } else if (scene === 'done') {
    document.getElementById('done-group').open = true;
    actions.delete('c');
  } else {
    document.getElementById('name').blur();
  }
  await sleep(400);
  document.title = 'ready-' + scene;
})();
'''

SCENES = ['main', 'edit', 'reached', 'done', 'dark']


def build_xpi():
    work = tempfile.mkdtemp()
    src = os.path.join(work, 'src')
    shutil.copytree(g.SRC, src)
    with open(os.path.join(src, 'scene.js'), 'w') as f:
        f.write(SCENE_JS)
    p = os.path.join(src, 'popup.html')
    html = open(p, encoding='utf-8').read()
    open(p, 'w', encoding='utf-8').write(html.replace('</body>', '<script src="scene.js"></script></body>', 1))
    out = os.path.join(work, 'a.xpi')
    with zipfile.ZipFile(out, 'w') as z:
        for r, _, fs in os.walk(src):
            for f in fs:
                z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), src))
    return out


CHROME_SETUP = '''
const [wid, dark] = arguments;
const {CustomizableUI} = ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');
CustomizableUI.addWidgetToArea(wid, CustomizableUI.AREA_NAVBAR);
document.documentElement.removeAttribute('remotecontrol');
const {AddonManager} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const done = arguments[arguments.length - 1];
AddonManager.getAddonByID(dark ? 'firefox-compact-dark@mozilla.org' : 'firefox-compact-light@mozilla.org')
  .then(a => a.enable()).then(() => setTimeout(() => {
    document.documentElement.removeAttribute('remotecontrol');
    const node = document.getElementById(wid);
    (node.querySelector('toolbarbutton') || node).setAttribute('open', 'true');
    const b = document.getElementById(wid).getBoundingClientRect();
    const nav = document.getElementById('nav-bar').getBoundingClientRect();
    done({button: [b.left, b.top, b.width, b.height], navBottom: nav.bottom,
          w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio});
  }, 800), e => done(String(e)));
'''


def compose(scene, i):
    from PIL import Image, ImageDraw, ImageFilter
    dpr = i['dpr']
    win = Image.open(os.path.join(RAW, 'window-%s.png' % scene)).convert('RGBA').crop((0, 0, 1280, 800))
    pop = Image.open(os.path.join(RAW, 'popup-%s.png' % scene)).convert('RGBA')
    pw, ph = pop.size
    r = round(8 * dpr)
    bx, by, bw, bh = [v * dpr for v in i['button']]
    x = round(min(bx + bw - pw + 8 * dpr, 1280 - pw - 8 * dpr))
    y = round(i['navBottom'] * dpr + 2 * dpr)
    # shadow
    sh = Image.new('RGBA', win.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x, y + 4, x + pw, y + ph + 4), r, fill=(0, 0, 0, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    win = Image.alpha_composite(win, sh)
    mask = Image.new('L', pop.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), r, fill=255)
    win.paste(pop, (x, y), mask)
    edge = (255, 255, 255, 40) if scene == 'dark' else (0, 0, 0, 45)
    ov = Image.new('RGBA', win.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle((x, y, x + pw - 1, y + ph - 1), r, outline=edge, width=1)
    win = Image.alpha_composite(win, ov)
    win.convert('RGB').save(os.path.join(OUT, '%d-%s.png' % (SCENES.index(scene) + 1, scene)))


def main():
    fronts = [g.front_app()] if g.MAC else []
    driver, profile = g.start_firefox()
    info = {}
    try:
        driver.set_window_rect(0, 0, 854, 534)
        driver.install_addon(build_xpi(), temporary=True)
        time.sleep(3)
        blank = driver.current_window_handle
        driver.get('about:blank')
        driver.switch_to.new_window('window')
        popup_tab = driver.current_window_handle
        driver.set_window_rect(0, 0, 600, 1100)
        for scene in SCENES:
            dark = scene == 'dark'
            with driver.context(driver.CONTEXT_CHROME):
                driver.execute_script(
                    'Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", %d);'
                    'Services.prefs.setIntPref("ui.systemUsesDarkTheme", %d);' % (0 if dark else 1, 1 if dark else 0))
            driver.switch_to.window(popup_tab)
            for step in ('seed-' + scene if scene in ('reached', 'edit') else 'seed', scene):
                driver.get(BASE + 'popup.html?scene=' + step)
                for _ in range(50):
                    if driver.title == 'ready-' + step:
                        break
                    time.sleep(0.1)
            png = driver.find_element('tag name', 'body').screenshot_as_png
            open(os.path.join(RAW, 'popup-%s.png' % scene), 'wb').write(png)
            driver.switch_to.window(blank)
            with driver.context(driver.CONTEXT_CHROME):
                info[scene] = driver.execute_async_script(CHROME_SETUP, WID, dark)
                time.sleep(0.5)
                open(os.path.join(RAW, 'window-%s.png' % scene), 'wb').write(driver.get_screenshot_as_png())
        if g.MAC:
            fronts.append(g.front_app())
    finally:
        driver.quit()
        if profile:
            subprocess.run(['pkill', '-f', profile])
            shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)
    for scene in SCENES:
        compose(scene, info[scene])
    shutil.rmtree(RAW, ignore_errors=True)
    print('Images in', OUT)
    if g.MAC and fronts[0] != fronts[-1]:
        print('Note: the front app changed:', fronts)


if __name__ == '__main__':
    main()
