#!/bin/sh
# Turns each strip/<who>-<state>.svg into png/<who>-<state>.png: 24 frames of 168 px, transparent.
# A vector strip redrawn every frame is heavy (each frame stacks ~15 layers for the volume);
# the PNG is what the panel, the tray icon and the pages play.
#
#   CHROME=<headless chrome or chromium> sh raster.sh <output folder of generate.mjs>
set -e
out="$1"
chrome="${CHROME:?set CHROME to a headless Chrome or Chromium binary}"
h=168
w=$((24 * h))
mkdir -p "$out/png"
for svg in "$out"/strip/*.svg; do
  name=$(basename "$svg" .svg)
  page="$out/png/$name.html"
  printf '<html><body style="margin:0;background:transparent"><img src="file://%s" style="display:block;width:%spx;height:%spx"></body></html>' "$(realpath "$svg")" "$w" "$h" > "$page"
  "$chrome" --headless --default-background-color=00000000 --hide-scrollbars --screenshot="$out/png/$name.png" --window-size="$w,$h" "file://$(realpath "$page")" >/dev/null 2>&1
  rm "$page"
done
echo "$(ls "$out"/png/*.png | wc -l) PNGs in $out/png"
