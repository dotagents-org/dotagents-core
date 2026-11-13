# Writes the dotagents-core, dotagents-accounts and dotagents-config lockups (the last one goes to
# the dotagents-config repository) (the mark + the name in Geist Mono 600, text
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


# A gear, eight teeth around a hole, centered where the presence dot sits (82, 82 in the 100 box).
GEAR = "M94.33 79.95 L98.39 80.06 L98.39 83.94 L94.33 84.05 L94.18 84.82 L94.18 84.82 L92.17 89.27 L94.96 92.22 L92.22 94.96 L89.27 92.17 L88.61 92.61 L88.61 92.61 L84.05 94.33 L83.94 98.39 L80.06 98.39 L79.95 94.33 L79.18 94.18 L79.18 94.18 L74.73 92.17 L71.78 94.96 L69.04 92.22 L71.83 89.27 L71.39 88.61 L71.39 88.61 L69.67 84.05 L65.61 83.94 L65.61 80.06 L69.67 79.95 L69.82 79.18 L69.82 79.18 L71.83 74.73 L69.04 71.78 L71.78 69.04 L74.73 71.83 L75.39 71.39 L75.39 71.39 L79.95 69.67 L80.06 65.61 L83.94 65.61 L84.05 69.67 L84.82 69.82 L84.82 69.82 L89.27 71.83 L92.22 69.04 L94.96 71.78 L92.17 74.73 L92.61 75.39 L92.61 75.39 Z M87 82 A5 5 0 1 0 77 82 A5 5 0 1 0 87 82 Z"


def config(text_color):
    # The face with a gear cut into its corner in place of the dot: the configuration.
    return f'''<mask id="cut"><rect width="{SYM}" height="{SYM}" fill="#fff"/><circle cx="{82*s:.2f}" cy="{82*s:.2f}" r="{22*s:.2f}" fill="#000"/></mask>
  <rect width="{SYM}" height="{SYM}" rx="{28*s:.2f}" fill="#171717" mask="url(#cut)"/>
  {face(44)}
  <path transform="scale({s:.2f})" fill="{text_color}" fill-rule="evenodd" d="{GEAR}"/>'''


for name, mark, eyes_cy in (("dotagents-core", dotagents, 48), ("dotagents-accounts", accounts, 44), ("dotagents-config", config, 44)):
    d, W = text(name, eyes_cy)
    for side, color in (("light", "#171717"), ("dark", "#ededed")):
        open(f"{out_dir}/{name}-lockup-{side}.svg", "w").write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W:.0f}" height="{H:.0f}" role="img" aria-label="{name}">
  {mark(color)}
  <path fill="{color}" d="{d}"/>
</svg>
''')
    print(name, "width", round(W), "height", H)
