/* =========================================================
   D-Aona - Fanoron-telo : PLATEAU (geometrie + rendu)
   ---------------------------------------------------------
   Aucune regle ici : ce fichier sait OU sont les intersections et comment
   les peindre. Les coups valides viennent de engine.js, l interaction de
   ui.js. Le rendu ne decide jamais qu un coup est legal.

   Meme plateau que le Tsivy et le Dimy : `games/fanorona-board.js`. Le Telo
   n en fournit que la geometrie — 3 x 3, orthogonales partout et les DEUX
   grandes diagonales (celles qui passent par le centre) — exactement
   l adjacence du moteur (`ADJ`). Les neuf intersections sont donc reliees
   comme sur un plateau grave, et les pions se posent DESSUS (plus de grille
   de cases).
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronTelo ? root.FanoronTelo
    : (typeof require === "function" ? require("./engine.js") : null);
  const FP = root && root.FanoronaBoard ? root.FanoronaBoard
    : (typeof require === "function" ? require("../fanorona-board.js") : null);
  const api = factory(E, FP);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronTeloBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E, FP) {
  "use strict";

  if (!FP || typeof FP.create !== "function") {
    throw new Error("Fanoron-telo : games/fanorona-board.js doit etre charge avant board.js");
  }

  const G = FP.create({ rows: 3, cols: 3, topology: "main" });

  /* Les 8 lignes gagnantes en indices de cases : c est de la GEOMETRIE. Le
     moteur publie les siennes, on les reprend pour ne jamais diverger. */
  const LINES = (E && E.WIN_LINES) ? E.WIN_LINES : defaultLines();

  function defaultLines() {
    const L = [];
    for (let r = 0; r < 3; r++) L.push([0, 1, 2].map((c) => G.index(r, c)));
    for (let c = 0; c < 3; c++) L.push([0, 1, 2].map((r) => G.index(r, c)));
    L.push([G.index(0, 0), G.index(1, 1), G.index(2, 2)]);
    L.push([G.index(0, 2), G.index(1, 1), G.index(2, 0)]);
    return L;
  }

  /* Rendu dans `host` ; opts.onCell(i) est appele au clic / clavier.
     `state.line` (alignement gagnant) passe en surlignage, `state.lastMove`
     en anneau de dernier coup — pose ou glisse. */
  function render(host, state, opts) {
    const o = opts || {};
    const s = state || {};
    const lm = s.lastMove || null;
    let last = null;
    if (lm) last = lm.type === "place" ? [lm.to] : [lm.from, lm.to];
    return G.render(host, {
      slug: "telo",
      /* Meme plaque photo que le Dimy : recadree carree, bande gravee comprise,
         bande reelle de 55 px sur 864 = les 6,37 % de l inset CSS (le liseré
         clair a été mangé par le champ, `_fp_no_rim.py` ; le pas et la
         geometrie sont donc inchanges). La frise photographiee est continue et
         le champ reste nu : seules les deux grandes diagonales du Telo s y
         ajoutent. Repli vectoriel automatique si l image manque. */
      plate: "assets/board/plateau_square.webp",
      values: s.board || [],
      selected: typeof o.selected === "number" ? o.selected : null,
      disabled: !!o.disabled,
      /* AIDES AU DÉPLACEMENT : arrivées légales calculées par l'appelant
         (`variant-match.js`) ; sans ce passage, la bascule ne peignait rien. */
      hints: Array.isArray(o.hints) ? o.hints : null,
      onCell: o.onCell,
      owner: o.owner,
      last: last,
      winLine: s.line || null,
    });
  }

  return {
    SIZE: G.ROWS, CELLS: G.CELLS, SEGMENTS: G.SEGMENTS, LINES: LINES,
    PAD: G.PAD, STEP: G.STEP,
    index: G.index, rowOf: G.rowOf, colOf: G.colOf, point: G.point,
    cellRect: G.cellRect, hitTest: G.hitTest, render: render,
  };
});
