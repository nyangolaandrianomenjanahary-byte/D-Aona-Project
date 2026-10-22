/* =========================================================
   D-Aona - Fanoron-telo : PLATEAU (geometrie + rendu)
   ---------------------------------------------------------
   Aucune regle ici : ce fichier sait OU sont les cases et comment les
   peindre. Les coups valides viennent de engine.js, l interaction de ui.js.
   Le rendu ne decide jamais qu un coup est legal.
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronTelo ? root.FanoronTelo
    : (typeof require === "function" ? require("./engine.js") : null);
  const api = factory(E);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronTeloBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E) {
  "use strict";

  const SIZE = 3;
  const CELLS = SIZE * SIZE;

  const index = (r, c) => r * SIZE + c;
  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;

  /* Les 8 lignes gagnantes en indices de cases : c est de la GEOMETRIE. Le
     moteur publie les siennes, on les reprend pour ne jamais diverger. */
  const LINES = (E && E.WIN_LINES) ? E.WIN_LINES : defaultLines();

  function defaultLines() {
    const L = [];
    for (let r = 0; r < SIZE; r++) L.push([0, 1, 2].map((c) => index(r, c)));
    for (let c = 0; c < SIZE; c++) L.push([0, 1, 2].map((r) => index(r, c)));
    L.push([index(0, 0), index(1, 1), index(2, 2)]);
    L.push([index(0, 2), index(1, 1), index(2, 0)]);
    return L;
  }

  /* Rectangle d une case dans une surface w x h, gouttiere g. */
  function cellRect(i, w, h, g) {
    const p = g || 0;
    const cw = (w - p * (SIZE + 1)) / SIZE;
    const ch = (h - p * (SIZE + 1)) / SIZE;
    return { x: p + colOf(i) * (cw + p), y: p + rowOf(i) * (ch + p), w: cw, h: ch };
  }

  /* Clic (x, y) -> indice de case, ou null hors plateau. */
  function hitTest(x, y, w, h, g) {
    for (let i = 0; i < CELLS; i++) {
      const r = cellRect(i, w, h, g);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return null;
  }

  /* Rendu DOM : `host` recoit 9 boutons ; opts.onCell(i) est appele au clic. */
  function render(host, state, opts) {
    const o = opts || {};
    if (!host) return null;
    host.innerHTML = "";
    host.className = ((host.className || "") + " telo-board").trim();
    const win = state && state.line ? state.line : null;
    const cells = [];
    for (let i = 0; i < CELLS; i++) {
      const b = document.createElement("button");
      b.type = "button";
      let cls = "telo-cell";
      b.setAttribute("data-cell", String(i));
      const v = state && state.board ? state.board[i] : 0;
      if (v === 1 || v === 2) b.setAttribute("data-pawn", String(v));
      if (win && win.indexOf(i) >= 0) cls += " telo-cell-win";
      if (o.selected === i) cls += " telo-cell-sel";
      b.className = cls;
      if (o.disabled) b.disabled = true;
      if (o.onCell) b.addEventListener("click", () => o.onCell(i));
      host.appendChild(b);
      cells.push(b);
    }
    return cells;
  }

  return { SIZE, CELLS, index, rowOf, colOf, LINES, cellRect, hitTest, render };
});