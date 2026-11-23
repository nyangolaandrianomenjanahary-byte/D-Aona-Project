# -*- coding: utf-8 -*-
"""
=============================================================================
 D-aôna — support de formation « Administration : prise en main »
 Générateur du diaporama (29 diapositives) à partir des captures réelles.
-----------------------------------------------------------------------------
 Entrées : docs/formation-admin/captures/*.jpg  (produites par
           d-aona-server/test/ui/capture_admin.js sur une base de démonstration)
 Sortie  : docs/formation-admin/D-aona - Administration (prise en main).pptx
           puis copie sur le Bureau.

 Le script fabrique aussi « 05-kyc-detail.jpg » : un recadrage de la capture
 04 (le tableau de la file d'identité), pour illustrer l'agrandi d'une ligne
 sans passer par l'ouverture d'une pièce — celle-ci occupe tout l'écran et
 n'affiche qu'un aplat de test.

 Usage :  py docs/formation-admin/build_pptx.py
=============================================================================
"""

import shutil
import sys
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

HERE = Path(__file__).resolve().parent
SHOTS = HERE / "captures"
OUT = HERE / "D-aona - Administration (prise en main).pptx"
DESKTOP = Path.home() / "Desktop"

# --------------------------------------------------------------------------
# Charte : celle de l'application (vert D-aôna, fonds gris clair, encre).
# --------------------------------------------------------------------------
GREEN = RGBColor(0x15, 0x77, 0x5A)
GREEN_D = RGBColor(0x0E, 0x52, 0x3D)
GREEN_T = RGBColor(0xE7, 0xF3, 0xEE)   # fond de l'encadré vert
BG = RGBColor(0xF2, 0xF3, 0xF7)
INK = RGBColor(0x2B, 0x2E, 0x3C)
MUTED = RGBColor(0x6E, 0x73, 0x86)
LINE = RGBColor(0xD8, 0xDA, 0xE2)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
RED = RGBColor(0xDC, 0x26, 0x26)
AMBER = RGBColor(0xD9, 0x77, 0x06)
FONT = "Segoe UI"

W, H = 13.333, 7.5          # 16:9 en pouces


# --------------------------------------------------------------------------
# Briques de mise en page
# --------------------------------------------------------------------------
def blank(prs, bg=BG):
    """Diapositive vierge, fond plein."""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    rect(slide, 0, 0, W, H, fill=bg)
    return slide


def rect(slide, x, y, w, h, fill=None, line=None, lw=0.75, shape=MSO_SHAPE.RECTANGLE):
    sh = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.shadow.inherit = False
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    return sh


def tbox(slide, x, y, w, h, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    return tf


def para(tf, text="", size=18, bold=False, color=INK, first=False,
         space_before=0, space_after=6, spacing=1.12, align=PP_ALIGN.LEFT,
         italic=False, font=FONT):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_before = Pt(space_before)
    p.space_after = Pt(space_after)
    p.line_spacing = spacing
    if text:
        run(p, text, size=size, bold=bold, color=color, italic=italic, font=font)
    return p


def run(p, text, size=18, bold=False, color=INK, italic=False, font=FONT):
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font
    r.font.color.rgb = color
    return r


def bullet(tf, lead, rest="", size=17, first=False, color=INK, space_after=10):
    """Puce à deux tons : amorce en gras, explication en texte courant."""
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.space_after = Pt(space_after)
    p.line_spacing = 1.12
    r = p.add_run()
    r.text = "●  "
    r.font.size = Pt(size * 0.62)
    r.font.bold = True
    r.font.name = FONT
    r.font.color.rgb = GREEN
    if lead:
        run(p, lead, size=size, bold=True, color=color)
    if rest:
        run(p, ("  " if lead else "") + rest, size=size, color=color)
    return p


def header(slide, kicker, title, num, sub=None):
    rect(slide, 0, 0, W, 0.10, fill=GREEN)
    tf = tbox(slide, 0.72, 0.42, 11.9, 1.35)
    para(tf, kicker.upper(), size=11.5, bold=True, color=GREEN, first=True, space_after=5)
    para(tf, title, size=29, bold=True, color=INK, space_after=2, spacing=1.0)
    if sub:
        para(tf, sub, size=14, color=MUTED, space_before=7, spacing=1.15)
    footer(slide, num)


def footer(slide, num):
    tf = tbox(slide, 0.72, 6.98, 8.0, 0.3)
    para(tf, "D-aôna · espace d'administration · support de formation", size=9.5, color=MUTED, first=True)
    tf2 = tbox(slide, 11.95, 6.98, 0.66, 0.3)
    para(tf2, str(num), size=9.5, bold=True, color=GREEN, first=True, align=PP_ALIGN.RIGHT)


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text.strip()


def picture(slide, name, x, y, w, h, frame=True):
    """Insère l'image contenue dans la boîte (x, y, w, h) sans la déformer."""
    path = SHOTS / name
    if not path.exists():
        raise SystemExit("capture manquante : %s (lancez capture_admin.js)" % path)
    iw, ih = Image.open(path).size
    ar = iw / ih
    if w / h > ar:            # boîte plus large que l'image → limite en hauteur
        ph, pw = h, h * ar
    else:
        pw, ph = w, w / ar
    px, py = x + (w - pw) / 2, y + (h - ph) / 2
    slide.shapes.add_picture(str(path), Inches(px), Inches(py), Inches(pw), Inches(ph))
    if frame:
        rect(slide, px, py, pw, ph, fill=None, line=LINE, lw=0.9)
    return px, py, pw, ph


def callout(slide, x, y, w, h, text, size=15, accent=GREEN, fill=GREEN_T, label=None):
    rect(slide, x, y, w, h, fill=fill)
    rect(slide, x, y, 0.06, h, fill=accent)
    tf = tbox(slide, x + 0.24, y + 0.16, w - 0.48, h - 0.32, anchor=MSO_ANCHOR.MIDDLE)
    first = True
    if label:
        para(tf, label.upper(), size=10.5, bold=True, color=accent, first=True, space_after=3)
        first = False
    para(tf, text, size=size, color=INK, first=first, spacing=1.16)


def cards(slide, items, x, y, w, h, cols, gap=0.32, size=15, numbered=False):
    """Grille de cartes blanches ; items = [(titre, texte), …]."""
    rows = (len(items) + cols - 1) // cols
    cw = (w - gap * (cols - 1)) / cols
    ch = (h - gap * (rows - 1)) / rows
    for i, (title, text) in enumerate(items):
        cx = x + (i % cols) * (cw + gap)
        cy = y + (i // cols) * (ch + gap)
        rect(slide, cx, cy, cw, ch, fill=WHITE, line=LINE)
        tf = tbox(slide, cx + 0.28, cy + 0.22, cw - 0.56, ch - 0.44, anchor=MSO_ANCHOR.MIDDLE)
        if numbered:
            para(tf, "%02d" % (i + 1), size=11, bold=True, color=GREEN, first=True, space_after=4)
            para(tf, title, size=size + 1, bold=True, color=INK, space_after=6, spacing=1.05)
        else:
            para(tf, title, size=size + 1, bold=True, color=INK, first=True, space_after=6, spacing=1.05)
        para(tf, text, size=size, color=MUTED, spacing=1.14)


def table(slide, x, y, w, widths, rows, head=None, size=13, head_size=11,
          row_h=0.44, head_h=0.42):
    data = ([head] if head else []) + rows
    shape = slide.shapes.add_table(len(data), len(widths), Inches(x), Inches(y),
                                  Inches(w), Inches(0.4))
    tbl = shape.table
    tbl.first_row = bool(head)
    tbl.horz_banding = False
    total = float(sum(widths))
    for i, cwr in enumerate(widths):
        tbl.columns[i].width = Inches(w * cwr / total)
    for r, row in enumerate(data):
        tbl.rows[r].height = Inches(head_h if (head and r == 0) else row_h)
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.margin_left = Inches(0.13)
            cell.margin_right = Inches(0.10)
            cell.margin_top = Inches(0.05)
            cell.margin_bottom = Inches(0.05)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            if head and r == 0:
                cell.fill.fore_color.rgb = GREEN
            else:
                cell.fill.fore_color.rgb = WHITE if r % 2 else BG
            p = cell.text_frame.paragraphs[0]
            p.space_after = Pt(0)
            p.line_spacing = 1.06
            head_row = bool(head) and r == 0
            run(p, str(val), size=head_size if head_row else size,
                bold=head_row, color=WHITE if head_row else INK)
    return shape


def make_crop(src_name, dst_name, top, bottom, left=0.014, right=0.986):
    """Recadrage en bandeau d'une capture (coordonnées relatives)."""
    src, dst = SHOTS / src_name, SHOTS / dst_name
    if not src.exists():
        raise SystemExit("capture manquante : %s" % src)
    im = Image.open(src)
    w, h = im.size
    im.crop((int(left * w), int(top * h), int(right * w), int(bottom * h))) \
      .save(dst, "JPEG", quality=88)
    return dst


def make_details():
    """Les bandeaux dérivés : tableaux trop petits pour être lus en entier."""
    make_crop("04-kyc-file.jpg", "05-kyc-detail.jpg", 0.205, 0.478)
    make_crop("06-kyc-refuses.jpg", "06b-kyc-refuses-detail.jpg", 0.200, 0.398)
    make_crop("14-journal.jpg", "14b-journal-detail.jpg", 0.236, 0.452)


# --------------------------------------------------------------------------
# Moteurs de diapositive
# --------------------------------------------------------------------------
def r_cover(slide, d):
    tf = tbox(slide, 0.95, 1.45, 10.8, 3.4)
    para(tf, d["kicker"].upper(), size=12.5, bold=True,
         color=RGBColor(0xC6, 0xE5, 0xD8), first=True, space_after=15)
    para(tf, d["title"], size=43, bold=True, color=WHITE, spacing=1.02, space_after=18)
    para(tf, d["sub"], size=19, color=RGBColor(0xDD, 0xEE, 0xE7), spacing=1.28)
    rect(slide, 0.95, 5.66, 3.2, 0.05, fill=RGBColor(0x7C, 0xC4, 0xA7))
    tf2 = tbox(slide, 0.95, 5.88, 11.4, 0.95)
    para(tf2, d["meta"], size=13, color=RGBColor(0xBF, 0xDD, 0xD0), first=True, spacing=1.25)


def r_split(slide, d):
    header(slide, d["kicker"], d["title"], d["n"], d.get("sub"))
    y0 = 1.98 if d.get("sub") else 1.74
    picture(slide, d["img"], *d.get("box", (5.72, y0, 6.90, 6.04 - y0)))
    tf = tbox(slide, 0.72, y0 + 0.10, d.get("tbw", 4.62), d.get("tbh", 4.30),
              anchor=MSO_ANCHOR.MIDDLE)
    first = True
    for lead, rest in d["items"]:
        bullet(tf, lead, rest, size=d.get("size", 15.5), first=first)
        first = False
    if d.get("note"):
        para(tf, d["note"], size=12.5, italic=True, color=MUTED, space_before=8, spacing=1.18)
    if d.get("cap"):
        tf2 = tbox(slide, 5.72, 6.22, 6.90, 0.42)
        para(tf2, d["cap"], size=11.5, italic=True, color=MUTED, first=True,
             align=PP_ALIGN.CENTER)


def r_band(slide, d):
    header(slide, d["kicker"], d["title"], d["n"], d.get("sub"))
    picture(slide, d["img"], 0.72, 1.68, 11.90, 2.32)
    for i, col in enumerate(d["cols"]):
        tf = tbox(slide, 0.72 + i * 6.12, 4.24, 5.72, 1.80)
        first = True
        for lead, rest in col:
            bullet(tf, lead, rest, size=14.5, first=first)
            first = False
    if d.get("note"):
        callout(slide, 0.72, 6.14, 11.90, 0.68, d["note"], size=13.5)


def r_table(slide, d):
    header(slide, d["kicker"], d["title"], d["n"], d.get("sub"))
    table(slide, 0.72, 1.76, 11.90, d["widths"], d["rows"], head=d.get("head"),
          size=d.get("size", 13), row_h=d.get("row_h", 0.46), head_h=0.40)
    if d.get("note"):
        callout(slide, 0.72, 6.12, 11.90, 0.70, d["note"], size=13.5)


def r_cards(slide, d):
    header(slide, d["kicker"], d["title"], d["n"], d.get("sub"))
    cards(slide, d["items"], 0.72, 1.82, 11.90, 4.08, d.get("cols", 2),
          size=d.get("size", 15), numbered=d.get("numbered", False))
    if d.get("note"):
        callout(slide, 0.72, 6.14, 11.90, 0.68, d["note"], size=13.5)


def r_steps(slide, d):
    header(slide, d["kicker"], d["title"], d["n"], d.get("sub"))
    steps = d["steps"]
    h = 0.80 if len(steps) <= 4 else 0.70
    gap = 0.14
    for i, (lead, rest) in enumerate(steps):
        cy = 1.96 + i * (h + gap)
        rect(slide, 0.72, cy, 11.90, h, fill=WHITE, line=LINE)
        circ = rect(slide, 0.94, cy + (h - 0.46) / 2, 0.46, 0.46, fill=GREEN,
                    shape=MSO_SHAPE.OVAL)
        circ.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
        pn = circ.text_frame.paragraphs[0]
        pn.alignment = PP_ALIGN.CENTER
        run(pn, str(i + 1), size=15, bold=True, color=WHITE)
        tf = tbox(slide, 1.60, cy + 0.10, 10.78, h - 0.20, anchor=MSO_ANCHOR.MIDDLE)
        p = tf.paragraphs[0]
        p.line_spacing = 1.10
        run(p, lead, size=15, bold=True, color=INK)
        if rest:
            run(p, "  " + rest, size=15, color=MUTED)
    if d.get("note"):
        callout(slide, 0.72, 6.10, 11.90, 0.72, d["note"], size=13.5)


def r_end(slide, d):
    header(slide, d["kicker"], d["title"], d["n"], d.get("sub"))
    cards(slide, d["items"], 0.72, 1.78, 11.90, 3.30, 2, size=14.5)
    rect(slide, 0.72, 5.36, 11.90, 1.40, fill=GREEN)
    tf = tbox(slide, 1.06, 5.50, 11.2, 1.12, anchor=MSO_ANCHOR.MIDDLE)
    para(tf, d["closing"], size=19, bold=True, color=WHITE, first=True, space_after=6)
    para(tf, d["closing2"], size=13, color=RGBColor(0xCF, 0xE8, 0xDC), spacing=1.18)


RENDER = {
    "cover": r_cover, "split": r_split, "band": r_band,
    "table": r_table, "cards": r_cards, "steps": r_steps, "end": r_end,
}

# ==========================================================================
#  CONTENU — 29 diapositives, une idée par diapositive
# ==========================================================================
SLIDES = []
SLIDES += [
    # ---------------------------------------------------------------- 1
    dict(t="cover",
         kicker="Formation interne · novembre 2026",
         title="L'espace d'administration expliqué simplement",
         sub="Neuf modules, sept rôles, un journal : de quoi gérer D-aôna sans être "
             "informaticien.",
         meta="D-aôna · Fanorona Malagasy — support de prise en main\n"
              "Toutes les captures proviennent d'une base de démonstration : aucun compte "
              "réel n'y figure.",
         notes="""Objectif de la séance : que chacun puisse entrer dans l'espace
d'administration, y trouver ce qu'il cherche et savoir ce qu'il a le droit de faire.
Aucun prérequis technique. Durée conseillée : 45 minutes, questions comprises.
Les écrans montrés viennent d'une base de démonstration : ni pseudo réel, ni solde réel,
ni pièce d'identité réelle."""),

    # ---------------------------------------------------------------- 2
    dict(t="cards", kicker="Objectifs", title="Ce que vous saurez faire après cette séance",
         cols=2, size=14.5, numbered=True,
         items=[
             ("Entrer", "Reconnaître le bouton d'accès et les neuf modules de l'espace."),
             ("Traiter un dossier d'identité",
              "Valider, ou refuser avec un motif que le joueur comprendra."),
             ("Distinguer deux réglages",
              "Un module activé n'accorde aucun droit : les droits se règlent à part."),
             ("Retrouver une décision",
              "Le journal dit qui a fait quoi, et quand — sans exception."),
         ],
         note="Aucune ligne de commande : l'espace se pilote entièrement à la souris. "
              "Seule l'attribution d'un rôle se fait côté serveur — nous le verrons.",
         notes="""Insister : on ne demande pas de comprendre le code, seulement les trois
portes (session, module activé, permission) et les gestes du quotidien.
Les quatre cartes correspondent aux quatre parties du support."""),

    # ---------------------------------------------------------------- 3
    dict(t="table", kicker="Vocabulaire", title="Six mots, et tout devient lisible",
         widths=[1.55, 8.4], size=13, row_h=0.56,
         head=("Mot", "Ce que ça veut dire dans D-aôna"),
         rows=[
             ("Module", "Un compartiment de l'espace : Joueurs, Publicités, Tournois… Neuf au total."),
             ("Écran", "Ce que vous voyez quand vous ouvrez un module."),
             ("Action", "Ce qu'on peut y faire : consulter, créer, modifier, supprimer, valider, exporter."),
             ("Permission", "Le droit de faire UNE action précise sur UN module (ex. valider un dossier d'identité)."),
             ("Rôle", "Un paquet de permissions portant un nom, attribué à une personne (ex. Modération)."),
             ("Journal", "La liste horodatée de toutes les décisions prises dans l'espace."),
         ],
         note="Retenez la différence entre permission (une action) et rôle (un paquet d'actions) : "
              "elle explique tout le reste du support.",
         notes="""Le mot « permission » revient partout dans l'interface : c'est
l'unité de base. Un rôle n'est qu'un emballage de permissions, ce qui permet de changer
les droits d'une équipe entière en modifiant une seule matrice."""),

    # ---------------------------------------------------------------- 4
    dict(t="split", kicker="Entrer", title="Un bouton, et un seul",
         img="01-profil-bouton.jpg", cap="Profil → carte de solde → ⚙ Administration",
         items=[
             ("Dans le Profil.", "Sous la carte de solde, à côté de « Retirer » et « Historique complet »."),
             ("⚙ Administration.", "Un clic ouvre le gestionnaire de modules : le point de départ de tout."),
             ("Pas de bouton ?", "Le compte ne détient aucun rôle : voir « Donner un rôle » et le dépannage."),
         ],
         notes="""Le bouton n'apparaît que si le compte détient au moins une permission.
Ce n'est pas un secret de sécurité — le serveur refuse de toute façon chaque action non
autorisée — mais on n'offre pas une porte qui ne s'ouvrira pas.
Si un collègue ne voit pas le bouton : rôle manquant, ou session ouverte sur un autre
compte."""),
]
SLIDES += [
    # ---------------------------------------------------------------- 5
    dict(t="split", kicker="Les neuf modules", title="Le gestionnaire de modules",
         img="02-modules.jpg", cap="Modules — le hub de l'espace d'administration",
         items=[
             ("Neuf cartes.", "Une par module, avec son interrupteur et un bouton « Gérer »."),
             ("« Vos droits ».", "Sous chaque carte, ce que vous pouvez y faire, personnellement."),
             ("L'interrupteur coupe pour tout le monde.", "Super administrateurs compris."),
             ("Le bouton « Journal ».", "En haut à droite, toujours accessible."),
         ],
         notes="""C'est l'écran d'accueil de l'espace. Le texte affiché le dit lui-même :
activer un module ne donne aucun droit, et le désactiver ne supprime aucune donnée.
Faire lire cette phrase à voix haute : elle évite la moitié des malentendus."""),

    # ---------------------------------------------------------------- 6
    dict(t="split", kicker="Module 1 sur 9", title="Tableau de bord",
         img="03-tableau-de-bord.jpg", cap="Module Tableau de bord",
         items=[
             ("Vue d'ensemble.", "Joueurs, volumes financiers, file d'attente d'identité."),
             ("Le premier réflexe.", "Trente secondes le matin pour voir ce qui attend une décision."),
             ("Aucune action ici.", "C'est de la lecture : rien ne se modifie depuis cet écran."),
         ],
         notes="""Module en lecture seule : il sert à décider par quoi commencer la
journée. Si la file d'identité est pleine, c'est là que le travail commence."""),

    # ---------------------------------------------------------------- 7
    dict(t="split", kicker="Module 2 sur 9", title="Vérification d'identité : la file",
         img="04-kyc-file.jpg", cap="Module Vérification d'identité — onglet « En attente »",
         items=[
             ("Trois onglets.", "En attente, Vérifiés, Refusés — avec le nombre de dossiers."),
             ("Une ligne par dossier.", "Joueur, date de dépôt, taille des deux faces."),
             ("Les empreintes sont tronquées.", "Elles aident à repérer un doublon, pas à reconstituer l'image."),
             ("Ouvrir est déjà journalisé.", "Consulter une pièce laisse une trace, même sans décider."),
         ],
         notes="""C'est le module qui justifie le plus l'existence de l'espace :
sans dossier validé, un joueur ne peut ni déposer, ni retirer, ni miser.
Montrer les trois onglets et leurs compteurs : ils donnent le volume de travail."""),

    # ---------------------------------------------------------------- 8
    dict(t="band", kicker="Module 2 sur 9", title="Bien lire une pièce avant de décider",
         img="05-kyc-detail.jpg",
         cols=[
             [("Le nom", "correspond-il au pseudo et au dossier ?"),
              ("Le numéro", "de CIN est-il complet et lisible ?"),
              ("La photo", "est-elle présente, nette, non recadrée ?")],
             [("Recto et verso", "les deux faces sont-elles fournies ?"),
              ("Les dates", "de validité sont-elles cohérentes ?"),
              ("Le doute", "se tranche par un refus motivé, jamais par un silence.")],
         ],
         note="Cliquez « Recto » puis « Verso » : chaque ouverture est enregistrée avec votre nom.",
         notes="""Les pièces de la démonstration sont des images de test : un aplat
bleu. C'est volontaire — aucune pièce réelle n'apparaît dans ce support.
Faire répéter la liste : nom, numéro, photo, deux faces, dates."""),

    # ---------------------------------------------------------------- 9
    dict(t="band", kicker="Module 2 sur 9", title="Refuser : le motif est obligatoire",
         img="06b-kyc-refuses-detail.jpg",
         cols=[
             [("« Refuser » demande un motif.", "Sans motif (3 caractères minimum), le refus ne passe pas."),
              ("Le motif part au joueur.", "Écrivez-le pour lui, pas pour vous.")],
             [("Le dossier reste re-soumettable.", "Le joueur renvoie une pièce propre et repart dans la file."),
              ("L'onglet « Refusés » garde tout.", "Qui, quand, pourquoi.")],
         ],
         note="Exemple : « Recto illisible (photo floue) : renvoyez une photo nette, sans reflet. »",
         notes="""Un refus sans motif, c'est un joueur bloqué sans explication et un
appel au support. Le motif est la seule information que le joueur verra : il doit lui dire
quoi corriger."""),
]
SLIDES += [
    # ---------------------------------------------------------------- 10
    dict(t="split", kicker="Module 3 sur 9", title="Joueurs",
         img="07-joueurs.jpg", cap="Module Joueurs",
         items=[
             ("Chercher un compte.", "Pseudo, état du dossier d'identité, solde, verrou."),
             ("Révoquer un KYC.", "Quand une pièce s'avère fausse après validation."),
             ("Poser ou lever un verrou.", "Sur un compte suspect, le temps de vérifier."),
             ("Tout est journalisé.", "Chaque geste porte votre nom."),
         ],
         notes="""Deux gestes lourds, à réserver aux cas prouvés : révoquer un KYC
(le joueur redevient non vérifié) et verrouiller un compte.
Toujours vérifier l'identité du demandeur avant d'agir."""),

    # ---------------------------------------------------------------- 11
    dict(t="split", kicker="Module 4 sur 9", title="Publicités",
         img="08-publicites.jpg", cap="Module Publicités — création d'une bannière",
         items=[
             ("Créer une bannière.", "Titre, image, date de début, date de fin, ordre d'affichage."),
             ("Hors dates = invisible.", "Pas besoin de supprimer : la bannière expire toute seule."),
             ("L'ordre tranche.", "Quand plusieurs sont actives, c'est lui qui décide de la priorité."),
             ("Désactiver plutôt que supprimer.", "On garde la trace de ce qui a été publié."),
         ],
         notes="""C'est le module de l'équipe marketing. Point de vigilance : les
dates. Une bannière oubliée sans date de fin reste affichée indéfiniment."""),

    # ---------------------------------------------------------------- 12
    dict(t="split", kicker="Module 5 sur 9", title="Tournois",
         img="09-tournois.jpg", cap="Module Tournois",
         items=[
             ("Créer.", "Nom, date et heure, mise, format, nombre de places."),
             ("Suivre.", "Inscriptions et matchs, dans le même écran."),
             ("Annuler = rembourser.", "L'annulation rend les mises aux inscrits."),
             ("Avant l'heure.", "Une annulation en pleine compétition ne s'improvise pas."),
         ],
         notes="""L'annulation touche à l'argent des joueurs : elle se décide et
s'exécute avant l'heure de départ, pas pendant les matchs.
Chaque annulation laisse une ligne au journal, avec son auteur."""),

    # ---------------------------------------------------------------- 13
    dict(t="split", kicker="Module 6 sur 9", title="Comptabilité",
         img="10-comptabilite.jpg", cap="Module Comptabilité",
         items=[
             ("Les volumes.", "Dépôts, retraits, mises, gains, bonus verrouillés."),
             ("Par période.", "C'est là qu'on repère un écart, pas dans une addition de tête."),
             ("Exporter.", "Un fichier pour le suivi comptable."),
             ("On ne corrige pas un solde à la main.", "Une écriture manuelle est un incident, pas une méthode."),
         ],
         notes="""Module de lecture et d'export. Insister sur la dernière puce :
si un solde paraît faux, on remonte les transactions au journal, on ne « répare » pas la
valeur affichée."""),

    # ---------------------------------------------------------------- 14
    dict(t="split", kicker="Module 7 sur 9", title="Elo et classement",
         img="11-elo.jpg", cap="Module Elo",
         items=[
             ("Le classement.", "Les points attribués aux joueurs, partie après partie."),
             ("Corriger un Elo : cas rare.", "Partie annulée, triche avérée : une erreur prouvée."),
             ("Journalisé, et visible.", "Le joueur retrouve la correction dans son historique."),
         ],
         notes="""Une correction d'Elo se justifie par un fait, pas par une
impression. Le joueur voit la correction : mieux vaut pouvoir l'expliquer."""),

    # ---------------------------------------------------------------- 15
    dict(t="split", kicker="Module 8 sur 9", title="Badges",
         img="12-badges.jpg", cap="Module Badges",
         items=[
             ("Créer un badge.", "Nom, condition d'obtention, image."),
             ("Attribuer.", "Le badge se voit sur le profil : il se mérite."),
             ("Retirer n'est pas supprimer.", "L'historique du badge reste au journal."),
         ],
         notes="""Module léger, mais qui touche à la fierté des joueurs : un badge
retiré sans raison visible se remarque tout de suite."""),

    # ---------------------------------------------------------------- 16
    dict(t="split", kicker="Module 9 sur 9", title="Rôles et permissions : la matrice",
         img="13-roles.jpg", cap="Module Rôles et permissions — rôle « Modération »",
         items=[
             ("Un onglet par rôle.", "Avec le nombre de titulaires."),
             ("Module × action.", "Une case cochée = action autorisée."),
             ("On modifie un rôle, pas une personne.", "Les gens changent de poste ; les rôles restent."),
             ("Super administrateur est protégé.", "Ce rôle ne peut pas être vidé de ses droits."),
         ],
         notes="""C'est le cœur du réglage des droits. Décocher une case retire
l'action à TOUS les titulaires du rôle : on relit avant d'enregistrer.
Le rôle Super administrateur est protégé pour qu'on ne puisse pas se couper l'herbe sous
le pied."""),
]
SLIDES += [
    # ---------------------------------------------------------------- 17
    dict(t="band", kicker="Le journal", title="Qui a fait quoi, et quand",
         img="14b-journal-detail.jpg",
         cols=[
             [("Chaque décision.", "Acteur, action, cible, horodatage."),
              ("En écriture seule.", "Rien ne se modifie ni ne s'efface depuis l'interface.")],
             [("C'est votre preuve.", "En cas de contestation, on remonte la ligne."),
              ("À lire", "avant de dire « je n'ai rien fait ».")],
         ],
         note="Le journal consigne aussi les attributions de rôle faites côté serveur : "
              "l'auteur y figure, comme pour une décision prise à la souris.",
         notes="""Le journal n'est pas un outil de surveillance, c'est un outil de
confiance : il protège autant le joueur que l'administrateur.
Apprendre à le lire fait partie du métier : acteur, action, cible, heure."""),

    # ---------------------------------------------------------------- 18
    dict(t="table", kicker="Les sept rôles", title="Qui peut faire quoi, en un tableau",
         widths=[2.5, 2.4, 5.6, 1.1], size=12, row_h=0.52,
         head=("Rôle", "Pour qui", "Ce qu'il peut faire", "Protégé"),
         rows=[
             ("Super administrateur", "Direction technique",
              "Tout, y compris activer ou couper un module", "Oui"),
             ("Administrateur", "Responsable produit",
              "L'ensemble des modules, sans les réglages réservés au super administrateur", "Non"),
             ("Modération", "Équipe contenu",
              "Joueurs et dossiers d'identité : consulter, valider, modifier", "Non"),
             ("Finance", "Comptable",
              "Comptabilité : consulter, exporter", "Non"),
             ("Marketing", "Campagnes",
              "Publicités : créer, modifier, supprimer", "Non"),
             ("Responsable tournois", "Organisateur",
              "Tournois et inscriptions : créer, modifier, supprimer", "Non"),
             ("Observateur", "Audit, support",
              "Consulter seulement — dans tous les modules", "Non"),
         ],
         note="Un rôle est un paquet de permissions. On donne un rôle à une personne ; "
              "on ajuste le rôle si besoin.",
         notes="""Lecture horizontale : qui, pour quoi, protégé ou non.
Repère utile pour la formation : la plupart des nouveaux arrivent en « Observateur » ou
« Modération »."""),

    # ---------------------------------------------------------------- 19
    dict(t="cards", kicker="Deux réglages à ne pas confondre",
         title="Activer un module n'accorde aucun droit", cols=2, size=14,
         items=[
             ("L'interrupteur du module",
              "Une porte. Fermée, personne n'entre — super administrateurs compris. "
              "Aucune donnée n'est supprimée : on rouvre, tout est là."),
             ("La permission",
              "Ce qu'on peut faire une fois entré. Elle vit dans la matrice "
              "Module × action du rôle, pas sur la page des modules."),
             ("Deux réglages, deux endroits",
              "Les interrupteurs sur la page « Modules » ; les permissions dans "
              "« Rôles et permissions »."),
             ("Le journal, lui, ne se ferme pas",
              "Il reste lisible même quand un module est coupé : la preuve survit au réglage."),
         ],
         note="Un collègue dit « je ne vois plus rien » ? Vérifiez d'abord l'interrupteur, "
              "ensuite son rôle.",
         notes="""C'est LA diapositive à retenir. Beaucoup de confusions viennent de
là : on active un module en croyant donner l'accès, ou on cherche un droit dans la page des
modules alors qu'il se règle dans la matrice."""),
]
SLIDES += [
    # ---------------------------------------------------------------- 20
    dict(t="cards", kicker="Les règles de la maison", title="Quatre règles d'or",
         cols=2, size=14.5, numbered=True,
         items=[
             ("On ne prête pas son compte",
              "Chaque action porte votre nom dans le journal. Un compte prêté efface la traçabilité."),
             ("Un module coupé coupe tout le monde",
              "Super administrateurs compris. On vérifie avant de basculer l'interrupteur."),
             ("Un refus a toujours un motif",
              "Le joueur le lit : c'est lui qui doit pouvoir corriger sa pièce."),
             ("Le journal ne s'efface pas",
              "On écrit pour justifier, jamais pour effacer. Une décision assumée n'a rien à cacher."),
         ],
         notes="""Ces quatre règles couvrent la quasi-totalité des questions
quotidiennes. Les faire relire à voix haute en fin de séance."""),

    # ---------------------------------------------------------------- 21
    dict(t="steps", kicker="Fiche 1", title="Donner un rôle à un collègue",
         steps=[
             ("Vérifier que le compte existe.", "Module Joueurs → rechercher le pseudo."),
             ("Attribuer le rôle, côté serveur.",
              "node admin_grant.js grant Pseudo finance — une commande, un rôle."),
             ("Contrôler dans l'interface.",
              "Rôles et permissions : le compteur du rôle augmente de 1."),
             ("Faire reconnecter la personne.",
              "Le bouton ⚙ apparaît sur son Profil à la connexion suivante."),
         ],
         note="L'attribution d'un rôle est la seule opération qui ne se fait pas à la souris : "
              "elle est réservée à la personne qui administre le serveur — et elle est tracée.",
         notes="""Ne pas inverser l'ordre : on vérifie d'abord que le compte existe,
sinon la commande échoue et on croit à un bug.
Après l'attribution, l'utilisateur doit se reconnecter pour voir le bouton."""),

    # ---------------------------------------------------------------- 22
    dict(t="steps", kicker="Fiche 2", title="Traiter un dossier d'identité",
         steps=[
             ("Ouvrir la file.", "Modules → Vérification d'identité → onglet « En attente »."),
             ("Regarder les deux faces.", "Boutons « Recto » puis « Verso »."),
             ("Comparer.", "Nom, numéro complet, photo, dates — voir « Bien lire une pièce »."),
             ("Décider.", "« Valider », ou « Refuser » avec un motif clair."),
             ("Vérifier après coup.", "Le dossier a quitté « En attente » : il est dans Vérifiés ou Refusés."),
         ],
         notes="""C'est le geste quotidien le plus fréquent. Un dossier lisible se
traite en moins d'une minute. En cas de doute : refus motivé, jamais de dossier laissé
traîner dans la file."""),

    # ---------------------------------------------------------------- 23
    dict(t="steps", kicker="Fiche 3", title="Publier une bannière",
         steps=[
             ("Modules → Publicités.", "Puis « Nouvelle bannière »."),
             ("Renseigner.", "Titre, image, date de début, date de fin, ordre d'affichage."),
             ("Enregistrer.", "La bannière s'affiche sur l'accueil pendant ses dates, et seulement."),
             ("Retirer proprement.", "La désactiver plutôt que la supprimer : l'historique reste lisible."),
         ],
         note="Une date de fin est obligatoire dans la pratique : c'est elle qui empêche "
              "une campagne oubliée de rester affichée des mois.",
         notes="""L'ordre d'affichage décide de la priorité quand plusieurs bannières
sont actives en même temps. Le montrer sur l'écran Publicités."""),

    # ---------------------------------------------------------------- 24
    dict(t="steps", kicker="Fiche 4", title="Créer un tournoi",
         steps=[
             ("Modules → Tournois.", "Puis « Créer »."),
             ("Décrire.", "Nom, date et heure, mise, format, nombre de places."),
             ("Publier.", "Les inscriptions s'ouvrent ; le suivi se fait dans le même écran."),
             ("Annuler si besoin.", "Avant l'heure : les mises sont remboursées aux inscrits."),
         ],
         notes="""La mise est débitée à l'inscription : vérifier le montant avant de
publier. Une annulation est journalisée et rembourse automatiquement."""),

    # ---------------------------------------------------------------- 25
    dict(t="steps", kicker="Fiche 5", title="Retrouver qui a fait quoi",
         steps=[
             ("Ouvrir le Journal.", "Le bouton est en haut de l'espace, dans tous les modules."),
             ("Filtrer.", "Par période et par action, pour réduire la liste."),
             ("Lire la ligne.", "Acteur, action, cible, horodatage : quatre informations suffisent."),
             ("Citer, pas résumer.", "Copiez la ligne dans le compte rendu : elle est datée et nominative."),
         ],
         notes="""Une ligne de journal vaut mieux qu'un souvenir. En cas de
contestation d'un joueur, c'est la première pièce à produire."""),
]
SLIDES += [
    # ---------------------------------------------------------------- 26
    dict(t="cards", kicker="Ce que voit le joueur", title="Trois choses, et pas une de plus",
         cols=2, size=14.5,
         items=[
             ("Avant la validation",
              "Dépôt, retrait et mises bloqués. Un message l'invite à vérifier sa CIN."),
             ("Après la validation",
              "Les mêmes gestes deviennent possibles, sans redémarrer l'application."),
             ("Après un refus",
              "Le motif s'affiche dans son espace : c'est pour cela qu'on l'écrit bien."),
             ("Le bonus de bienvenue",
              "Il n'est pas retirable, même après validation : il se joue, il ne se retire pas."),
         ],
         note="Le joueur ne voit jamais l'espace d'administration : il voit un blocage, "
              "un message, une décision. Tout le reste est notre affaire.",
         notes="""C'est la raison d'être de tout l'espace : produire trois effets visibles
côté joueur — le blocage, l'explication, la décision.
Le bonus verrouillé est une règle du jeu, indépendante du dossier d'identité."""),

    # ---------------------------------------------------------------- 27
    dict(t="table", kicker="Dépannage", title="Quand ça ne marche pas",
         widths=[3.1, 3.6, 5.2], size=12, row_h=0.62,
         head=("Ce que vous voyez", "Pourquoi", "Quoi faire"),
         rows=[
             ("Pas de bouton ⚙ sur le Profil",
              "Aucun rôle attribué au compte (ou session ouverte sur un autre compte)",
              "Vérifier le rôle dans « Rôles et permissions », puis se reconnecter"),
             ("Un message de module désactivé",
              "L'interrupteur du module est sur arrêt",
              "Page Modules → réactiver, ou demander au super administrateur"),
             ("Un message d'accès refusé",
              "Le rôle ne contient pas cette action",
              "Rôles et permissions → cocher l'action, puis se reconnecter"),
             ("Écran vide, ou boutons d'une autre version",
              "Session expirée, ancienne page restée en cache",
              "Se déconnecter, se reconnecter, puis Ctrl+F5"),
         ],
         note="Les trois messages viennent du serveur : l'interface ne fait qu'afficher sa "
              "réponse. Un refus est donc toujours explicable — et toujours journalisé.",
         notes="""Faire le tour des quatre lignes : ce sont les quatre appels au support
les plus fréquents. Dans les trois premiers cas, rien n'est cassé : c'est un réglage."""),

    # ---------------------------------------------------------------- 28
    dict(t="split", kicker="Sur téléphone", title="Le même espace, en une colonne",
         img="15-modules-mobile.jpg",
         box=(9.30, 1.58, 2.60, 5.06), tbw=8.10, tbh=3.60, size=15.5,
         items=[
             ("Une seule colonne.", "Le hub passe en liste : même contenu, mêmes droits."),
             ("Interrupteurs et « Gérer ».", "Tout est là, à portée de pouce."),
             ("Le traitement des dossiers reste sur ordinateur.",
              "Il faut lire deux pièces : un écran de téléphone n'est pas fait pour ça."),
         ],
         notes="""Le passage en colonne ne change ni les modules, ni les droits : c'est
le même espace, redessiné. En revanche, décider sur une pièce d'identité depuis un
téléphone est une mauvaise idée : on ne voit pas assez bien."""),

    # ---------------------------------------------------------------- 29
    dict(t="end", kicker="À retenir", title="Quatre phrases pour la route",
         items=[
             ("Neuf modules, sept rôles",
              "Tout se règle à la souris, sauf l'attribution d'un rôle, faite côté serveur."),
             ("Un module activé n'accorde aucun droit",
              "Les droits vivent dans la matrice du rôle, pas dans l'interrupteur."),
             ("Toute décision laisse une ligne",
              "Acteur, action, cible, horodatage — et rien ne s'efface."),
             ("En cas de doute, lisez le journal",
              "Plutôt que de deviner, ou de demander à la cantonade."),
         ],
         closing="Merci — des questions ?",
         closing2="Support : docs/formation-admin · comptes de démonstration : GuideAdmin, Demo*",
         notes="""Terminer par un tour de table : chacun dit quel module le concerne
le plus. Récupérer les questions non résolues et les consigner dans le compte rendu, avec
une ligne de journal quand une réponse factuelle existe."""),
]
# ==========================================================================
#  Fabrication
# ==========================================================================
def main():
    if not SHOTS.is_dir():
        raise SystemExit("dossier de captures absent : %s" % SHOTS)
    make_details()

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(W), Inches(H)

    for i, d in enumerate(SLIDES, 1):
        d["n"] = i
        slide = blank(prs, GREEN if d["t"] == "cover" else BG)
        RENDER[d["t"]](slide, d)
        if d.get("notes"):
            notes(slide, d["notes"])

    prs.save(OUT)

    # --- contrôles de sortie -------------------------------------------------
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    pics, no_notes, texts = 0, [], []
    for n, s in enumerate(prs.slides, 1):
        for sh in s.shapes:
            if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
                pics += 1
            if sh.has_text_frame:
                texts.append(sh.text_frame.text)
        if not s.has_notes_slide or not s.notes_slide.notes_text_frame.text.strip():
            no_notes.append(n)

    n_slides = len(SLIDES)
    print("diapositives       : %d" % n_slides)
    print("images incorporées  : %d" % pics)
    print("diapos sans notes   : %s" % (no_notes or "aucune"))
    print("fichier             : %s (%.1f Ko)" % (OUT, OUT.stat().st_size / 1024))

    if DESKTOP.is_dir():
        copie = DESKTOP / OUT.name
        shutil.copy2(OUT, copie)
        print("copie Bureau        : %s" % copie)
    else:
        print("Bureau introuvable  : %s" % DESKTOP)

    return 1 if no_notes else 0


if __name__ == "__main__":
    sys.exit(main())







