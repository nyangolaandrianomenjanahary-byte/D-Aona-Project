/* =========================================================
   D-Aona - Fanoron-dimy : IA LOCALE (minimax alpha-beta)
   ---------------------------------------------------------
   Aucune regle ici : tous les coups viennent de engine.legalMoves et
   tous les etats de engine.applyMove. L IA ne peut donc pas tricher.

   chooseMove(state, { level, budgetMs, rng }) :
     - level "facile" (1), "normal" (2), "difficile" (3) ;
     - budgetMs borne la reflexion (defaut 400 ms) : la recherche
       s arrete proprement et rend le meilleur coup deja vu ;
     - rng injectable pour des parties reproductibles dans les tests.

   Evaluation : materiel (100 / pion) + un bon de coup, du point de vue
   du joueur qui doit jouer a la racine.
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronDimy ? root.FanoronDimy
    : (typeof require === "function" ? require("./engine.js") : null);
  const api = factory(E);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronDimyAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E) {
  "use strict";

  const LEVELS = { facile: 1, normal: 2, difficile: 3 };
  const DEFAULT_BUDGET = 400;
  const WIN = 100000;

  function rngFrom(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* Difference de materiel, du point de vue de `me`. */
  function evaluate(state, me) {
    return (E.countPieces(state.board, me) - E.countPieces(state.board, E.other(me))) * 100;
  }

  function search(state, depth, me, alpha, beta, deadline) {
    const st = E.status(state);
    if (st.over) {
      if (st.reason === E.REASON.DRAW) return 0;
      return st.winner === me ? WIN + depth : -WIN - depth;
    }
    if (depth <= 0) return evaluate(state, me);
    if (Date.now() > deadline) return evaluate(state, me);

    const moves = E.legalMoves(state);
    if (!moves.length) return state.turn === me ? -WIN : WIN;

    const maxing = state.turn === me;
    let best = maxing ? -Infinity : Infinity;
    for (let i = 0; i < moves.length; i++) {
      const r = E.applyMove(state, moves[i]);
      if (!r.ok) continue;
      const v = search(r.state, depth - 1, me, alpha, beta, deadline);
      if (maxing) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break;
      if (Date.now() > deadline) break;
    }
    return best;
  }

  function chooseMove(state, opts) {
    const o = opts || {};
    if (!state || state.over) return null;
    const moves = E.legalMoves(state);
    if (!moves.length) return null;

    const me = state.turn;
    const depth = typeof o.level === "number" ? o.level : (LEVELS[o.level] || LEVELS.normal);
    const deadline = Date.now() + (o.budgetMs || DEFAULT_BUDGET);
    const rnd = typeof o.rng === "function" ? o.rng : rngFrom(state.board.join("").length * 2654435761);

    let best = moves[0], bestScore = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      const r = E.applyMove(state, moves[i]);
      if (!r.ok) continue;
      /* Le bruit (0 a 0.5) ne departage que les coups d egal score : il
         evite une IA mecanique sans jamais sacrifier une prise. */
      const v = search(r.state, depth - 1, me, -Infinity, Infinity, deadline) + rnd() * 0.5;
      if (v > bestScore) { bestScore = v; best = moves[i]; }
      if (Date.now() > deadline) break;
    }
    return best;
  }

  return { LEVELS, DEFAULT_BUDGET, chooseMove, evaluate, rngFrom };
});
