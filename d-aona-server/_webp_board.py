#!/usr/bin/env python3
# =========================================================
# D-aôna — Conversion du plateau pour le web (lot S12 performances)
# ---------------------------------------------------------
# Produit, À CÔTÉ de plateau_clean.png :
#   - plateau_clean.png recompressé SANS PERTE (mêmes pixels, PNG optimisé) ;
#   - plateau_clean.webp en WebP SANS PERTE (pixels identiques garantis).
# La page servira le WebP aux navigateurs qui le supportent (<picture>),
# et gardera le PNG en repli. plateau_exact.svg (artefact de conservation)
# n'est PAS touché : il n'est pas chargé par l'application.
#
# Contrôle intégré : après écriture, chaque fichier est rouvert et comparé
# pixel à pixel (RGBA) à l'original ; toute différence fait ÉCHOUER le script.
# Usage : py _webp_board.py
# =========================================================
import os
import sys

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
PNG = os.path.join(HERE, "..", "D-aona", "d-aona-web", "assets", "board", "plateau_clean.png")
WEBP = os.path.join(HERE, "..", "D-aona", "d-aona-web", "assets", "board", "plateau_clean.webp")


def same_pixels(a, b):
    da, db = a.convert("RGBA"), b.convert("RGBA")
    return ImageChops.difference(da, db).getbbox() is None


def size_ko(p):
    return round(os.path.getsize(p) / 1024, 1)


def main():
    src = Image.open(PNG)
    print("source :", PNG)
    print("  taille :", size_ko(PNG), "Ko ·", src.size, src.mode)

    # 1) PNG recompressé sans perte (optimize=True : mêmes pixels)
    tmp_png = PNG + ".tmp"
    src.save(tmp_png, format="PNG", optimize=True)
    with Image.open(tmp_png) as chk:
        if not same_pixels(src, chk):
            os.remove(tmp_png)
            print("ECHEC : le PNG recompressé diffère de l'original"); sys.exit(1)

    # 2) WebP sans perte
    tmp_webp = WEBP + ".tmp"
    src.save(tmp_webp, format="WEBP", lossless=True, method=6, quality=100)
    with Image.open(tmp_webp) as chk:
        if not same_pixels(src, chk):
            os.remove(tmp_webp)
            print("ECHEC : le WebP diffère de l'original"); sys.exit(1)

    old_png = size_ko(PNG)
    os.replace(tmp_png, PNG)
    os.replace(tmp_webp, WEBP)

    print("PNG optimisé :", size_ko(PNG), "Ko  (avant", old_png, "Ko)")
    print("WebP sans perte :", size_ko(WEBP), "Ko")
    gain = round(100 * (1 - os.path.getsize(WEBP) / (old_png * 1024)))
    print("Pixels identiques (RGBA) : OK, dans les deux fichiers.")
    print("Gain WebP vs PNG d'origine : environ", gain, "%")


if __name__ == "__main__":
    main()
