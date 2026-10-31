"""Render Morrow's icon at Windows sizes with Pillow; see icons/icon.svg for the vector source."""
from math import comb
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'src-tauri' / 'icons'
S = 3
size = 512 * S
mask = Image.new('L', (size, size)); draw = ImageDraw.Draw(mask)
draw.rounded_rectangle((16*S, 16*S, 496*S, 496*S), radius=123*S, fill=255)
gradient = Image.new('RGBA', (size, size)); pix = gradient.load()
# A very subtle diagonal wash, not dependent on external assets or fonts.
for y in range(size):
    for x in range(size):
        t = (x + y) / (2 * (size - 1))
        pix[x, y] = (round(236*(1-t)+173*t), round(228*(1-t)+140*t), round(255*(1-t)+222*t), 255)
gradient.putalpha(mask)
draw = ImageDraw.Draw(gradient)
ink = (41, 30, 60, 255); width = 30*S

def bezier(points, count=35):
    degree = len(points) - 1
    return [tuple(round(sum(comb(degree, i) * (1-t)**(degree-i) * t**i * p[j] for i, p in enumerate(points))*S) for j in (0, 1))
            for t in (n/count for n in range(count+1))]
outer = [(124*S,334*S),(124*S,184*S)]
outer += bezier([(124,184),(124,140),(172,123),(203,154)])
outer += [(256*S,207*S),(309*S,154*S)]
outer += bezier([(309,154),(340,123),(388,140),(388,184)])
outer += [(388*S,334*S)]
inner = [(182*S,334*S),(256*S,260*S),(330*S,334*S)]
for line in (outer, inner):
    draw.line(line, fill=ink, width=width, joint='curve')
    for x,y in line:
        draw.ellipse((x-width//2,y-width//2,x+width//2,y+width//2), fill=ink)
image = gradient.resize((512,512), Image.Resampling.LANCZOS)
image.save(ROOT/'icon.png')
for n in (32,128): image.resize((n,n), Image.Resampling.LANCZOS).save(ROOT/f'{n}x{n}.png')
image.save(ROOT/'icon.ico', format='ICO', sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
