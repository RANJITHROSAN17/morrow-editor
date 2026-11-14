"""Render Wrytrove's icon (a W on a lavender tile) at Windows sizes with Pillow.

src-tauri/icons/icon.svg is the vector source. The coordinates below mirror it;
change both together. Run: python3 scripts/make-icons.py (needs Pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'src-tauri' / 'icons'
S = 3  # supersample, then downscale for smooth edges
size = 512 * S
mask = Image.new('L', (size, size)); draw = ImageDraw.Draw(mask)
draw.rounded_rectangle((16*S, 16*S, 496*S, 496*S), radius=123*S, fill=255)
gradient = Image.new('RGBA', (size, size)); pix = gradient.load()
# Same diagonal wash as the SVG (#ece4ff -> #ad8cde).
for y in range(size):
    for x in range(size):
        t = (x + y) / (2 * (size - 1))
        pix[x, y] = (round(236*(1-t)+173*t), round(228*(1-t)+140*t), round(255*(1-t)+222*t), 255)
gradient.putalpha(mask)
draw = ImageDraw.Draw(gradient)
ink = (41, 30, 60, 255)  # #291e3c
width = 30 * S

W = [(124, 184), (182, 334), (256, 226), (330, 334), (388, 184)]
DOT = (256, 130, 16)  # centre x, centre y, radius

def scaled(points):
    return [(x * S, y * S) for x, y in points]

draw.line(scaled(W), fill=ink, width=width, joint='curve')
for x, y in scaled(W):  # round joins and caps
    draw.ellipse((x - width // 2, y - width // 2, x + width // 2, y + width // 2), fill=ink)
cx, cy, r = DOT
draw.ellipse(((cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S), fill=ink)

image = gradient.resize((512, 512), Image.Resampling.LANCZOS)
image.save(ROOT / 'icon.png')
for n in (32, 128):
    image.resize((n, n), Image.Resampling.LANCZOS).save(ROOT / f'{n}x{n}.png')
image.save(ROOT / 'icon.ico', format='ICO', sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
print('wrote', ROOT)
