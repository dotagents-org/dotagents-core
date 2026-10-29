# Writes the dotagents lockup (symbol + "dotagents" in Geist Mono 600, text as outlines) for light
# and dark backgrounds.
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font_path, out_dir = sys.argv[1], sys.argv[2]
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
cap = font["OS/2"].sCapHeight if hasattr(font["OS/2"], "sCapHeight") else 700
xh = font["OS/2"].sxHeight

SIZE = 64.0                 # font size, px
scale = SIZE / upm
TRACK = -0.02 * SIZE
SYM = 72.0                  # symbol size
GAP = 20.0
H = SYM

paths = []
x = SYM + GAP
# Baseline so that the x-height sits centered on the eyes (cy = 0.48 of the symbol) and the
# ascenders reach near the top.
baseline = SYM * 0.48 + (xh * scale) / 2
for ch in "dotagents":
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    tpen = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
    gs[name].draw(tpen)
    paths.append(pen.getCommands())
    x += gs[name].width * scale + TRACK
W = x - TRACK

def svg(text_color):
    s = SYM / 100
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W:.0f}" height="{H:.0f}" role="img" aria-label="dotagents">
  <rect width="{SYM}" height="{SYM}" rx="{28*s:.2f}" fill="#171717"/>
  <circle cx="{34*s:.2f}" cy="{48*s:.2f}" r="{9*s:.2f}" fill="#ededed"/>
  <circle cx="{66*s:.2f}" cy="{48*s:.2f}" r="{9*s:.2f}" fill="#ededed"/>
  <path fill="{text_color}" d="{" ".join(paths)}"/>
</svg>
'''

open(f"{out_dir}/dotagents-lockup-light.svg", "w").write(svg("#171717"))
open(f"{out_dir}/dotagents-lockup-dark.svg", "w").write(svg("#ededed"))
print("width", round(W), "height", H)
