/* =========================================================
   D-Aona - FANORONA : PLATEAU PARTAGE (geometrie + rendu)
   ---------------------------------------------------------
   Un seul SYSTEME de plateau pour toutes les variantes de fanorona :

     - des intersections reliees par des lignes gravees (treillis) ;
     - des pions poses SUR les intersections, habilles par le MEME
       mecanisme que le plateau Tsivy : les variables `--pion-*` de la
       couleur, du motif et de la forme choisies en boutique ;
     - des cibles de clic qui couvrent le plateau (on vise le milieu
       d une maille, on atteint l intersection la plus proche).

   Chaque jeu fournit SA geometrie (`create({ rows, cols, topology })`) et
   garde SES regles : ce fichier ne decide jamais qu un coup est legal.

   `topology` dit ou passent les diagonales â€” il doit dire EXACTEMENT ce que
   le moteur autorise, sinon le plateau montrerait des lignes impraticables :
     "strong" (Dimy)  : depuis les points forts (ligne + colonne paire) ;
     "main"   (Telo)  : seulement les deux grandes diagonales du carre,
                        celles qui passent par le centre ;
     "all"            : toutes les diagonales (aucun plateau actuel).

   Aucun etat, aucune regle : le rendu lit `board` et peint. Il ne modifie
   jamais l etat qu on lui donne.
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronaBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG = "http://www.w3.org/2000/svg";
  /* Repere interne : le plateau est un carre de VIEW unites. Les modules de jeu
     ne travaillent que dans ce repere ; le CSS fait le reste (pourcentages),
     si bien qu un plateau reste net a toutes les tailles. */
  const VIEW = 100;
  /* Marge gravee, en unites du repere. Elle laisse respirer le treillis ET
     garantit qu un pion de coin ne deborde pas du plateau (un pion de coin
     s eloigne du bord d une demi-taille de pion). */
  const PAD = 16;
  /* Diametre du pion, en fraction du pas. 0,57 est la valeur MESUREE sur le
     plateau Tsivy (pion de 88,9 px pour un pas de 156,25 px) : les plateaux
     posent donc des pions de la MEME taille a pas egal, quelle que soit la
     variante. Ne pas remonter cette valeur sans remesurer le plateau Tsivy. */
  const PAWN_RATIO = 0.57;
  const CELL_RATIO = 1;    // cote de la cible : les mailles se touchent

  /* Plaques photo DEJA chargees (URL -> vrai). Un coup redessine tout le
     plateau : sans ce memo, chaque clic recreerait une <img> et rejouerait le
     fondu vectoriel -> photo. On ne le fait donc qu une fois par URL ; les
     rendus suivants allument `has-art` d emblee, donc sans transition. */
  const PLATES_OK = {};

  const el = (name, attrs) => {
    const n = document.createElementNS(SVG, name);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  };

  /* ---------------------------------------------------------------------
     GEOMETRIE d une grille d intersections numerotees ligne * cols + col.
     --------------------------------------------------------------------- */
  function create(cfg) {
    const o = cfg || {};
    const rows = Math.max(2, (o.rows || o.cols || 3) | 0);
    const cols = Math.max(2, (o.cols || rows) | 0);
    const topology = o.topology === "all" || o.topology === "main" ? o.topology : "strong";
    const CELLS = rows * cols;

    const stepX = (VIEW - PAD * 2) / (cols - 1);
    const stepY = (VIEW - PAD * 2) / (rows - 1);
    const STEP = Math.min(stepX, stepY);

    const index = (r, c) => r * cols + c;
    const rowOf = (i) => Math.floor(i / cols);
    const colOf = (i) => i % cols;
    const strong = (r, c) => (r + c) % 2 === 0;
    const point = (i) => ({ x: PAD + colOf(i) * stepX, y: PAD + rowOf(i) * stepY });

    /* Une diagonale n est gravee que si la topologie l autorise ET si la paire
       reste dans le plateau. Pour "main", les deux points doivent etre sur la
       MEME grande diagonale (r = c, ou r + c = cols - 1). */
    function diagonalAllowed(r, c, nr, nc) {
      if (topology === "all") return true;
      if (topology === "main") {
        return (r === c && nr === nc) || (r + c === cols - 1 && nr + nc === cols - 1);
      }
      return strong(r, c) && strong(nr, nc);
    }

    /* Segments a graver : toutes les orthogonales, puis les diagonales que la
       topologie autorise. Chaque paire n apparait qu une fois (on ne descend
       que vers la ligne suivante). */
    function buildSegments() {
      const L = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = index(r, c);
          if (c + 1 < cols) L.push([i, index(r, c + 1)]);
          if (r + 1 < rows) L.push([i, index(r + 1, c)]);
          if (r + 1 < rows && c + 1 < cols && diagonalAllowed(r, c, r + 1, c + 1)) L.push([i, index(r + 1, c + 1)]);
          if (r + 1 < rows && c - 1 >= 0 && diagonalAllowed(r, c, r + 1, c - 1)) L.push([i, index(r + 1, c - 1)]);
        }
      }
      return L;
    }
    const SEGMENTS = buildSegments();

    /* Rectangle d une cible dans une surface w x h, marge p. Les cibles se
       touchent : au doigt, viser le milieu d une maille revient toujours a
       viser une intersection. */
    function cellRect(i, w, h, p) {
      const g = typeof p === "number" ? p : 0;
      const sx = (w - 2 * g) / (cols - 1);
      const sy = (h - 2 * g) / (rows - 1);
      const size = Math.min(sx, sy) * CELL_RATIO;
      return { x: g + colOf(i) * sx - size / 2, y: g + rowOf(i) * sy - size / 2, w: size, h: size };
    }

    /* Clic (x, y) -> indice de case, ou null hors de la surface. A l interieur,
       on rend l intersection la PLUS PROCHE : c est exactement ce que fait la
       couche de boutons du rendu. */
    function hitTest(x, y, w, h, p) {
      if (!(x >= 0 && y >= 0 && x <= w && y <= h)) return null;
      if (!(w > 0) || !(h > 0)) return null;
      const g = typeof p === "number" ? p : 0;
      const sx = (w - 2 * g) / (cols - 1);
      const sy = (h - 2 * g) / (rows - 1);
      if (!(sx > 0) || !(sy > 0)) return null;
      const c = Math.max(0, Math.min(cols - 1, Math.round((x - g) / sx)));
      const r = Math.max(0, Math.min(rows - 1, Math.round((y - g) / sy)));
      return index(r, c);
    }


    /* -------------------------------------------------------------------
       RENDU : `host` recoit le plateau entier. `view` decrit ce qu on peint :
         values    tableau des cases (1 = clairs, 2 = sombres, 0 = vide)
         selected  case selectionnee (ou null)
         disabled  vrai quand le joueur local ne peut pas jouer
         onCell    appele au clic / au clavier sur une intersection
         owner     (valeur) -> "me" | "opp" (defaut : camp 1 = moi)
         last      cases du dernier coup (anneau)
         caps      cases prises au dernier coup
         winLine   alignement gagnant (Telo), trace d un trait
         plate     URL d une photo de plaque carree (fond peint sous le treillis)
       Retourne les boutons de case (pratique pour les tests d integration).
       ------------------------------------------------------------------- */
    function render(host, view) {
      const v = view || {};
      if (!host) return [];
      if (typeof document === "undefined") return [];
      const prefix = v.slug || "fp";

      host.innerHTML = "";
      host.classList.add(prefix + "-board");

      /* LA PLAQUE : le cadre grave (bande claire, moulure, ombre portee) est un
         PARENT du plateau, jamais son contour. Le repere interne du plateau
         (pourcentages de 0 a VIEW) reste donc rigoureusement le meme : seule la
         plaque grandit autour, et un debordement de pion se calcule comme avant.
         `--fp-step-n` publie le pas en unites de plateau (100 / pas) : c est ce
         nombre qui permet au CSS de dimensionner la plaque pour que le PAS soit
         identique d une variante a l autre. L echelle du systeme est le pas,
         pas la largeur de la carte. */
      const plate = document.createElement("div");
      plate.className = "plate fp-plate";
      plate.style.setProperty("--fp-step-n", (100 / STEP).toFixed(4));

      /* LA VRAIE PLAQUE (optionnelle) : `plate` est l URL d une photo de plaque
         recadree carree, bande gravee comprise. On la pose en PREMIER enfant du
         parent, donc SOUS tout le reste (champ, treillis, pions) : c est un fond
         peint, jamais un element d interface. Sans `plate`, aucune classe et
         aucune balise : le plateau garde exactement l habillage vectoriel.
         La bascule se fait au CHARGEMENT de l image, jamais a l insertion :
         `has-art` rend le champ transparent, donc s il tombait avant le `load`
         on verrait, le temps du decodage, le `background-color` clair de la
         plaque A TRAVERS le champ — un champ clair fugace. En attendant le
         `load`, la frise et le degrade peints restent en place ; le fondu CSS
         de `.fp-plate-art` masque la substitution. Et si l image echoue, on
         retire la balise : on retombe sur l etat d aujourd hui, a l identique. */
      if (v.plate) {
        const art = document.createElement("img");
        art.className = "fp-plate-art";
        /* Decorative : le sens du plateau est porte par les boutons de case. */
        art.setAttribute("alt", "");
        art.setAttribute("aria-hidden", "true");
        art.setAttribute("decoding", "async");
        art.setAttribute("draggable", "false");
        /* Les deux ecouteurs sont poses AVANT `src`, sinon un echec immediat
           (asset absent, 404) ou un chargement depuis le cache pourrait se
           produire avant qu on ecoute. */
        const url = String(v.plate);
        /* Deja vue : on ne rejoue pas la substitution, on l affiche d emblee
           (la classe est posee avant l insertion, donc opacity vaut 1 des la
           premiere mise en forme : aucune transition). */
        if (PLATES_OK[url]) plate.classList.add("has-art");
        art.addEventListener("load", () => {
          PLATES_OK[url] = true;
          plate.classList.add("has-art");
        });
        art.addEventListener("error", () => {
          plate.classList.remove("has-art");
          if (art.parentNode) art.parentNode.removeChild(art);
        });
        art.src = url;
        plate.appendChild(art);
      }

      const wrap = document.createElement("div");
      wrap.className = "board fp-board";
      /* Deux mesures, en pourcentage de la largeur du plateau : le pion ne peut
         pas depasser sa maille, la cible la remplit exactement. */
      wrap.style.setProperty("--fp-pawn", (STEP * PAWN_RATIO).toFixed(2) + "%");
      wrap.style.setProperty("--fp-cell", (STEP * CELL_RATIO).toFixed(2) + "%");

      const svg = el("svg", {
        viewBox: "0 0 " + VIEW + " " + VIEW,
        class: "fp-svg " + prefix + "-svg",
        /* Le treillis est decoratif : ce sont les boutons qui portent le sens. */
        "aria-hidden": "true", focusable: "false",
      });

      const gLine = el("g", { class: "fp-lines" });
      const gDiag = el("g", { class: "fp-diagonals" });
      for (let k = 0; k < SEGMENTS.length; k++) {
        const a = SEGMENTS[k][0], b = SEGMENTS[k][1];
        const A = point(a), B = point(b);
        const diagonal = rowOf(a) !== rowOf(b) && colOf(a) !== colOf(b);
        (diagonal ? gDiag : gLine).appendChild(el("line", {
          x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: diagonal ? "fp-diag" : "fp-line",
        }));
      }

      const gNode = el("g", { class: "fp-nodes" });
      for (let i = 0; i < CELLS; i++) {
        const p = point(i);
        gNode.appendChild(el("circle", { cx: p.x, cy: p.y, r: 1.05, class: "fp-node" }));
      }

      const gMark = el("g", { class: "fp-marks" });
      (v.last || []).forEach((i) => {
        const p = point(i);
        gMark.appendChild(el("circle", { cx: p.x, cy: p.y, r: 6.6, class: "fp-mark fp-mark-last" }));
      });
      (v.caps || []).forEach((i) => {
        const p = point(i);
        gMark.appendChild(el("circle", { cx: p.x, cy: p.y, r: 4.2, class: "fp-mark fp-mark-cap" }));
      });
      if (v.winLine && v.winLine.length > 1) {
        const A = point(v.winLine[0]), B = point(v.winLine[v.winLine.length - 1]);
        gMark.appendChild(el("line", { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: "fp-win-line" }));
      }

      svg.appendChild(gLine);
      svg.appendChild(gDiag);
      svg.appendChild(gNode);
      svg.appendChild(gMark);

      /* Pions : de VRAIS `.piece`, donc exactement l habillage du plateau Tsivy
         (couleur, motif, forme, anneau de selection). `.me` / `.opp` disent a
         QUI appartient le pion ; `.clair` / `.sombre` disent quelle COULEUR il
         porte â€” les deux informations qui choisissent le jeu de variables. */
      const pieces = document.createElement("div");
      pieces.className = "pieces fp-pieces";
      for (let i = 0; i < CELLS; i++) {
        const val = v.values ? v.values[i] : 0;
        if (val !== 1 && val !== 2) continue;
        const p = point(i);
        const owner = typeof v.owner === "function" ? v.owner(val) : (val === 1 ? "me" : "opp");
        const d = document.createElement("div");
        d.className = "piece " + (owner === "opp" ? "opp" : "me") + " " + (val === 1 ? "clair" : "sombre") +
          " fp-piece " + prefix + "-piece";
        if (v.selected === i) d.classList.add("sel");
        d.dataset.cell = String(i);
        d.dataset.pawn = String(val);
        d.style.left = p.x + "%";
        d.style.top = p.y + "%";
        pieces.appendChild(d);
      }

      /* Cibles : des BOUTONS, donc focusables et annonces. Ils sont transparents
         et couvrent le plateau ; leur libelle dit la ligne et la colonne. */
      const cells = document.createElement("div");
      cells.className = "cells fp-cells";
      const out = [];
      const win = v.winLine || null;
      for (let i = 0; i < CELLS; i++) {
        const p = point(i);
        const val = v.values ? v.values[i] : 0;
        const b = document.createElement("button");
        b.type = "button";
        let cls = "cell fp-cell " + prefix + "-cell";
        if (v.selected === i) cls += " fp-sel " + prefix + "-sel";
        if (win && win.indexOf(i) >= 0) cls += " fp-win " + prefix + "-win";
        /* Aides au deplacement : `hints` liste les arrivees legales du pion
           selectionne (ou les intersections libres, en phase de pose). La
           decision reste au module de jeu — le plateau ne fait que la peindre. */
        if (v.hints && v.hints.indexOf(i) >= 0) cls += " fp-hint";
        b.className = cls;
        b.dataset.cell = String(i);
        if (val === 1 || val === 2) b.dataset.pawn = String(val);
        b.style.left = p.x + "%";
        b.style.top = p.y + "%";
        b.setAttribute("aria-label", "Case " + (rowOf(i) + 1) + " - " + (colOf(i) + 1));
        if (v.disabled) b.disabled = true;
        if (typeof v.onCell === "function") {
          b.addEventListener("click", () => v.onCell(i));
        }
        cells.appendChild(b);
        out.push(b);
      }

      wrap.appendChild(svg);
      wrap.appendChild(pieces);
      wrap.appendChild(cells);
      plate.appendChild(wrap);
      host.appendChild(plate);
      return out;
    }

    return {
      ROWS: rows, COLS: cols, CELLS: CELLS,
      PAD: PAD, STEP: STEP, STEPX: stepX, STEPY: stepY,
      index: index, rowOf: rowOf, colOf: colOf, strong: strong, point: point,
      SEGMENTS: SEGMENTS, LINES: SEGMENTS,
      cellRect: cellRect, hitTest: hitTest, render: render,
    };
  }

  /* ---------------------------------------------------------------------
     HABILLAGE DES PIONS

     Une seule fonction ecrit les attributs qui commandent `#pion-styles`
     (`data-pion-color` / `-motif` / `-forme`), donc les variables `--pion-*`
     heritees par les pions du plateau. Le suffixe est celui du JEU de
     variables, pas du camp : "" et "-dark" pour moi, "-opp" et "-opp-dark"
     pour l adversaire â€” exactement les quatre jeux que le plateau Tsivy
     consomme. Une variante ne peut donc pas peindre autre chose que ce que
     la boutique promet.
     --------------------------------------------------------------------- */
  function setStyleAttrs(target, style, suf) {
    if (!target || !style) return;
    const s = suf || "";
    if (style.shape) target.setAttribute("data-pion-forme" + s, style.shape);
    if (style.color) target.setAttribute("data-pion-color" + s, style.color);
    if (style.pattern) target.setAttribute("data-pion-motif" + s, style.pattern);
  }

  function paintPionStyles(target, sets) {
    const s = sets || {};
    if (!target) return;
    if (s.me) { setStyleAttrs(target, s.me.light, ""); setStyleAttrs(target, s.me.dark, "-dark"); }
    if (s.opp) { setStyleAttrs(target, s.opp.light, "-opp"); setStyleAttrs(target, s.opp.dark, "-opp-dark"); }
  }

  return {
    VIEW: VIEW, PAD: PAD, PAWN_RATIO: PAWN_RATIO, CELL_RATIO: CELL_RATIO,
    create: create, setStyleAttrs: setStyleAttrs, paintPionStyles: paintPionStyles,
  };
});

