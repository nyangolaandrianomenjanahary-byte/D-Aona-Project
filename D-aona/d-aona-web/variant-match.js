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
    /* Les deux camps sont affichés par CAMP (1 = clairs à gauche, 2 = sombres à
       droite), pas par « moi / adversaire » : en ligne on peut être le joueur 2,
       et le plateau doit garder ses couleurs. */
    const names = opts.names || {};
    const p1 = names[1] || "Vous";
    const p2 = names[2] || (opts.mode === "local2p" ? "Joueur 2" : "IA — Antso");
    /* EMBARQUÉ (`inline`) : l'hôte fournit déjà cadre, titre, bouton de règles
       et sortie — la carte de l'assistant. On ne garde que le jeu : joueurs,
       plateau, statut. En plein écran, la coquille garde sa barre et ses
       actions (comportement historique de l'overlay). */
    const inline = !!opts.inline;
    const hid = inline ? " hidden" : "";
    return `
      <div class="vm-shell${inline ? " vm-shell--inline" : ""}"${inline ? ' role="group"' : ' role="dialog" aria-modal="true"'} aria-label="${esc(def.name)}">
        <div class="vm-top"${hid}>
          <button class="vm-back" id="vm-quit" aria-label="Quitter la partie">←</button>
          <div class="vm-title"><b>${esc(def.name)}</b><small>${esc(def.meta)}</small></div>
          <button class="vm-rules-btn" id="vm-rules" aria-expanded="false" aria-controls="vm-rules-panel">Règles</button>
        </div>
        <div class="vm-players">
          <div class="vm-player" data-side="1">
            <span class="vm-pawn pion-view clair" data-pion-side="1"></span><b>${esc(p1)}</b><small data-count="1">0</small>
          </div>
          <span class="vm-vs">VS</span>
          <div class="vm-player flip" data-side="2">
            <span class="vm-pawn pion-view pion-view--dark sombre" data-pion-side="2"></span><b>${esc(p2)}</b><small data-count="2">0</small>
          </div>
        </div>
        <div class="vm-board" id="vm-board"></div>
        <p class="vm-status" id="vm-status" role="status">…</p>
        <div class="vm-actions"${hid}>
          <button class="btn ghost" id="vm-new">Nouvelle partie</button>
          <button class="btn" id="vm-close">Quitter</button>
        </div>
        <div class="vm-rules" id="vm-rules-panel"${hid}>
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
    /* En ligne, le camp du joueur vient du serveur : le libellé ne peut donc
       pas supposer qu'on est le joueur 1. */
    if (m.remote) {
      return st.turn === m.mySide
        ? "À vous de jouer — vous êtes les " + SIDE[m.mySide]
        : "L'adversaire joue…";
    }
    if (st.turn === 2) return "L'IA réfléchit…";
    return "À vous de jouer — vous êtes les " + SIDE[1];
  }

  /* À QUI appartient un pion : son CAMP (1 = clairs, 2 = sombres) ne dit pas
     qui le tient. En « deux joueurs » sur un même écran, les deux camps sont
     au compte local ; partout ailleurs l'autre camp est l'adversaire — et
     c'est ce couple qui choisit le jeu d'apparence (`--pion-*` / `-opp`). */
  const ownerOf = (m) => (v) => (m.mode === "local2p" || v === m.mySide ? "me" : "opp");

  /* Apparences des pions d'une variante : les MÊMES quatre jeux que le plateau
     Tsivy (moi | adversaire × clair | sombre). En ligne, l'état du serveur est
     la seule source de l'adversaire — exactement la règle du Tsivy ; hors
     ligne, l'apparence du compte est fournie par l'appelant et l'inconnu
     d'en face reste au pion Vato. */
  function paintPions(m) {
    const FB = window.FanoronaBoard;
    if (!FB || !m || !m.el) return;
    const st = m.state || {};
    const twoSides = m.mode !== "local2p";
    const p1 = st.player1 || null, p2 = st.player2 || null;
    const mine = m.mySide === 2 ? p2 : p1;
    const other = m.mySide === 2 ? p1 : p2;
    const me = (mine && mine.pionStyles) || m.pionFallback || null;
    const opp = twoSides ? ((other && other.pionStyles) || null) : null;
    /* Les attributs sont posés sur l'HÔTE du plateau : ils survivent aux
       repeints (le plateau est redessiné à chaque coup) et les variables
       `--pion-*` héritent jusqu'aux pions. */
    FB.paintPionStyles(m.el.querySelector("#vm-board"), { me: me, opp: opp });
    /* Les pastilles de camp portent l'apparence de LEUR propriétaire. */
    [1, 2].forEach((side) => {
      const chip = m.el.querySelector('.vm-pawn[data-pion-side="' + side + '"]');
      const style = (twoSides && side !== m.mySide && opp) ? opp : me;
      if (!chip || !style) return;
      FB.setStyleAttrs(chip, side === 1 ? style.light : style.dark, side === 1 ? "" : "-dark");
    });
  }

  function refresh() {
    const m = current;
    if (!m || !m.el) return;
    const host = m.el.querySelector("#vm-board");
    if (host) m.ctl.draw(host, { onCell: (i) => onCell(i), owner: ownerOf(m) });

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
    /* L'état courant est PUBLIÉ à l'appelant : c'est lui qui permet de
       remonter le plateau à l'identique après un changement d'écran (reprise
       d'une partie locale de Dimy/Telo). Un seul point de sortie d'état. */
    if (typeof m.onState === "function") m.onState(m.state);
    /* L'habillage du pion suit l'état : en ligne, `sync()` peut apporter les
       apparences des deux comptes après le premier rendu. Les attributs sont
       posés sur l'hôte, donc rien n'est perdu au repeint suivant. */
    paintPions(m);
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
    /* En ligne, la partie appartient aux DEUX joueurs : « Nouvelle partie » ne
       peut pas la remettre a zero depuis un seul ecran. */
    if (!m || m.remote) return;
    if (m.timer) { clearTimeout(m.timer); m.timer = null; }
    m.state = m.E.createState();
    m.ctl.sync(m.state);
    refresh();
  }

  /* Etat AUTORITAIRE recu du serveur : il remplace celui de l'ecran, sans
     negociation. C'est le seul chemin par lequel une partie en ligne avance. */
  function sync(state) {
    const m = current;
    if (!m || !state) return;
    m.state = state;
    m.ctl.sync(state);
    refresh();
  }

  function close() {
    const m = current;
    if (m && m.timer) clearTimeout(m.timer);
    current = null;
    /* On retire l'élément RÉELLEMENT monté, où qu'il soit (overlay ou hôte) :
       le chercher par identifiant laisserait l'écran embarqué en place. */
    if (m && m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
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
    /* `remote` : la partie est TENUE PAR LE SERVEUR (classee, defi). L'ecran ne
       cree aucun etat, il peint celui qu'on lui donne et renvoie chaque coup par
       `onMove`. Sans `remote`, comportement historique : IA locale.
       `host` : l'appelant fournit un emplacement (etape 4 de l'assistant) et
       l'ecran de partie s'y EMBARQUE — meme carte, pas d'overlay. Sans host,
       plein ecran sous <body>. */
    const remote = !!o.remote;
    const mode = remote ? (o.mode === "defi" ? "defi" : "online")
      : (o.mode === "local2p" ? "local2p" : "ai");
    const side = remote ? (o.mySide === 2 ? 2 : 1) : (mode === "local2p" ? 0 : 1);
    const host = o.host || null;
    /* L'état vient de l'appelant quand il en a un (partie serveur, ou partie
       locale REPRISE après un changement d'écran) ; sinon le jeu en crée un. */
    const state = o.state || E.createState();
    const names = remote
      ? { 1: (state.player1 && state.player1.pseudo) || "", 2: (state.player2 && state.player2.pseudo) || "" }
      : { 1: (o.me && o.me.pseudo) || "Vous", 2: mode === "local2p" ? "Joueur 2" : "IA — Antso" };
    const el = document.createElement("div");
    el.className = host ? "vm-embed" : "vm-overlay";
    if (!host) el.id = "vm-overlay";
    el.innerHTML = shellHtml(def, { mode: mode, names: names, inline: !!host });
    if (host) host.appendChild(el); else document.body.appendChild(el);
    if (!host) document.body.classList.add("vm-open");

    const ctl = U.createController({
      mySide: side,
      state: state,
      onMove: (move, next) => {
        if (!current) return;
        if (remote) {
          /* Coup optimiste : le controleur vient de le valider avec le MÊME
             moteur que le serveur. Ce qui compte est l'etat qu'il renverra —
             on ne fait que peindre en avance, jamais decider. */
          current.state = next || current.ctl.getState();
          refresh();
          if (typeof o.onMove === "function") o.onMove(move);
          return;
        }
        current.state = current.ctl.getState();
        refresh();
        scheduleAi();
      },
    });
    current = { def: def, E: E, B: B, U: U, AI: AI, mode: mode, remote: remote,
                mySide: side, el: el, ctl: ctl, state: state, timer: null,
                /* Apparence du compte local (hors ligne), et seulement elle :
                   celle de l'adversaire ne vient QUE de l'état du serveur. */
                pionFallback: o.pionStyles || null,
                /* `onState` : l'appelant veut suivre l'état (reprise après un
                   changement d'écran). Facultatif — l'overlay historique s'en
                   passe. */
                onState: typeof o.onState === "function" ? o.onState : null };

    /* En version embarquée, la barre de titre et les actions sont ABSENTES :
       on ne câble que ce qui existe (l'écran doit se monter dans les 2 formes). */
    const bind = (id, fn) => { const b = el.querySelector("#" + id); if (b) b.onclick = fn; };
    bind("vm-quit", close);
    bind("vm-close", close);
    bind("vm-new", newGame);
    const rulesBtn = el.querySelector("#vm-rules");
    const panel = el.querySelector("#vm-rules-panel");
    if (rulesBtn && panel) rulesBtn.onclick = () => {
      const shown = panel.hidden;
      panel.hidden = !shown;
      rulesBtn.setAttribute("aria-expanded", shown ? "true" : "false");
    };
    /* Échap ferme l'overlay ; EMBARQUÉ, c'est l'assistant qui commande la
       sortie (flèche du bandeau bas) — un Échap ne doit pas laisser un cadre vide. */
    if (!host) el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    refresh();
    /* REPRISE d'une partie LOCALE : `open` remonte l'état tel quel. Si c'était
       au tour de l'IA quand l'écran a été refermé, personne ne réarmerait son
       minuteur — il ne part que d'un coup joué (`onMove`) ou de lui-même. Le
       plateau restait alors bloqué sur « L'IA réfléchit… », définitivement.
       Une ligne, valable pour toutes les variantes présentes et futures :
       `scheduleAi` ne fait rien hors tour d'IA ou partie terminée. */
    scheduleAi();
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

  /* État courant de l'écran (null si aucune partie n'est montée). Lecture
     seule : la reprise et les sondes s'en servent pour vérifier que le plateau
     remonté est bien celui qu'on avait laissé. */
  function snapshot() { return current ? current.state : null; }

  return { open: open, close: close, sync: sync, rulesHtml: rulesHtml, state: snapshot, isOpen: () => !!current };
})();

