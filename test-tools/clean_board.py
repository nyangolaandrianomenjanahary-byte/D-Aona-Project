# Rend le fond gris du plateau transparent (flood fill depuis les bords).
# Entree : shots/plateau.png (extrait de plateau_exact.svg, 1647x955)
# Sortie : ../D-aona/d-aona-web/assets/board/plateau_clean.png (meme taille + alpha)
from PIL import Image, ImageFilter
from collections import deque

SRC = "shots/plateau.png"
DST = "../D-aona/d-aona-web/assets/board/plateau_clean.png"

im = Image.open(SRC).convert("RGB")
w, h = im.size
px = im.load()

def is_bg(p):
    r, g, b = p
    spread = max(r, g, b) - min(r, g, b)
    mean = (r + g + b) / 3
    return spread < 30 and 80 < mean < 245

# Flood fill depuis tous les pixels du bord
mask = bytearray(w * h)  # 1 = fond
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if is_bg(px[x, y]) and not mask[y * w + x]:
            mask[y * w + x] = 1
            q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if is_bg(px[x, y]) and not mask[y * w + x]:
            mask[y * w + x] = 1
            q.append((x, y))
while q:
    x, y = q.popleft()
    for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
        if 0 <= nx < w and 0 <= ny < h and not mask[ny * w + nx] and is_bg(px[nx, ny]):
            mask[ny * w + nx] = 1
            q.append((nx, ny))

# Canal alpha : 0 sur le fond, 255 ailleurs, leger flou pour adoucer le contour
alpha = Image.frombytes("L", (w, h), bytes(255 - m * 255 for m in mask))
alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))

out = im.convert("RGBA")
out.putalpha(alpha)
out.save(DST)
print("OK ->", DST, out.size)
