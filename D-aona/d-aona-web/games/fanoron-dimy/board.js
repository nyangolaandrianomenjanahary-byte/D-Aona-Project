/* =========================================================
   D-Aona - Fanoron-dimy : PLATEAU (geometrie + rendu)
   ---------------------------------------------------------
   Aucune regle ici : ce fichier sait OU sont les intersections et
   comment les peindre (lignes gravees + pions). Les coups valides
   viennent de engine.js, l interaction de ui.js.

   Le plateau est un SVG de 100 x 100 unites : 5 lignes x 5 colonnes,
   orthogonales partout, diagonales UNIQUEMENT depuis les points forts
   (parite de ligne + colonne) — la meme geometrie que le moteur.
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronDimy ? root.FanoronDimy
    : (typeof require === "function" ? require("./engine.js") : null);
  const api = factory(E);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronDimyBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E) {
  "use strict";

  const SIZE = (E && E.SIZE) || 5;
  const CELLS = SIZE * SIZE;
  const VIEW = 100;
  const PAD = 10;
  const STEP = (VIEW - PAD * 2) / (SIZE - 1);

  const index = (r, c) => r * SIZE + c;
  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;
  const point = (i) => ({ x: PAD + colOf(i) * STEP, y: PAD + rowOf(i) * STEP });

  /* Segments du plateau : toutes les orthogonales, puis les deux
     diagonales de chaque point fort. Chaque paire n apparait qu une fois. */
  function buildLines() {
    const L = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const i = index(r, c);
        if (c + 1 < SIZE) L.push([i, index(r, c + 1)]);
        if (r + 1 < SIZE) L.push([i, index(r + 1, c)]);
        if ((r + c) % 2 === 0) {
          if (r + 1 < SIZE && c + 1 < SIZE) L.push([i, index(r + 1, c + 1)]);
          if (r + 1 < SIZE && c - 1 >= 0) L.push([i, index(r + 1, c - 1)]);
        }
      }
    }
    return L;
  }
  const LINES = buildLines();

  /* Rectangle d une case dans une surface w x h, marge p. Les cases se
     touchent (pas de trou entre deux intersections) : au doigt, viser le
     milieu d une maille revient toujours a viser une intersection. */
  function cellRect(i, w, h, p) {
    const g = typeof p === "number" ? p : 0;
    const stepX = (w - 2 * g) / (SIZE - 1);
    const stepY = (h - 2 * g) / (SIZE - 1);
    const size = Math.min(stepX, stepY);
    return { x: g + colOf(i) * stepX - size / 2, y: g + rowOf(i) * stepY - size / 2, w: size, h: size };
  }

  /* Clic (x, y) -> indice de case, ou null hors plateau. Les coordonnees
     hors de la surface (négatives ou au-delà de w / h) ne touchent rien :
     un appui dans la marge de la page ne doit jamais deplacer un pion. */
  function hitTest(x, y, w, h, p) {
    if (!(x >= 0 && y >= 0 && x <= w && y <= h)) return null;
    for (let i = 0; i < CELLS; i++) {
      const r = cellRect(i, w, h, p);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return null;
  }

  const SVG = "http://www.w3.org/2000/svg";
  const el = (name, attrs) => {
    const n = document.createElementNS(SVG, name);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  };

  /* Rendu SVG dans `host`. opts.onCell(i) est appele au clic / clavier.
     Retourne les noeuds de case (pratique pour les tests d integration). */
  function render(host, state, opts) {
    const o = opts || {};
    if (!host) return [];
    host.innerHTML = "";
    host.className = ((host.className || "") + " dimy-board").trim();

    const svg = el("svg", { viewBox: "0 0 " + VIEW + " " + VIEW, class: "dimy-svg", role: "grid",
      "aria-label": "Plateau de Fanoron-dimy, " + SIZE + " par " + SIZE });
    const gL = el("g", { class: "dimy-lines" });
    for (let i = 0; i < LINES.length; i++) {
      const A = point(LINES[i][0]), B = point(LINES[i][1]);
      gL.appendChild(el("line", { x1: A.x, y1: A.y, x2: B.x, y2: B.y }));
    }
    svg.appendChild(gL);

    const gP = el("g", { class: "dimy-points" });
    const nodes = [];
    const last = state && state.last ? state.last : null;
    for (let i = 0; i < CELLS; i++) {
      const p = point(i);
      const g = el("g", { class: "dimy-point", "data-cell": i, role: "button",
        tabindex: o.disabled ? "-1" : "0",
        "aria-label": "Case " + (rowOf(i) + 1) + " - " + (colOf(i) + 1) });
      g.appendChild(el("circle", { class: "dimy-hit", cx: p.x, cy: p.y, r: 8 }));
      const v = state && state.board ? state.board[i] : 0;
      if (v === 1 || v === 2) {
        g.appendChild(el("circle", { class: "dimy-pawn " + (v === 1 ? "clair" : "sombre"),
          cx: p.x, cy: p.y, r: 5.4 }));
      }
      if (o.selected === i) g.classList.add("dimy-sel");
      if (last && (last.from === i || last.to === i)) g.classList.add("dimy-last");
      if (last && last.cap && last.cap.indexOf(i) >= 0) g.classList.add("dimy-cap");
      if (o.disabled) g.setAttribute("aria-disabled", "true");
      if (o.onCell) {
        g.addEventListener("click", () => o.onCell(i));
        g.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
          e.preventDefault();
          o.onCell(i);
        });
      }
      gP.appendChild(g);
      nodes.push(g);
    }
    svg.appendChild(gP);
    host.appendChild(svg);
    return nodes;
  }

  return { SIZE, CELLS, LINES, PAD, STEP, index, rowOf, colOf, point, cellRect, hitTest, render };
});
