/* =========================================================
   D-aôna — ECRAN DE PARTIE DES VARIANTES (Telo, Dimy)
   ---------------------------------------------------------
   Ce fichier est de la GLUE d'application, pas des règles : il monte un
   écran plein cadre, branche le contrôleur du jeu (games/<slug>/ui.js) et
   laisse jouer l'IA du jeu (games/<slug>/ai.js). Les coups passent
   toujours par engine.applyMove : l'écran ne peut pas inventer un coup.

   Aucun couplage à l'objet App : l'écran vit dans son propre overlay,
   sous `document.body`, et se ferme tout seul (bouton, Échap).
   ========================================================= */
window.VariantMatch = (function () {
  "use strict";

  /* Chaque variante déclare son module global et ses règles AFFICHÉES.
     Les identifiants viennent du manifeste du dossier de jeu. */
  const GAMES = {
    "fanoron-telo": {
      name: "Fanoron-Telo",
      meta: "3 × 3 · sans prise",
      module: "FanoronTelo",
      boardModule: "FanoronTeloBoard",
      uiModule: "FanoronTeloUI",
      aiModule: "FanoronTeloAI",
      aiLevel: 2,
      rules: [
        "Chacun pose ses trois pions sur une case libre, à tour de rôle.",
        "Ensuite, on glisse un pion vers une intersection voisine laissée vide.",
        "Trois pions alignés — ligne, colonne ou diagonale — gagnent la partie.",
        "Aucun coup possible à son tour : défaite. Triple répétition : nulle.",
      ],
    },
    "fanoron-dimy": {
      name: "Fanoron-Dimy",
      meta: "5 × 5 · prises",
      module: "FanoronDimy",
      boardModule: "FanoronDimyBoard",
      uiModule: "FanoronDimyUI",
      aiModule: "FanoronDimyAI",
      aiLevel: 2,
      rules: [
        "Douze pions par camp, en deux rangées pleines ; le centre est libre.",
        "Déplacement le long des lignes : orthogonal partout, diagonal depuis un point fort.",
        "Prise par approche (pions derrière l'arrivée) ou par retrait (derrière le départ).",
        "La prise n'est jamais obligatoire ; un adversaire sans pion, ou bloqué, perd.",
      ],
    },
  };

  const SIDE = { 1: "Clairs", 2: "Sombres" };
  const REASON = { alignement: "alignement", blocage: "blocage", nulle: "nulle", capture: "toutes les prises" };

  let current = null;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const count = (board, side) => {
    let n = 0;
    for (let i = 0; i < board.length; i++) if (board[i] === side) n++;
    return n;
  };

  function shellHtml(def, opts) {
    const me = (opts.me && opts.me.pseudo) || "Vous";
    const adv = opts.mode === "local2p" ? "Joueur 2" : "IA — Antso";
    return `
      <div class="vm-shell" role="dialog" aria-modal="true" aria-label="${esc(def.name)}">
        <div class="vm-top">
          <button class="vm-back" id="vm-quit" aria-label="Quitter la partie">←</button>
          <div class="vm-title"><b>${esc(def.name)}</b><small>${esc(def.meta)}</small></div>
          <button class="vm-rules-btn" id="vm-rules" aria-expanded="false" aria-controls="vm-rules-panel">Règles</button>
        </div>
        <div class="vm-players">
          <div class="vm-player" data-side="1">
            <span class="vm-pawn clair"></span><b>${esc(me)}</b><small data-count="1">0</small>
          </div>
          <span class="vm-vs">VS</span>
          <div class="vm-player flip" data-side="2">
            <span class="vm-pawn sombre"></span><b>${esc(adv)}</b><small data-count="2">0</small>
          </div>
        </div>
        <div class="vm-board" id="vm-board"></div>
        <p class="vm-status" id="vm-status" role="status">…</p>
        <div class="vm-actions">
          <button class="btn ghost" id="vm-new">Nouvelle partie</button>
          <button class="btn" id="vm-close">Quitter</button>
        </div>
        <div class="vm-rules" id="vm-rules-panel" hidden>
          <ul>${def.rules.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul>
        </div>
      </div>`;
  }

  function statusText(m) {
    const st = m.state;
    if (st.over) {
      const w = st.winner || 0;
      if (!w) return "Partie nulle" + (st.reason ? " — " + (REASON[st.reason] || st.reason) : "");
      return "Victoire des " + SIDE[w] + " — " + (REASON[st.reason] || "fin de partie");
    }
    if (m.mode === "local2p") return "Aux " + SIDE[st.turn] + " de jouer";
    if (st.turn === 2) return "L'IA réfléchit…";
    return "À vous de jouer — vous êtes les " + SIDE[1];
  }

  function refresh() {
    const m = current;
    if (!m || !m.el) return;
    const host = m.el.querySelector("#vm-board");
    if (host) m.ctl.draw(host, { onCell: (i) => onCell(i) });

    [1, 2].forEach((side) => {
      const n = m.el.querySelector('[data-count="' + side + '"]');
      if (n) n.textContent = String(count(m.state.board, side));
      const card = m.el.querySelector('.vm-player[data-side="' + side + '"]');
      if (card) card.classList.toggle("is-turn", !m.state.over && m.state.turn === side);
    });

    const st = m.el.querySelector("#vm-status");
    if (st) {
      st.textContent = statusText(m);
      st.classList.toggle("over", !!m.state.over);
    }
  }

  function onCell(i) {
    const m = current;
    if (!m) return;
    m.ctl.click(i);
    refresh();
  }

  const isAiTurn = (m) => m.mode === "ai" && !m.state.over && m.state.turn === 2;

  function scheduleAi() {
    const m = current;
    if (!m || m.timer || !isAiTurn(m)) return;
    m.timer = setTimeout(() => {
      m.timer = null;
      if (current !== m) return;
      let move = null;
      try {
        move = m.AI.chooseMove(m.state, { level: m.def.aiLevel, budgetMs: 500, timeBudgetMs: 350 });
      } catch (e) { move = null; }
      if (move) {
        const r = m.E.applyMove(m.state, move);
        if (r && r.ok) { m.state = r.state; m.ctl.sync(m.state); }
      }
      refresh();
      scheduleAi();
    }, 380);
  }

  function newGame() {
    const m = current;
    if (!m) return;
    if (m.timer) { clearTimeout(m.timer); m.timer = null; }
    m.state = m.E.createState();
    m.ctl.sync(m.state);
    refresh();
  }

  function close() {
    const m = current;
    if (m && m.timer) clearTimeout(m.timer);
    current = null;
    const ov = document.getElementById("vm-overlay");
    if (ov) ov.remove();
    document.body.classList.remove("vm-open");
  }

  function open(opts) {
    const o = opts || {};
    const def = GAMES[o.game];
    if (!def) return false;
    const E = window[def.module], B = window[def.boardModule];
    const U = window[def.uiModule], AI = window[def.aiModule];
    if (!E || !B || !U) {
      console.error("Variante indisponible : " + o.game + " (module manquant)");
      return false;
    }

    close();
    const mode = o.mode === "local2p" ? "local2p" : "ai";
    const el = document.createElement("div");
    el.id = "vm-overlay";
    el.className = "vm-overlay";
    el.innerHTML = shellHtml(def, { mode: mode, me: o.me });
    document.body.appendChild(el);
    document.body.classList.add("vm-open");

    const state = E.createState();
    const ctl = U.createController({
      mySide: mode === "local2p" ? 0 : 1,
      state: state,
      onMove: () => {
        if (!current) return;
        current.state = current.ctl.getState();
        refresh();
        scheduleAi();
      },
    });
    current = { def: def, E: E, B: B, U: U, AI: AI, mode: mode, el: el, ctl: ctl, state: state, timer: null };

    el.querySelector("#vm-quit").onclick = close;
    el.querySelector("#vm-close").onclick = close;
    el.querySelector("#vm-new").onclick = newGame;
    const rulesBtn = el.querySelector("#vm-rules");
    const panel = el.querySelector("#vm-rules-panel");
    if (rulesBtn && panel) rulesBtn.onclick = () => {
      const shown = panel.hidden;
      panel.hidden = !shown;
      rulesBtn.setAttribute("aria-expanded", shown ? "true" : "false");
    };
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    refresh();
    return true;
  }

  /* Règles d'une variante, sous forme de HTML : l'assistant s'en sert dans
     sa modale quand le joueur demande « Règles » sur un plateau non-Tsivy. */
  function rulesHtml(id) {
    const def = GAMES[id];
    if (!def) return "";
    return '<h2>Règles · ' + esc(def.name) + '</h2>' +
      '<p class="m-sub">' + esc(def.meta) + '</p>' +
      '<div class="vm-rules"><ul>' + def.rules.map((r) => "<li>" + esc(r) + "</li>").join("") + '</ul></div>' +
      '<div class="m-foot"><button class="btn ghost" onclick="App.closeModal()">Fermer</button></div>';
  }

  return { open: open, close: close, rulesHtml: rulesHtml, isOpen: () => !!document.getElementById("vm-overlay") };
})();

