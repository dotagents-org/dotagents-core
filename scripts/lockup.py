# Writes the dotagents-config and dotagents-accounts lockups (the mark + the name in Geist Mono 600, text
# as outlines) for light and dark backgrounds.
#   uvx --from fonttools python -I scripts/lockup.py <GeistMono-600.ttf> assets
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font_path, out_dir = sys.argv[1], sys.argv[2]
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
xh = font["OS/2"].sxHeight

SIZE = 64.0                 # font size, px
scale = SIZE / upm
TRACK = -0.02 * SIZE
SYM = 72.0                  # symbol size
GAP = 20.0
H = SYM

s = SYM / 100


def text(name, eyes_cy):
    # Baseline so that the x-height sits centered on the eyes and the ascenders reach near the top.
    baseline = SYM * eyes_cy / 100 + (xh * scale) / 2
    paths, x = [], SYM + GAP
    for ch in name:
        pen = SVGPathPen(gs)
        gs[cmap[ord(ch)]].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        paths.append(pen.getCommands())
        x += gs[cmap[ord(ch)]].width * scale + TRACK
    return " ".join(paths), x - TRACK


def face(eyes_cy):
    return f'''<circle cx="{34*s:.2f}" cy="{eyes_cy*s:.2f}" r="{9*s:.2f}" fill="#ededed"/>
  <circle cx="{66*s:.2f}" cy="{eyes_cy*s:.2f}" r="{9*s:.2f}" fill="#ededed"/>'''


def dotagents(text_color):
    return f'''<rect width="{SYM}" height="{SYM}" rx="{28*s:.2f}" fill="#171717"/>
  {face(48)}'''


def accounts(text_color):
    # The face with the presence dot cut into its corner; the dot takes the text color.
    return f'''<mask id="cut"><rect width="{SYM}" height="{SYM}" fill="#fff"/><circle cx="{82*s:.2f}" cy="{82*s:.2f}" r="{22*s:.2f}" fill="#000"/></mask>
  <rect width="{SYM}" height="{SYM}" rx="{28*s:.2f}" fill="#171717" mask="url(#cut)"/>
  {face(44)}
  <circle cx="{82*s:.2f}" cy="{82*s:.2f}" r="{14*s:.2f}" fill="{text_color}"/>'''


for name, mark, eyes_cy in (("dotagents-config", dotagents, 48), ("dotagents-accounts", accounts, 44)):
    d, W = text(name, eyes_cy)
    for side, color in (("light", "#171717"), ("dark", "#ededed")):
        open(f"{out_dir}/{name}-lockup-{side}.svg", "w").write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W:.0f}" height="{H:.0f}" role="img" aria-label="{name}">
  {mark(color)}
  <path fill="{color}" d="{d}"/>
</svg>
''')
    print(name, "width", round(W), "height", H)
