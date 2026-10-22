/* =========================================================
   D-Aona - Fanoron-dimy : INTERACTION
   ---------------------------------------------------------
   Selection d un pion puis d une arrivee. Aucune regle : chaque
   candidat passe par engine.isLegal / engine.applyMove, seuls juges.

   `mySide` accepte 1, 2 ou 0 :
     1 / 2  -> un seul camp est jouable (partie contre l IA) ;
     0      -> LES DEUX camps (deux joueurs sur un ecran), le camp
               autorise est celui du trait.
   Le controleur est testable sans navigateur (plateau injectable).
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronDimy ? root.FanoronDimy
    : (typeof require === "function" ? require("./engine.js") : null);
  const B = root && root.FanoronDimyBoard ? root.FanoronDimyBoard
    : (typeof require === "function" ? require("./board.js") : null);
  const api = factory(E, B);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronDimyUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (E, B) {
  "use strict";

  function createController(opts) {
    const o = opts || {};
    const engine = o.engine || E;
    const board = o.board || B;
    const side = o.mySide === 2 ? 2 : (o.mySide === 0 ? 0 : 1);
    const onMove = typeof o.onMove === "function" ? o.onMove : function () {};
    let state = o.state || engine.createState();
    let selected = null;

    const canPlay = () => !!state && !state.over && (side === 0 || state.turn === side);

    function commit(move) {
      if (!engine.isLegal(state, move)) return { moved: false, reason: "illegal", move };
      const res = engine.applyMove(state, move);
      if (!res || !res.ok) return { moved: false, reason: (res && res.error) || "refuse", move };
      state = res.state;
      selected = null;
      onMove(res.move, state);
      return { moved: true, move: res.move, state };
    }

    /* Un clic : selection, changement de pion, deselection ou deplacement. */
    function click(i) {
      if (!state) return { moved: false, reason: "sans-partie" };
      if (state.over) return { moved: false, reason: "over" };
      if (!canPlay()) return { moved: false, reason: "not-your-turn" };
      if (typeof i !== "number" || i < 0 || i >= engine.CELLS) return { moved: false, reason: "hors-plateau" };

      const trait = state.turn;
      if (selected === null) {
        if (state.board[i] !== trait) return { moved: false, reason: "pas-votre-pion" };
        selected = i;
        return { moved: false, reason: "selection", selected: i };
      }
      if (i === selected) { selected = null; return { moved: false, reason: "deselection" }; }
      if (state.board[i] === trait) { selected = i; return { moved: false, reason: "selection", selected: i }; }
      return commit({ from: selected, to: i });
    }

    /* Coup joue par un tiers (IA) : meme porte que le clic. */
    function play(move) { return commit(move); }

    function sync(next) { state = next; selected = null; }

    function draw(host, extra) {
      return board.render(host, state, Object.assign({ selected, disabled: !canPlay() }, extra || {}));
    }

    return { click, play, sync, draw, canPlay, getState: () => state, getSelected: () => selected };
  }

  return { createController };
});
