/* =========================================================
   D-aôna — Fanoron-telo : intelligence artificielle
   ---------------------------------------------------------
   Minimax NEGAMAX avec élagage alpha-bêta, approfondissement
   itératif et budget de temps. L'arbre du Fanoron-telo est
   minuscule (≤ 24 coups, 6 pions) : la profondeur 5 se calcule en
   quelques millisecondes, inutile de sortir l'artillerie.

   Deux principes tenus ici :
     - aucune dépendance au moteur au-delà de son API publique
       (`legalMoves`, `applyMove`) : si une règle change, l'IA suit
       sans retouche ;
     - le hasard est INJECTÉ (`opts.rng`) et ne sert qu'au départage
       des coups équivalents : les tests peuvent donc rejouer
       exactement la même partie.

   Chargement : <script src="engine.js"></script> puis
   <script src="ai.js"></script> (l'IA lit `window.FanoronTelo`),
   ou `require("./ai.js")` côté Node qui va chercher le moteur
   lui-même.
   ========================================================= */
(function (root, factory) {
  const isNode = typeof module === "object" && !!module.exports;
  const engine = isNode ? require("./engine.js") : root && root.FanoronTelo;
  const api = factory(engine);
  if (isNode) module.exports = api;
  if (root) root.FanoronTeloAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E) {
  "use strict";

  if (!E) throw new Error("FanoronTeloAI : engine.js doit être chargé avant ai.js");

  /* ---------- Barème ---------- */
  const SCORE_WIN = 1000; // au-delà de tout cumul heuristique
  const W_TWO = 14; // deux pions sur une ligne encore ouverte
  const W_ONE = 2; // un pion présent sur une ligne ouverte
  const W_CENTER = 3; // le centre touche les huit cases : il vaut cher

  /* Profondeur visée par niveau. 1 = débutant (voit le coup gagnant ou
     perdant immédiat), 2 = solide, 3 = impitoyable. */
  const LEVEL_DEPTH = { 1: 1, 2: 3, 3: 5 };
  const DEFAULT_LEVEL = 2;
  const DEFAULT_BUDGET_MS = 120;

  /* ---------- Évaluation statique ---------- */
  /* Vue du joueur `me` : positive s'il domine. Une ligne où les deux
     camps sont présents est morte et ne compte pas. */
  function evaluate(state, me) {
    const opp = E.other(me);
    const board = state.board;
    let score = 0;

    for (let i = 0; i < E.WIN_LINES.length; i++) {
      const line = E.WIN_LINES[i];
      let mine = 0;
      let theirs = 0;
      for (let j = 0; j < 3; j++) {
        const v = board[line[j]];
        if (v === me) mine++;
        else if (v === opp) theirs++;
      }
      if (mine && theirs) continue;
      if (mine === 2) score += W_TWO;
      else if (mine === 1) score += W_ONE;
      if (theirs === 2) score -= W_TWO + 1; // céder du terrain coûte un peu plus cher
      else if (theirs === 1) score -= W_ONE;
    }

    if (board[E.CENTER] === me) score += W_CENTER;
    else if (board[E.CENTER] === opp) score -= W_CENTER;

    return score;
  }

  function sameMove(a, b) {
    if (!a || !b) return false;
    if (a.to !== b.to) return false;
    return a.type === "move" ? a.from === b.from : true;
  }

  /* ---------- Ordonnancement des coups ---------- */
  /* L'élagage ne vaut que par l'ordre : on remonte d'abord le coup
     gagnant, puis le meilleur coup de l'itération précédente, puis le
     centre, et le reste mélangé pour éviter la monotonie. */
  function orderedMoves(state, rng, hint) {
    const moves = E.legalMoves(state);
    const tagged = [];

    for (let i = 0; i < moves.length; i++) {
      const mv = moves[i];
      let rank = 0;
      if (mv.to === E.CENTER || mv.from === E.CENTER) rank = 1;

      const res = E.applyMove(state, mv);
      if (res.ok && res.state.over && res.state.winner === state.turn) rank = 3;
      else if (hint && res.ok && sameMove(mv, hint)) rank = 2;

      tagged.push({ mv: mv, rank: rank, noise: rng(), index: i });
    }

    tagged.sort(function (a, b) {
      if (b.rank !== a.rank) return b.rank - a.rank;
      if (a.noise !== b.noise) return a.noise - b.noise;
      return a.index - b.index;
    });

    return tagged.map(function (t) { return t.mv; });
  }

  /* ---------- Recherche ---------- */
  /* Renvoie la valeur d'une position DU POINT DE VUE DE `me`, le même
     joueur pendant tout l'arbre. On n'emploie donc PAS la négation du
     negamax : le moteur ne fait pas alterner `turn` sur un état terminal
     (le gagnant garde le trait, voir engine.commit), ce qui casserait la
     symétrie du negamax et ferait passer un coup gagnant pour une perte.
     Minimax explicite, même élagage, zéro piège. */
  function terminalScore(state, me) {
    if (state.winner === null) return 0; // nulle
    return state.winner === me ? SCORE_WIN - state.plies : -SCORE_WIN + state.plies;
  }

  function search(state, depth, alpha, beta, me, ctx) {
    ctx.nodes++;
    if ((ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) ctx.aborted = true;
    if (ctx.aborted) return evaluate(state, me);

    if (state.over) return terminalScore(state, me);
    if (depth <= 0) return evaluate(state, me);

    const moves = orderedMoves(state, ctx.rng, null);
    /* Filet : le moteur clôt la partie dès qu'un camp n'a plus de coup,
       ce cas ne devrait donc jamais être atteint. */
    if (moves.length === 0) {
      return state.turn === me ? -SCORE_WIN + state.plies : SCORE_WIN - state.plies;
    }

    const maximizing = state.turn === me;
    let best = maximizing ? -Infinity : Infinity;

    for (let i = 0; i < moves.length; i++) {
      const res = E.applyMove(state, moves[i]);
      if (!res.ok) continue;
      const score = search(res.state, depth - 1, alpha, beta, me, ctx);

      if (maximizing) {
        if (score > best) best = score;
        if (best > alpha) alpha = best;
      } else {
        if (score < best) best = score;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break; // coupure
      if (ctx.aborted) break;
    }
    return best;
  }

  /* ---------- Choix du coup ---------- */
  /* opts :
       level         1 | 2 | 3   (profondeur 1 / 3 / 5)
       timeBudgetMs  garde-fou (défaut 120 ms) : l'UI ne gèle jamais
       rng           () => [0,1) injectable pour des parties rejouables
     Renvoie un coup jouable, ou null si la partie est finie. */
  function chooseMove(state, opts) {
    const o = opts || {};
    const level = LEVEL_DEPTH[o.level] ? o.level : DEFAULT_LEVEL;
    const maxDepth = LEVEL_DEPTH[level];
    const budget = typeof o.timeBudgetMs === "number" ? o.timeBudgetMs : DEFAULT_BUDGET_MS;
    const rng = typeof o.rng === "function" ? o.rng : Math.random;

    const moves = E.legalMoves(state);
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    const ctx = { nodes: 0, aborted: false, deadline: Date.now() + budget, rng: rng };
    const me = state.turn;
    let best = moves[0];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const rootMoves = orderedMoves(state, rng, best);
      const scored = [];
      let cutoff = false;

      for (let i = 0; i < rootMoves.length; i++) {
        const res = E.applyMove(state, rootMoves[i]);
        if (!res.ok) continue;
        /* Fenêtre pleine à la racine : on veut des scores EXACTS pour
           départager les ex æquo, pas seulement des bornes. */
        const score = search(res.state, depth - 1, -Infinity, Infinity, me, ctx);
        scored.push({ mv: rootMoves[i], score: score });
        if (ctx.aborted) { cutoff = true; break; }
      }

      if (cutoff || scored.length === 0) break;

      let top = scored[0];
      for (let i = 1; i < scored.length; i++) if (scored[i].score > top.score) top = scored[i];
      const ties = scored.filter(function (s) { return s.score === top.score; });
      best = ties[Math.floor(rng() * ties.length) % ties.length].mv;

      if (top.score >= SCORE_WIN - 64) break; // victoire forcée : inutile de creuser
    }

    return best;
  }

  return {
    chooseMove: chooseMove,
    evaluate: evaluate,
    orderedMoves: orderedMoves,
    LEVEL_DEPTH: LEVEL_DEPTH,
    SCORE_WIN: SCORE_WIN,
    DEFAULT_BUDGET_MS: DEFAULT_BUDGET_MS,
  };
});
