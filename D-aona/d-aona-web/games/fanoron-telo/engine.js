/* =========================================================
   D-aôna — Fanoron-telo : moteur de règles (grille 3 × 3)
   ---------------------------------------------------------
   Trois pions par camp, HUIT lignes gagnantes, deux phases :

     1. POSE      — chacun pose ses trois pions sur une case libre ;
     2. MOUVEMENT — on glisse un pion vers une intersection VOISINE
                    laissée vide.

   Aucune prise, jamais : la partie se gagne par ALIGNEMENT de ses
   trois pions, se perd par BLOCAGE (aucun coup possible) et peut
   finir NULLE par triple répétition de la position.

   Pourquoi ce fichier est la SEULE source des règles : le navigateur
   le charge comme script (`window.FanoronTelo`) et le serveur le
   `require()`. Une divergence client/serveur serait donc impossible
   par construction — c'est tout l'objet du pied UMD ci-dessous.
   Conséquence pratique : aucune dépendance, aucune API navigateur,
   des fonctions PURES (un état donné ne bouge jamais tout seul).

   Convention de numérotation des cases (identique au rendu) :

         0 | 1 | 2
        ---+---+---
         3 | 4 | 5
        ---+---+---
         6 | 7 | 8

   Le graphe d'adjacence est ÉCRIT À LA MAIN (`ADJ`) et non calculé :
   sur une grille 3 × 3 les seules diagonales possibles passent par le
   centre (0-4-8 et 2-4-6). Un calcul générique produirait des liens
   fantômes (0-2, 0-6…) qu'aucun plateau réel ne possède.
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronTelo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- Constantes du jeu ---------- */
  const SIZE = 3;
  const CELLS = SIZE * SIZE;
  const PAWNS_PER_PLAYER = 3;
  const DRAW_REPEATS = 3; // même position (plateau + trait + phase) vue 3 fois

  const PHASE = { PLACEMENT: "placement", MOVEMENT: "movement" };
  const REASON = { ALIGNMENT: "alignement", DRAW: "nulle", BLOCKED: "blocage" };

  /* Adjacence : 4 orthogonales + 2 diagonales passant par le centre.
     Chaque case est reliée à son symétrique — la table est vérifiée
     par un test dédié plutôt qu'à l'œil. */
  const ADJ = [
    [1, 3, 4], // 0 coin haut-gauche
    [0, 2, 4], // 1 milieu haut
    [1, 4, 5], // 2 coin haut-droit
    [0, 4, 6], // 3 milieu gauche
    [0, 1, 2, 3, 5, 6, 7, 8], // 4 centre : tout le monde
    [2, 4, 8], // 5 milieu droit
    [3, 4, 7], // 6 coin bas-gauche
    [4, 6, 8], // 7 milieu bas
    [4, 5, 7], // 8 coin bas-droit
  ];

  /* Huit lignes gagnantes : 3 rangées, 3 colonnes, 2 diagonales. */
  const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  const CENTER = 4;

  /* ---------- Petits utilitaires ---------- */
  const other = (player) => (player === 1 ? 2 : 1);
  const onBoard = (i) => Number.isInteger(i) && i >= 0 && i < CELLS;

  function newBoard() {
    return new Array(CELLS).fill(0);
  }

  function countPawns(board, player) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (board[i] === player) n++;
    return n;
  }

  /* Renvoie la ligne gagnante du joueur, ou null. L'ordre de WIN_LINES
     fait foi : c'est la ligne surlignée par l'interface. */
  function winnerLine(board, player) {
    for (let i = 0; i < WIN_LINES.length; i++) {
      const line = WIN_LINES[i];
      if (board[line[0]] === player && board[line[1]] === player && board[line[2]] === player) {
        return [line[0], line[1], line[2]];
      }
    }
    return null;
  }

  /* Signature compacte d'une position : plateau + trait + phase.
     Sert au règlement de nulle et aux tables de transposition. */
  function key(state) {
    return state.board.join("") + "|" + state.turn + "|" + state.phase;
  }

  /* ---------- Création d'état ---------- */
  /* `createState()` sans argument = début de partie. Avec un `board`
     fourni, sert aux tests et à l'IA ; les compteurs de pose sont alors
     déduits du plateau (jamais stockés en double). */
  function createState(opts) {
    const o = opts || {};
    const board = Array.isArray(o.board)
      ? o.board.slice(0, CELLS).map((v) => (v === 1 || v === 2 ? v : 0))
      : newBoard();
    while (board.length < CELLS) board.push(0);

    const turn = o.turn === 2 ? 2 : 1;
    const placedCount = { 1: countPawns(board, 1), 2: countPawns(board, 2) };
    const phase =
      o.phase === PHASE.MOVEMENT || o.phase === PHASE.PLACEMENT
        ? o.phase
        : placedCount[1] >= PAWNS_PER_PLAYER && placedCount[2] >= PAWNS_PER_PLAYER
          ? PHASE.MOVEMENT
          : PHASE.PLACEMENT;

    const state = {
      board: board,
      turn: turn,
      phase: phase,
      placedCount: placedCount,
      plies: Number.isInteger(o.plies) ? o.plies : 0,
      over: false,
      winner: null,
      reason: null,
      line: null,
      lastMove: null,
      reps: {},
    };
    state.reps[key(state)] = 1;

    /* Une position construite peut déjà contenir un alignement (tests) :
       on l'annonce au lieu de laisser jouer dedans. */
    const line1 = winnerLine(board, 1);
    const line2 = line1 ? null : winnerLine(board, 2);
    if (line1 || line2) {
      state.over = true;
      state.winner = line1 ? 1 : 2;
      state.reason = REASON.ALIGNMENT;
      state.line = line1 || line2;
    }
    return state;
  }

  /* ---------- Coups légaux ---------- */
  function legalMoves(state) {
    const out = [];
    if (state.over) return out;
    const board = state.board;

    if (state.phase === PHASE.PLACEMENT) {
      /* Sécurité : un joueur ne pose jamais un quatrième pion. Atteignable
         seulement via un état forgé, mais le test le couvre. */
      if (state.placedCount[state.turn] >= PAWNS_PER_PLAYER) return out;
      for (let i = 0; i < CELLS; i++) if (board[i] === 0) out.push({ type: "place", to: i });
      return out;
    }

    for (let from = 0; from < CELLS; from++) {
      if (board[from] !== state.turn) continue;
      const adj = ADJ[from];
      for (let k = 0; k < adj.length; k++) {
        const to = adj[k];
        if (board[to] === 0) out.push({ type: "move", from: from, to: to });
      }
    }
    return out;
  }

  function isLegal(state, move) {
    if (!move) return false;
    const moves = legalMoves(state);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.to !== move.to) continue;
      if (m.type !== move.type) continue;
      if (m.type === "move" && m.from !== move.from) continue;
      return true;
    }
    return false;
  }

  /* ---------- Application d'un coup ---------- */
  /* Renvoie { ok:true, state } ou { ok:false, error }. Jamais d'exception :
     le serveur reçoit des coups de clients distants, un coup illégal est
     une donnée comme une autre, pas un incident. */
  function applyMove(state, move) {
    if (!state || typeof state !== "object") return fail("État inconnu");
    if (state.over) return fail("Partie terminée");
    if (!move || typeof move !== "object") return fail("Coup illisible");

    if (state.phase === PHASE.PLACEMENT) {
      if (move.type && move.type !== "place") return fail("Pose attendue");
      if (!onBoard(move.to)) return fail("Case invalide");
      if (state.placedCount[state.turn] >= PAWNS_PER_PLAYER) return fail("Tous vos pions sont posés");
      if (state.board[move.to] !== 0) return fail("Case occupée");
      const boardA = state.board.slice();
      boardA[move.to] = state.turn;
      return { ok: true, state: commit(state, boardA, { type: "place", to: move.to }) };
    }

    if (move.type && move.type !== "move") return fail("Déplacement attendu");
    if (!onBoard(move.from) || !onBoard(move.to)) return fail("Case invalide");
    if (state.board[move.from] !== state.turn) return fail("Ce n'est pas votre pion");
    if (state.board[move.to] !== 0) return fail("Case occupée");
    if (ADJ[move.from].indexOf(move.to) === -1) return fail("Déplacement non adjacent");

    const boardB = state.board.slice();
    boardB[move.from] = 0;
    boardB[move.to] = state.turn;
    return { ok: true, state: commit(state, boardB, { type: "move", from: move.from, to: move.to }) };
  }

  function fail(error) {
    return { ok: false, error: error };
  }

  /* Fabrique l'état suivant à partir du plateau modifié.
     Ordre des vérifications — il est contractuel :
       1. alignement du joueur qui vient de jouer (priorité absolue) ;
       2. passage de la pose au mouvement quand les 6 pions sont posés ;
       3. blocage de l'adversaire ;
       4. triple répétition.
     Sur un alignement, `turn` N'EST PAS changé : le gagnant garde le
     trait, ce qui rend l'état terminal lisible (winner === turn). */
  function commit(state, board, move) {
    const me = state.turn;
    const placedCount = { 1: countPawns(board, 1), 2: countPawns(board, 2) };
    let phase = state.phase;
    if (
      phase === PHASE.PLACEMENT &&
      placedCount[1] >= PAWNS_PER_PLAYER &&
      placedCount[2] >= PAWNS_PER_PLAYER
    ) {
      phase = PHASE.MOVEMENT;
    }

    const next = {
      board: board,
      turn: me,
      phase: phase,
      placedCount: placedCount,
      plies: state.plies + 1,
      over: false,
      winner: null,
      reason: null,
      line: null,
      lastMove: move,
      reps: Object.assign({}, state.reps),
    };

    /* 1. Alignement */
    const line = winnerLine(board, me);
    if (line) {
      next.over = true;
      next.winner = me;
      next.reason = REASON.ALIGNMENT;
      next.line = line;
      return next;
    }

    /* 2. On passe la main */
    next.turn = other(me);

    /* 3. Blocage : l'adversaire n'a plus un seul coup.
       Note d'honnêteté : avec 3 pions par camp sur ce graphe, un joueur
       bloqué a forcément ses trois pions sur une rangée ou une colonne
       entière — il a donc déjà gagné. Le cas est inatteignable en partie
       réelle ; on le garde comme filet (état forgé, reprise) et le test
       dédié le couvre. */
    if (legalMoves(next).length === 0) {
      next.over = true;
      next.winner = me;
      next.reason = REASON.BLOCKED;
      return next;
    }

    /* 4. Nulle par triple répétition */
    const k = key(next);
    const seen = (next.reps[k] || 0) + 1;
    next.reps[k] = seen;
    if (seen >= DRAW_REPEATS) {
      next.over = true;
      next.winner = null;
      next.reason = REASON.DRAW;
    }
    return next;
  }

  /* ---------- Lecture d'un état ---------- */
  function status(state) {
    return {
      over: !!state.over,
      winner: state.winner || null,
      reason: state.reason || null,
      line: state.line ? state.line.slice() : null,
    };
  }

  function clone(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      phase: state.phase,
      placedCount: { 1: state.placedCount[1], 2: state.placedCount[2] },
      plies: state.plies,
      over: state.over,
      winner: state.winner,
      reason: state.reason,
      line: state.line ? state.line.slice() : null,
      lastMove: state.lastMove ? Object.assign({}, state.lastMove) : null,
      reps: Object.assign({}, state.reps),
    };
  }

  return {
    SIZE: SIZE,
    CELLS: CELLS,
    PAWNS_PER_PLAYER: PAWNS_PER_PLAYER,
    DRAW_REPEATS: DRAW_REPEATS,
    CENTER: CENTER,
    PHASE: PHASE,
    REASON: REASON,
    ADJ: ADJ,
    WIN_LINES: WIN_LINES,
    other: other,
    newBoard: newBoard,
    countPawns: countPawns,
    winnerLine: winnerLine,
    key: key,
    createState: createState,
    legalMoves: legalMoves,
    isLegal: isLegal,
    applyMove: applyMove,
    status: status,
    clone: clone,
  };
});
