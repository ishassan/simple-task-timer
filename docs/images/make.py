#!/usr/bin/env python3
"""Make the README images in docs/images from the real app pages.

Usage (needs the Firebase bundle, then pip install playwright pillow and
playwright install webkit):
    node web/build.mjs && (cd desktop && npm run web)
    python3 docs/images/make.py

Each page gets demo tasks, so the images show no real data:
- desktop.png  the desktop window (desktop/web/index.html in WebKit, with a
               stand-in for the Tauri calls), in a macOS window frame, with the
               menu-bar time that the page sets
- iphone.png   the web version (firebase/hosting) at iPhone size, light and dark
- flow.png     the Firefox popup: start, edit, goal reached, done (from the
               AMO screenshots in firefox/screenshots)
"""
import http.server
import io
import os
import threading
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.dirname(os.path.abspath(__file__))
PORT = 5081

DEMO = r'''
(() => {
  const now = Date.now(), M = 60000, S = 1000;
  const t = (id, name, ms, o) => Object.assign({id, name, elapsedMs: ms, startedAt: null, goalMs: null,
    goalNotified: false, done: false, createdAt: 0, lastRunAt: now - M, updatedAt: 1}, o || {});
  return {v3Imported: true, notifyPromptDismissed: true, tasks: [
    t('a', 'Project report', 0, {startedAt: now - (18*M + 12*S), goalMs: 25*M, lastRunAt: now}),
    t('b', 'Review pull requests', 42*M + 10*S, {goalMs: 45*M}),
    t('c', 'Reply to emails', 6*M + 5*S),
    t('d', 'Plan next sprint', 75*M, {goalMs: 60*M, goalNotified: true}),
    t('e', 'Team standup', 15*M, {done: true}),
    t('f', 'Fix the login bug', 92*M, {done: true}),
  ]};
})()
'''

# The desktop page calls Tauri. This stand-in gives it the demo state and
# keeps the menu-bar title that the page sets.
TAURI = '''
window.__trayTitle = '';
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    if (cmd === 'load_state') return JSON.stringify(%s);
    if (cmd === 'set_tray_title') window.__trayTitle = args.title;
    return null;
  } },
  window: { getCurrentWindow: () => ({ label: 'main' }) },
  event: { listen: async () => () => {}, emit: async () => {} },
};
''' % DEMO

WEB = '''
if (!localStorage.getItem('simple-task-timer')) localStorage.setItem('simple-task-timer', JSON.stringify(%s));
''' % DEMO


def serve():
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kw):
            super().__init__(*args, directory=ROOT, **kw)

        def log_message(self, *args):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def font(size):
    for path in ['/System/Library/Fonts/SFNS.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def shadow(img, radius, pad, color=(0, 0, 0, 70)):
    """img on a clear canvas with rounded corners and a soft shadow."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius, fill=255)
    out = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + pad // 3, pad + w, pad + h + pad // 3), radius, fill=color)
    out = Image.alpha_composite(out, sh.filter(ImageFilter.GaussianBlur(pad / 2)))
    out.paste(img, (pad, pad), mask)
    return out


def desktop(pw):
    b = pw.webkit.launch()
    pg = b.new_page(viewport={'width': 400, 'height': 360}, device_scale_factor=2, color_scheme='light')
    pg.add_init_script(TAURI)
    # No sync in this image: the page gets no Firebase project
    pg.route('**/firebase-config.js', lambda r: r.fulfill(body='globalThis.SYNC_CONFIG = {firebase: null};',
                                                           content_type='text/javascript'))
    pg.goto(f'http://127.0.0.1:{PORT}/desktop/web/index.html')
    pg.wait_for_selector('#list .task')
    pg.evaluate("document.getElementById('name').blur()")
    pg.wait_for_timeout(1500)
    title = pg.evaluate('window.__trayTitle')
    page = Image.open(io.BytesIO(pg.screenshot())).convert('RGBA')
    b.close()

    s = 2
    bar = 28 * s
    win = Image.new('RGBA', (page.width, page.height + bar), (255, 255, 255, 255))
    d = ImageDraw.Draw(win)
    d.rectangle((0, 0, win.width, bar), fill=(236, 235, 242, 255))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        x = (14 + i * 20) * s
        d.ellipse((x - 6 * s, bar / 2 - 6 * s, x + 6 * s, bar / 2 + 6 * s), fill=c + (255,))
    f = font(13 * s)
    d.text((win.width / 2, bar / 2), 'Simple Task Timer', fill=(60, 58, 75, 255), font=f, anchor='mm')
    win.paste(page, (0, bar))
    framed = shadow(win, 10 * s, 24 * s)

    # The menu bar: the app icon and the time of the running task
    icon = Image.open(os.path.join(ROOT, 'app', 'icons', 'icon-32.png')).convert('RGBA').resize((18 * s, 18 * s))
    mb_h = 26 * s
    canvas = Image.new('RGBA', (framed.width, framed.height + mb_h + 8 * s), (0, 0, 0, 0))
    mb = ImageDraw.Draw(canvas)
    tw = mb.textlength(title, font=font(13 * s))
    box_w = int(18 * s + 6 * s + tw + 20 * s)
    x0 = canvas.width - box_w - 24 * s
    mb.rounded_rectangle((x0, 0, x0 + box_w, mb_h), 6 * s, fill=(30, 29, 38, 235))
    canvas.paste(icon, (x0 + 10 * s, (mb_h - icon.height) // 2), icon)
    mb.text((x0 + 10 * s + icon.width + 6 * s, mb_h / 2), title, fill=(255, 255, 255, 255), font=font(13 * s), anchor='lm')
    canvas.alpha_composite(framed, (0, mb_h + 8 * s - 24 * s // 2))
    canvas.save(os.path.join(OUT, 'desktop.png'))
    print('desktop.png, menu bar title', repr(title))


def iphone(pw):
    b = pw.webkit.launch()
    shots = []
    for scheme in ('light', 'dark'):
        ctx = b.new_context(**pw.devices['iPhone 15'], color_scheme=scheme)
        ctx.add_init_script(WEB)
        pg = ctx.new_page()
        pg.goto(f'http://127.0.0.1:{PORT}/firebase/hosting/index.html')
        pg.wait_for_selector('#list .task')
        pg.wait_for_timeout(1500)
        shots.append(Image.open(io.BytesIO(pg.screenshot())).convert('RGBA'))
        ctx.close()
    b.close()
    phones = []
    for shot, scheme in zip(shots, ('light', 'dark')):
        # A real iPhone shows the page under its status bar
        bg = shot.getpixel((2, shot.height - 2))
        fg = (0, 0, 0, 255) if scheme == 'light' else (255, 255, 255, 255)
        status = 54 * 3
        full = Image.new('RGBA', (shot.width, shot.height + status), bg)
        full.paste(shot, (0, status))
        ImageDraw.Draw(full).text((52 * 3, status / 2 + 6), '9:41', fill=fg, font=font(17 * 3), anchor='mm')
        shot = full.crop((0, 0, shot.width, shot.height))
        bezel = 14 * 3
        body = Image.new('RGBA', (shot.width + 2 * bezel, shot.height + 2 * bezel), (0, 0, 0, 0))
        ImageDraw.Draw(body).rounded_rectangle((0, 0, body.width - 1, body.height - 1), 64 * 3, fill=(24, 24, 28, 255))
        mask = Image.new('L', shot.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), 50 * 3, fill=255)
        body.paste(shot, (bezel, bezel), mask)
        phones.append(shadow(body, 64 * 3, 30 * 3))
    gap = 20 * 3
    out = Image.new('RGBA', (sum(p.width for p in phones) + gap, phones[0].height), (0, 0, 0, 0))
    out.alpha_composite(phones[0], (0, 0))
    out.alpha_composite(phones[1], (phones[0].width + gap, 0))
    out = out.resize((out.width // 3, out.height // 3), Image.Resampling.LANCZOS)
    out.save(os.path.join(OUT, 'iphone.png'))
    print('iphone.png')


def flow():
    names = ['1-main', '2-edit', '3-reached', '4-done']
    labels = ['Start a task', 'Edit the name, time or goal', 'The goal is reached', 'Done tasks, and Undo']
    crops = []
    for n in names:
        im = Image.open(os.path.join(ROOT, 'firefox', 'screenshots', n + '.png')).convert('RGB').crop((640, 50, 1270, 800))
        # Cut the white space under the popup
        diff = Image.eval(im.convert('L'), lambda v: 255 if v < 250 else 0)
        box = diff.getbbox()
        bottom = box[3] if box else im.height
        crops.append(im.crop((0, 0, im.width, min(im.height, bottom + 24))))
    h = max(c.height for c in crops)
    pad, label_h = 24, 56
    out = Image.new('RGB', (2 * crops[0].width + 3 * pad, 2 * (h + label_h) + pad), (255, 255, 255))
    d = ImageDraw.Draw(out)
    for i, (c, label) in enumerate(zip(crops, labels)):
        x = pad + (i % 2) * (c.width + pad)
        y = (i // 2) * (h + label_h + pad // 2)
        d.text((x + c.width / 2, y + label_h / 2), f'{i + 1}. {label}', fill=(29, 27, 43), font=font(26), anchor='mm')
        out.paste(c, (x, y + label_h))
    out.save(os.path.join(OUT, 'flow.png'))
    print('flow.png')


if __name__ == '__main__':
    server = serve()
    with sync_playwright() as pw:
        desktop(pw)
        iphone(pw)
    flow()
    server.shutdown()
