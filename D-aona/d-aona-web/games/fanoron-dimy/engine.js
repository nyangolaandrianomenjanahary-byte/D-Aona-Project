/* =========================================================
   D-aôna — Fanoron-dimy : moteur de règles (grille 5 × 5)
   ---------------------------------------------------------
   Le fanorona « moyen » : douze pions par camp, prises par
   APPROCHE (pions adverses alignés DERRIÈRE la case d'arrivée) et par
   RETRAIT (pions adverses alignés DERRIÈRE la case de départ). Le
   déplacement est libre le long des lignes gravées : orthogonal partout,
   diagonal UNIQUEMENT depuis un point fort ((ligne + colonne) paire),
   comme sur le plateau Tsivy.

   Une prise n'est jamais obligatoire ; elle met fin au coup (pas de
   chaîne dans cette variante — hypothèse consignée dans README.md).

   Ce fichier est la SEULE source des règles : le navigateur le charge
   comme script (`window.FanoronDimy`) et les tests le `require()`.
   Aucune dépendance DOM, aucune horloge : toutes les fonctions sont
   PURES (l'état reçu n'est jamais modifié).

   Numérotation des cases (identique au rendu), index = ligne * 5 + colonne :

        0  1  2  3  4
        5  6  7  8  9
       10 11 12 13 14
       15 16 17 18 19
       20 21 22 23 24
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronDimy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- Constantes du jeu ---------- */
  const ROWS = 5;
  const COLS = 5;
  const SIZE = 5;
  const CELLS = ROWS * COLS;
  const PAWNS_PER_PLAYER = 12;
  /* Nulle de « piétinement » : 60 demi-coups sans la moindre prise. Le
     fanorona ne connaît pas la nulle par répétition, mais une partie sans
     prise ne peut pas se conclure — mieux vaut l'annoncer que boucler. */
  const SILENT_LIMIT = 60;

  const REASON = { CAPTURE: "capture", BLOCKED: "blocage", DRAW: "nulle" };

  const DIRS = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr || dc) DIRS.push([dr, dc]);

  /* ---------- Petits utilitaires ---------- */
  const index = (r, c) => r * COLS + c;
  const rowOf = (i) => Math.floor(i / COLS);
  const colOf = (i) => i % COLS;
  const other = (p) => (p === 1 ? 2 : 1);
  const onBoard = (i) => Number.isInteger(i) && i >= 0 && i < CELLS;
  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  /* Point fort : seule une intersection « étoile / losange » du plateau
     gravé porte des diagonales. Un pas diagonal conserve la parité de
     (r + c), donc départ et arrivée sont tous deux des points forts. */
  const strong = (r, c) => (r + c) % 2 === 0;

  function countPieces(board, player) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (board[i] === player) n++;
    return n;
  }

  /* Position de départ : deux rangées pleines par camp, rangée centrale
     alternée, centre vide — 12 pions de chaque côté, 1 point libre. */
  function initialBoard() {
    const b = new Array(CELLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      b[index(0, c)] = 2;
      b[index(1, c)] = 2;
      b[index(3, c)] = 1;
      b[index(4, c)] = 1;
    }
    b[index(2, 0)] = 2;
    b[index(2, 1)] = 1;
    b[index(2, 3)] = 1;
    b[index(2, 4)] = 2;
    return b;
  }


  /* ---------- Création / copie d'état ---------- */
  function createState(opts) {
    const o = opts || {};
    let board;
    if (Array.isArray(o.board)) {
      board = o.board.slice(0, CELLS).map((v) => (v === 1 || v === 2 ? v : 0));
      while (board.length < CELLS) board.push(0);
    } else {
      board = initialBoard();
    }
    const state = {
      board,
      turn: o.turn === 2 ? 2 : 1,
      silent: Number.isInteger(o.silent) ? o.silent : 0,
      over: false,
      winner: 0,
      reason: null,
      last: null,
    };
    const st = status(state);
    state.over = st.over;
    state.winner = st.winner;
    state.reason = st.reason;
    return state;
  }

  function clone(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      silent: state.silent || 0,
      over: !!state.over,
      winner: state.winner || 0,
      reason: state.reason || null,
      last: state.last ? { from: state.last.from, to: state.last.to, cap: state.last.cap.slice() } : null,
    };
  }

  /* Signature compacte : plateau + trait. Sert aux tests et aux tables. */
  function key(state) {
    return state.board.join("") + "|" + state.turn;
  }

  /* ---------- Coups ---------- */
  /* Pions adverses consécutifs à partir de (r, c), dans la direction (dr, dc). */
  function ray(board, r, c, dr, dc, enemy) {
    const out = [];
    let rr = r, cc = c;
    while (inBoard(rr, cc) && board[index(rr, cc)] === enemy) {
      out.push(index(rr, cc));
      rr += dr;
      cc += dc;
    }
    return out;
  }

  /* Tous les coups possibles d'un pion donné. Un couple (départ, arrivée)
     peut produire DEUX coups : approche et retrait, avec des prises
     différentes. Les deux sont proposés — c'est le joueur qui choisit. */
  function movesFrom(board, from, me) {
    if (!onBoard(from) || board[from] !== me) return [];
    const enemy = other(me);
    const r = rowOf(from), c = colOf(from);
    const out = [];
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      if (dr !== 0 && dc !== 0 && !strong(r, c)) continue;   // diagonale : points forts seulement
      const nr = r + dr, nc = c + dc;
      if (!inBoard(nr, nc) || board[index(nr, nc)] !== 0) continue;   // chemin bloqué

      const apr = ray(board, nr + dr, nc + dc, dr, dc, enemy);
      const ret = ray(board, r - dr, c - dc, -dr, -dc, enemy);
      const to = index(nr, nc);
      if (apr.length) out.push({ from, to, dir: [dr, dc], kind: "apr", cap: apr });
      if (ret.length) out.push({ from, to, dir: [dr, dc], kind: "ret", cap: ret });
      if (!apr.length && !ret.length) out.push({ from, to, dir: [dr, dc], kind: "paika", cap: [] });
    }
    return out;
  }

  /* Tous les coups du joueur au trait, les plus gourmands d'abord : quand
     l'interface propose `{ from, to }` sans préciser le sens, c'est la prise
     la plus forte qui l'emporte. */
  function legalMoves(state) {
    if (!state || state.over) return [];
    const me = state.turn;
    let all = [];
    for (let i = 0; i < CELLS; i++)
      if (state.board[i] === me) all = all.concat(movesFrom(state.board, i, me));
    return all.sort((a, b) => b.cap.length - a.cap.length);
  }

  function findLegal(state, move) {
    if (!state || state.over || !move) return null;
    if (!onBoard(move.from) || !onBoard(move.to) || move.from === move.to) return null;
    const list = legalMoves(state);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.from !== move.from || m.to !== move.to) continue;
      if (move.kind && m.kind !== move.kind) continue;
      return m;
    }
    return null;
  }

  function isLegal(state, move) {
    return !!findLegal(state, move);
  }

  /* Applique un coup et rend un NOUVEL état. Aucun effet de bord :
     l'état d'entrée reste intact (l'appelant décide de le remplacer). */
  function applyMove(state, move) {
    const m = findLegal(state, move);
    if (!m) return { ok: false, error: "illegal", state };

    const board = state.board.slice();
    board[m.from] = 0;
    board[m.to] = state.turn;
    for (let i = 0; i < m.cap.length; i++) board[m.cap[i]] = 0;

    const next = {
      board,
      turn: other(state.turn),
      silent: m.cap.length ? 0 : (state.silent || 0) + 1,
      over: false,
      winner: 0,
      reason: null,
      last: { from: m.from, to: m.to, cap: m.cap.slice() },
    };
    const st = status(next);
    next.over = st.over;
    next.winner = st.winner;
    next.reason = st.reason;
    return { ok: true, state: next, move: m };
  }

  /* ---------- Fin de partie ---------- */
  function status(state) {
    if (!state) return { over: false, winner: 0, reason: null };
    if (state.over) return { over: true, winner: state.winner || 0, reason: state.reason || null };

    const me = countPieces(state.board, state.turn);
    const opp = countPieces(state.board, other(state.turn));
    if (!opp) return { over: true, winner: state.turn, reason: REASON.CAPTURE };
    if (!me) return { over: true, winner: other(state.turn), reason: REASON.CAPTURE };
    if ((state.silent || 0) >= SILENT_LIMIT) return { over: true, winner: 0, reason: REASON.DRAW };
    if (!legalMoves(state).length) return { over: true, winner: other(state.turn), reason: REASON.BLOCKED };
    return { over: false, winner: 0, reason: null };
  }

  /* Score matériel, du point de vue de `player`. */
  function material(state, player) {
    return countPieces(state.board, player) - countPieces(state.board, other(player));
  }

  return {
    ROWS, COLS, SIZE, CELLS, PAWNS_PER_PLAYER, SILENT_LIMIT, REASON, DIRS,
    index, rowOf, colOf, other, onBoard, inBoard, strong, countPieces,
    initialBoard, createState, clone, key,
    ray, movesFrom, legalMoves, findLegal, isLegal, applyMove, status, material,
  };
});

