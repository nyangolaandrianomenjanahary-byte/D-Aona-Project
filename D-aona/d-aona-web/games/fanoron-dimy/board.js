/* =========================================================
   D-Aona - Fanoron-dimy : PLATEAU (geometrie + rendu)
   ---------------------------------------------------------
   Aucune regle ici : ce fichier sait OU sont les intersections et comment
   les peindre. Les coups valides viennent de engine.js, l interaction de
   ui.js.

   Le plateau est celui de TOUS les fanorona : `games/fanorona-board.js`
   (treillis grave, pions sur les intersections, habillage de pion du
   compte). Ce fichier ne fournit que la GEOMETRIE du Dimy — 5 x 5,
   orthogonales partout, diagonales UNIQUEMENT depuis les points forts
   (parite de ligne + colonne) — la meme que celle du moteur.
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronDimy ? root.FanoronDimy
    : (typeof require === "function" ? require("./engine.js") : null);
  const FP = root && root.FanoronaBoard ? root.FanoronaBoard
    : (typeof require === "function" ? require("../fanorona-board.js") : null);
  const api = factory(E, FP);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronDimyBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E, FP) {
  "use strict";

  if (!FP || typeof FP.create !== "function") {
    throw new Error("Fanoron-dimy : games/fanorona-board.js doit etre charge avant board.js");
  }

  const SIZE = (E && E.SIZE) || 5;
  const G = FP.create({
    rows: (E && E.ROWS) || SIZE,
    cols: (E && E.COLS) || SIZE,
    /* Meme regle que le moteur : diagonale seulement depuis un point fort. */
    topology: "strong",
  });

  const LINES = G.SEGMENTS;

  /* Rendu dans `host`. opts.onCell(i) est appele au clic / clavier.
     Retourne les boutons de case (tests d integration). */
  function render(host, state, opts) {
    const o = opts || {};
    const s = state || {};
    const last = s.last && typeof s.last.from === "number" ? s.last : null;
    return G.render(host, {
      slug: "dimy",
      /* Vraie plaque photo, recadree carree (bande gravee COMPRISE). Sa bande
         mesure 55 px sur 864 — soit exactement les 6,37 % de l inset CSS : le
         liseré clair qui la séparait du champ a été mangé par le champ (outil
         `_fp_no_rim.py`), et c est cette nouvelle bande que le CSS reproduit,
         donc l echelle du plateau ne bouge pas. La frise y est continue (plus
         de motif tuile) et le champ est nu : c est le treillis du Dimy, et lui
         seul, qui se grave dessus. Le module retombe de lui-meme sur la plaque
         vectorielle si l image manque. */
      plate: "assets/board/plateau_square.webp",
      values: s.board || [],
      selected: typeof o.selected === "number" ? o.selected : null,
      disabled: !!o.disabled,
      /* AIDES AU DÉPLACEMENT : la liste des arrivées légales est calculée par
         l'appelant (`variant-match.js`, à partir des coups du moteur) et doit
         TRAVERSER ce module pour atteindre les cases — sans cette ligne, la
         bascule « Aides au déplacement » ne peignait rien. */
      hints: Array.isArray(o.hints) ? o.hints : null,
      onCell: o.onCell,
      owner: o.owner,
      last: last ? [last.from, last.to] : null,
      caps: last && last.cap ? last.cap : null,
    });
  }

  return {
    SIZE: SIZE, ROWS: G.ROWS, COLS: G.COLS, CELLS: G.CELLS,
    LINES: LINES, PAD: G.PAD, STEP: G.STEP,
    index: G.index, rowOf: G.rowOf, colOf: G.colOf, point: G.point,
    cellRect: G.cellRect, hitTest: G.hitTest, render: render,
  };
});
