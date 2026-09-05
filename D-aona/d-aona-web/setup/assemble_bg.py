#!/usr/bin/env python3
"""
Assemble le fond Fanorona a partir des 8 assets generes.
- Mesure automatique de l'epaisseur du cadre bois dans corner_tl
- Mise a l'echelle commune (coins + bords) -> BAND px visibles
- Fondu geometrique vers #0F0F1A exact cote interieur (anti-raccords)
"""
import os
import numpy as np
from PIL import Image

BASE = "/home/user/d-aona-web/setup"
OUT = "/home/user/d-aona-web/assets/bg"
BG = np.array([15, 15, 26], dtype=np.float64)          # #0F0F1A

W = H = 1024
BAND = 120            # epaisseur visuelle du cadre au final
EXTRA = 22            # zone interieure conservee avant fondu complet
FADE0 = BAND - 10
FADE1 = BAND + EXTRA  # fondu de 32 px


def load(name):
    return Image.open(f"{BASE}/{name}.png").convert("RGB")


# ---- Mesure de l'epaisseur bande bois dans corner_tl -----------------------
a0 = np.asarray(load("corner_tl")).astype(np.float64)
wood = np.clip(a0[..., 0] - a0[..., 2] + 18, 0, None)   # R - B : bois > 0
col_w = wood[340:700, :].mean(0)   # sous la bande horizontale
row_w = wood[:, 340:700].mean(1)   # a droite de la bande verticale
th = col_w.max() * 0.28
band_x = int(np.max(np.where(col_w > th)))
band_y = int(np.max(np.where(row_w > th)))
SRC_BAND = max(band_x, band_y) + 6
SCALE = BAND / SRC_BAND
print(f"bande source mesuree: {SRC_BAND}px  ->  SCALE={SCALE:.4f}")

# ---- Pieces ----------------------------------------------------------------
def scaled(name):
    im = load(name)
    w, h = im.size
    return im.resize((round(w * SCALE), round(h * SCALE)), Image.LANCZOS)


def fades(n, reverse=False):
    t = np.clip((np.arange(n, dtype=np.float64) - FADE0) / (FADE1 - FADE0), 0, 1)
    return t[::-1] if reverse else t


CSIZE = BAND + EXTRA          # taille des coins colles
canvas = np.repeat(np.repeat(BG[None, None, :], W, 1), H, 0)

corner_xy = {
    "corner_tl": (0, 0, False, False),
    "corner_tr": (W - CSIZE, 0, True, False),
    "corner_bl": (0, H - CSIZE, False, True),
    "corner_br": (W - CSIZE, H - CSIZE, True, True),
}
for name, (x0, y0, flipx, flipy) in corner_xy.items():
    im = scaled(name)
    sw, sh = im.size
    cx = sw - CSIZE if flipx else 0
    cy = sh - CSIZE if flipy else 0
    piece = np.asarray(im.crop((cx, cy, cx + CSIZE, cy + CSIZE))).astype(np.float64)
    # dans le crop, l'exterieur est toujours cote 0 -> fades standards
    fx, fy = fades(CSIZE), fades(CSIZE)
    t = np.minimum(fy[:, None], fx[None, :])[..., None] ** 1.1
    canvas[y0:y0 + CSIZE, x0:x0 + CSIZE] = piece * (1 - t) + BG[None, None, :] * t

ELEN = W - 2 * CSIZE                       # longueur des bords
for name in ("edge_top", "edge_bottom"):
    im = scaled(name)
    sw, sh = im.size
    if name == "edge_top":
        piece = im.crop((int(sw * 0.17), 0, int(sw * 0.83), CSIZE))
    else:
        piece = im.crop((int(sw * 0.17), sh - CSIZE, int(sw * 0.83), sh))
    piece = np.asarray(piece.resize((ELEN, CSIZE), Image.LANCZOS)).astype(np.float64)
    fy = fades(CSIZE)
    fy = fy if name == "edge_top" else fy[::-1]
    t = np.repeat(fy[:, None], ELEN, 1)[..., None] ** 1.1
    y0 = 0 if name == "edge_top" else H - CSIZE
    canvas[y0:y0 + CSIZE, CSIZE:CSIZE + ELEN] = piece * (1 - t) + BG[None, None, :] * t

for name in ("edge_left", "edge_right"):
    im = scaled(name)
    sw, sh = im.size
    if name == "edge_left":
        piece = im.crop((0, int(sh * 0.17), CSIZE, int(sh * 0.83)))
    else:
        piece = im.crop((sw - CSIZE, int(sh * 0.17), sw, int(sh * 0.83)))
    piece = np.asarray(piece.resize((CSIZE, ELEN), Image.LANCZOS)).astype(np.float64)
    fx = fades(CSIZE)
    fx = fx if name == "edge_left" else fx[::-1]
    t = np.repeat(fx[None, :], ELEN, 0)[..., None] ** 1.1
    x0 = 0 if name == "edge_left" else W - CSIZE
    canvas[CSIZE:CSIZE + ELEN, x0:x0 + CSIZE] = piece * (1 - t) + BG[None, None, :] * t

# ---- Liseret interieur + bruit discret -------------------------------------
pad = BAND + 9
line = np.array([176, 132, 58]) * 0.5
canvas[pad:pad + 2, pad:W - pad] = line
canvas[H - pad - 2:H - pad, pad:W - pad] = line
canvas[pad:H - pad, pad:pad + 2] = line
canvas[pad:H - pad, W - pad - 2:W - pad] = line

rng = np.random.default_rng(7)
mask = rng.random(canvas.shape[:2]) < 0.10
delta = rng.integers(-5, 6, canvas.shape)
canvas = np.where(np.repeat(mask[..., None], 3, axis=-1), canvas + delta, canvas)
blank = ((canvas - BG) ** 2).sum(-1) < 24
canvas[blank] = BG

os.makedirs(OUT, exist_ok=True)
final = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
final.save(f"{OUT}/fanorona.png", optimize=True)
final.resize((2048, 2048), Image.LANCZOS).save(f"{OUT}/fanorona@2x.png", optimize=True)
print("OK ->", final.size)
