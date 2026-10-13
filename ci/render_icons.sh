#!/bin/sh
# Make the PNG icons from the SVG icons, with macOS sips.
# icon-16.svg (a simpler drawing) gives icon-16.png. icon.svg gives the
# 32, 48, 96 and 128 px icons. The PNGs keep the transparent corners.
# Usage: sh ci/render_icons.sh
set -e
cd "$(dirname "$0")/../src/icons"
sips -s format png -z 16 16 icon-16.svg --out icon-16.png >/dev/null
for size in 32 48 96 128; do
  sips -s format png -z "$size" "$size" icon.svg --out "icon-$size.png" >/dev/null
done
ls -1 icon-*.png
