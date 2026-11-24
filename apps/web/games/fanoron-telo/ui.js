/* =========================================================
   D-Aona - Fanoron-telo : INTERACTION
   ---------------------------------------------------------
   Selection, pose, glisse et appel de onMove. Aucune regle : chaque candidat
   passe par engine.isLegal / engine.applyMove, qui restent seuls juges.
   Le controleur est testable sans navigateur (board injectable).
   ========================================================= */
(function (root, factory) {
  const E = root && root.FanoronTelo ? root.FanoronTelo
    : (typeof require === "function" ? require("./engine.js") : null);
  const B = root && root.FanoronTeloBoard ? root.FanoronTeloBoard
    : (typeof require === "function" ? require("./board.js") : null);
  const api = factory(E, B);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FanoronTeloUI = api;
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

    /* `side === 0` : les DEUX camps sont jouables (deux joueurs sur un meme
       ecran). Le camp autorise est alors celui du trait — c'est la seule
       difference, et elle evite un second controleur dans l interface. */
    function canPlay() { return !!state && !state.over && (side === 0 || state.turn === side); }

    function commit(move) {
      if (!engine.isLegal(state, move)) return { moved: false, reason: "illegal", move };
      const res = engine.applyMove(state, move);
      if (!res || !res.ok) return { moved: false, reason: (res && res.error) || "refuse", move };
      state = res.state;
      selected = null;
      onMove(move, state);
      return { moved: true, move, state };
    }

    /* Un clic : pose (phase de pose), selection, deselection ou glisse. */
    function click(i) {
      if (!canPlay()) return { moved: false, reason: state && state.over ? "over" : "not-your-turn" };
      if (typeof i !== "number" || i < 0 || i >= engine.CELLS) return { moved: false, reason: "hors-plateau" };
      if (state.phase === engine.PHASE.PLACEMENT) return commit({ type: "place", to: i });
      if (selected === null) {
        if (state.board[i] !== state.turn) return { moved: false, reason: "pas-votre-pion" };
        selected = i;
        return { moved: false, reason: "selection", selected: i };
      }
      if (i === selected) { selected = null; return { moved: false, reason: "deselection" }; }
      if (state.board[i] === state.turn) { selected = i; return { moved: false, reason: "selection", selected: i }; }
      return commit({ type: "move", from: selected, to: i });
    }

    function sync(next) { state = next; selected = null; }

    function draw(host, extra) {
      return board.render(host, state, Object.assign({ selected, disabled: !canPlay() }, extra || {}));
    }

    return { click, sync, draw, canPlay, getState: () => state, getSelected: () => selected };
  }

  return { createController };
});