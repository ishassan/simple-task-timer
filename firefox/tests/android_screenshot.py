#!/usr/bin/env python3
"""Make the AMO screenshot screenshots/6-android.png from two screenshots of
the Android emulator test (the "android-screenshots" artifact of
.github/workflows/android-test.yml): the Firefox menu with the add-on, and
the add-on page.

Usage (needs pip install pillow):
    python3 firefox/tests/android_screenshot.py <menu.png> <add-on.png>

The two screens go side by side in phone frames, on a 1280 x 800 picture.
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'firefox', 'screenshots', '6-android.png')
W, H = 1280, 800
SCREEN_H = 720       # the height of each screen in the picture
BEZEL = 12
FRAME = (29, 27, 43)


def background():
    """A light lavender gradient, from top to bottom."""
    img = Image.new('RGB', (W, H))
    top, bottom = (243, 242, 250), (226, 223, 247)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


def phone(path):
    """The screen, scaled to SCREEN_H, with rounded corners in a dark frame."""
    screen = Image.open(path).convert('RGB')
    # The emulator's status bar text starts at the edge: add a side margin
    # in the colors of the edge columns, so that the frame corner does not cut it
    pad = screen.width // 30
    wide = Image.new('RGB', (screen.width + 2 * pad, screen.height))
    wide.paste(screen.crop((0, 0, 1, screen.height)).resize((pad, screen.height)), (0, 0))
    wide.paste(screen.crop((screen.width - 1, 0, screen.width, screen.height)).resize((pad, screen.height)),
               (screen.width + pad, 0))
    wide.paste(screen, (pad, 0))
    screen = wide
    screen = screen.resize((round(screen.width * SCREEN_H / screen.height), SCREEN_H), Image.Resampling.LANCZOS)
    w, h = screen.width + 2 * BEZEL, screen.height + 2 * BEZEL
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(out).rounded_rectangle([0, 0, w - 1, h - 1], radius=34, fill=FRAME)
    mask = Image.new('L', screen.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, screen.width - 1, screen.height - 1], radius=22, fill=255)
    out.paste(screen, (BEZEL, BEZEL), mask)
    return out


def main(menu, addon):
    img = background()
    phones = [phone(menu), phone(addon)]
    gap = 80
    x = (W - sum(p.width for p in phones) - gap) // 2
    for p in phones:
        img.paste(p, (x, (H - p.height) // 2), p)
        x += p.width + gap
    img.save(OUT)
    print(OUT)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
