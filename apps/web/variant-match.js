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

  /* Initiales d'un nom, pour la pastille ronde (deux lettres au plus). */
  function initiales(nom) {
    const mots = String(nom || "?").replace(/[—–-]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return "?";
    if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
    return (mots[0][0] + mots[1][0]).toUpperCase();
  }

  /* Une carte de siège : avatar, nom, camp, Elo, pions restants, prises,
     pendule. CE SONT LES INFORMATIONS des barres de joueur du plateau Tsivy
     (nom + camp + Elo + prises + pendule), dans la langue de cette carte — pas
     une copie de leur style. */
  function siegeHtml(side, nom, elo) {
    return `
      <div class="vm-seat" data-side="${side}">
        <div class="vm-ava" aria-hidden="true">${esc(initiales(nom))}</div>
        <div class="vm-id">
          <div class="vm-nm">
            <b>${esc(nom)}</b>
            <span class="vm-pawn pion-view ${side === 2 ? "pion-view--dark sombre" : "clair"}" data-pion-side="${side}" aria-hidden="true"></span>
          </div>
          <div class="vm-sub">
            <span class="vm-camp">${esc(SIDE[side])}</span>
            <span data-elo="${side}">${elo ? esc(String(elo) + " Elo") : "—"}</span>
            <span class="vm-left" data-count="${side}">0</span>
          </div>
        </div>
        <span class="vm-cap" title="Pions adverses pris par ce camp">×<span data-caps="${side}">0</span></span>
        <span class="vm-clock" data-clock="${side}">00:00</span>
      </div>`;
  }

  function shellHtml(def, opts) {
    /* Les deux camps sont affichés par CAMP (1 = clairs, 2 = sombres), pas par
       « moi / adversaire » : en ligne on peut être le joueur 2, et le plateau
       doit garder ses couleurs. */
    const names = opts.names || {};
    const elos = opts.elos || {};
    const p1 = names[1] || "Vous";
    const p2 = names[2] || (opts.mode === "local2p" ? "Joueur 2" : "IA — Antso");
    /* EMBARQUÉ (`inline`) : l'hôte fournit le cadre (carte de l'assistant, son
       titre, son bouton Règles, sa sortie) — on ne garde que le jeu et son
       panneau. En plein écran, la coquille garde sa barre et sa sortie. */
    const inline = !!opts.inline;
    const hid = inline ? " hidden" : "";
    return `
      <div class="vm-shell${inline ? " vm-shell--inline" : ""}"${inline ? ' role="group"' : ' role="dialog" aria-modal="true"'} aria-label="${esc(def.name)}">

        <div class="vm-top"${hid}>
          <button class="vm-back" id="vm-quit" aria-label="Quitter la partie">←</button>
          <div class="vm-title"><b>${esc(def.name)}</b><small>${esc(def.meta)}</small></div>
        </div>

        <div class="vm-turn" id="vm-turn"><span aria-hidden="true">⚡</span><span id="vm-turn-txt">…</span></div>

        <div class="vm-seats">
          ${siegeHtml(1, p1, elos[1])}
          ${siegeHtml(2, p2, elos[2])}
        </div>

        <div class="vm-stage">
          <div class="vm-board" id="vm-board"></div>
          <aside class="vm-side">
            <section class="vm-panel">
              <h3><span>Rapport de force</span><span class="vm-force-unit" id="vm-force-note"></span></h3>
              <div class="vm-force"><div class="fill" id="vm-force-fill" style="width:50%"></div></div>
              <div class="vm-force-legend">
                <span id="vm-force-l">${esc(p1)}</span>
                <span id="vm-force-r">${esc(p2)}</span>
              </div>
            </section>
            <section class="vm-panel">
              <h3>Actions</h3>
              <div class="vm-acts">
                <button class="btn ghost" type="button" id="vm-rules">Règles</button>
                <button class="btn ghost" type="button" id="vm-draw">Proposer nul</button>
                <button class="btn ghost" type="button" id="vm-help" aria-pressed="true">
                  <span>Aides au déplacement</span><span class="vm-help-state" id="vm-help-state">ON</span>
                </button>
                <button class="btn ghost" type="button" id="vm-resign">Abandonner</button>
                <button class="btn ghost" type="button" id="vm-new"${inline ? " hidden" : ""}>Nouvelle partie</button>
              </div>
            </section>
            <section class="vm-panel" id="vm-rules-panel">
              <h3>${esc(def.name)} · repères</h3>
              <ul class="vm-notes">${def.rules.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul>
            </section>
          </aside>
        </div>

        <p class="vm-status" id="vm-status" role="status" aria-live="polite">…</p>
        <div class="vm-actions"${hid}>
          <button class="btn ghost" id="vm-close">Quitter</button>
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

  /* ---------- PENDULE, PRISES, RAPPORT DE FORCE, AIDES ----------
     Toutes ces valeurs sont LISIBLES dans l'état du jeu : aucune n'est inventée
     pour imiter le plateau Tsivy. Le temps est le temps réellement passé par
     chaque camp au trait (une variante locale n'a pas d'horloge de partie). */
  const fmtClock = (s) => {
    const t = Math.max(0, s | 0);
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  };

  /* Le Telo ne prend pas de pion : son « rapport de force » est la MOBILITÉ
     (nombre de coups légaux de chaque camp), seule mesure qui bouge vraiment. */
  function captures(m, side) {
    if (m.E.PHASE) return 0;                       // Telo : aucune prise
    const total = m.E.PAWNS_PER_PLAYER || 0;
    return Math.max(0, total - count(m.state.board, side));
  }

  function mobilite(m, side) {
    try {
      const st = m.E.clone ? m.E.clone(m.state) : m.state;
      st.turn = side;
      const mv = m.E.legalMoves(st);
      return Array.isArray(mv) ? mv.length : 0;
    } catch (e) { return 0; }
  }

  function forceInfo(m) {
    const names = m.names || {};
    if (!m.E.PHASE) {
      const n1 = count(m.state.board, 1), n2 = count(m.state.board, 2);
      const tot = n1 + n2;
      return {
        ratio: tot ? n1 / tot : 0.5,
        left: (names[1] || "Clairs") + " · " + n1,
        right: (names[2] || "Sombres") + " · " + n2,
        note: "pions sur le plateau",
      };
    }
    const m1 = mobilite(m, 1), m2 = mobilite(m, 2);
    const tot = m1 + m2;
    return {
      ratio: tot ? m1 / tot : 0.5,
      left: (names[1] || "Clairs") + " · " + m1,
      right: (names[2] || "Sombres") + " · " + m2,
      note: "coups possibles",
    };
  }

  /* Aides au déplacement : les arrivées LÉGALES, calculées par le moteur.
     Rien au tour de l'IA, rien quand la partie est finie, rien si l'aide est
     coupée — et aucune pastille sous un pion qu'on n'a pas encore choisi. */
  function hintsFor(m) {
    const st = m.state;
    if (!m.help || !st || st.over) return null;
    if (m.mode !== "local2p" && !m.remote && st.turn !== m.mySide) return null;
    const sel = m.ctl.getSelected ? m.ctl.getSelected() : null;
    let mv = [];
    try { mv = m.E.legalMoves(st) || []; } catch (e) { mv = []; }
    const pose = !!(st.phase && m.E.PHASE && st.phase === m.E.PHASE.PLACEMENT);
    if (pose) return mv.map((x) => (x && typeof x.to === "number" ? x.to : null)).filter((v) => v !== null);
    if (sel === null) return null;
    return mv.filter((x) => x && x.from === sel).map((x) => x.to);
  }

  function turnText(m) {
    const st = m.state;
    const names = m.names || {};
    if (st.over) {
      if (!st.winner) return { html: "Partie nulle" + (st.reason ? " — " + (REASON[st.reason] || st.reason) : ""), cls: "is-over" };
      return { html: "Victoire des " + SIDE[st.winner] + " — " + (REASON[st.reason] || "fin de partie"), cls: "is-over" };
    }
    if (m.mode === "local2p") return { html: "Aux " + SIDE[st.turn] + " de jouer — <b>" + esc(names[st.turn] || SIDE[st.turn]) + "</b>", cls: "" };
    if (m.remote) {
      return st.turn === m.mySide
        ? { html: "À VOUS de jouer — <b>" + esc(names[m.mySide] || "vous") + "</b>", cls: "" }
        : { html: "<b>" + esc(names[3 - m.mySide] || "L'adversaire") + "</b> joue…", cls: "is-opp" };
    }
    if (st.turn === 2) return { html: "<b>" + esc(names[2] || "L'IA") + "</b> réfléchit…", cls: "is-opp" };
    return { html: "À VOUS de jouer — <b>" + esc(names[1] || "vous") + "</b>", cls: "" };
  }

  function refresh() {
    const m = current;
    if (!m || !m.el) return;
    const host = m.el.querySelector("#vm-board");
    if (host) m.ctl.draw(host, { onCell: (i) => onCell(i), owner: ownerOf(m), hints: hintsFor(m) });

    [1, 2].forEach((side) => {
      const carte = m.el.querySelector('.vm-seat[data-side="' + side + '"]');
      const trait = !m.state.over && m.state.turn === side;
      if (carte) {
        carte.classList.toggle("is-turn", trait);
        carte.classList.toggle("is-idle", !m.state.over && !trait);
      }
      const reste = m.el.querySelector('[data-count="' + side + '"]');
      if (reste) reste.textContent = String(count(m.state.board, side));
      const prises = m.el.querySelector('[data-caps="' + side + '"]');
      if (prises) prises.textContent = String(captures(m, side));
      const pendule = m.el.querySelector('[data-clock="' + side + '"]');
      if (pendule) pendule.textContent = fmtClock(m.clocks[side]);
    });

    const tour = m.el.querySelector("#vm-turn");
    const tourTxt = m.el.querySelector("#vm-turn-txt");
    const t = turnText(m);
    if (tourTxt) tourTxt.innerHTML = t.html;
    if (tour) tour.className = "vm-turn " + t.cls;

    const f = forceInfo(m);
    const barre = m.el.querySelector("#vm-force-fill");
    if (barre) barre.style.width = Math.round(f.ratio * 100) + "%";
    const bg = m.el.querySelector("#vm-force-l"), bd = m.el.querySelector("#vm-force-r");
    if (bg) bg.textContent = f.left;
    if (bd) bd.textContent = f.right;
    const note = m.el.querySelector("#vm-force-note");
    if (note) note.textContent = f.note;

    const st = m.el.querySelector("#vm-status");
    if (st) {
      st.textContent = statusText(m);
      st.classList.toggle("over", !!m.state.over);
    }
    const helpState = m.el.querySelector("#vm-help-state");
    const helpBtn = m.el.querySelector("#vm-help");
    if (helpState) helpState.textContent = m.help ? "ON" : "OFF";
    if (helpBtn) helpBtn.setAttribute("aria-pressed", m.help ? "true" : "false");

    /* L'état courant est PUBLIÉ à l'appelant : c'est lui qui permet de
       remonter le plateau à l'identique après un changement d'écran (reprise
       d'une partie locale de Dimy/Telo). Un seul point de sortie d'état. */
    if (typeof m.onState === "function") m.onState(m.state);
    /* L'habillage du pion suit l'état : en ligne, `sync()` peut apporter les
       apparences des deux comptes après le premier rendu. Les attributs sont
       posés sur l'hôte, donc rien n'est perdu au repeint suivant. */
    paintPions(m);
  }

  /* La pendule avance pour le camp qui a le trait, et pour lui seul. Un
     intervalle par partie (jamais deux) : `close()` l'éteint. */
  function tickClock(m) {
    if (!m || m.state.over) return;
    const side = m.state.turn === 2 ? 2 : 1;
    m.clocks[side] += 1;
    const el = m.el && m.el.querySelector('[data-clock="' + side + '"]');
    if (el) el.textContent = fmtClock(m.clocks[side]);
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
    m.clocks = { 1: 0, 2: 0 };
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
    if (m && m.clockTimer) clearInterval(m.clockTimer);
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
    /* Elo affiché : celui du compte pour mon camp, celui de l'adversaire quand
       on le connaît (partie en ligne). L'IA n'a pas de classement : on garde le
       même écart que le plateau Tsivy (voir `Fanorona.start`), jamais un chiffre
       inventé pour faire joli. */
    const eloMoi = (o.me && Number(o.me.elo)) || null;
    const eloOpp = (o.opponent && Number(o.opponent.elo)) || null;
    const elos = mode === "local2p"
      ? { 1: eloMoi, 2: null }
      : { 1: eloMoi, 2: eloOpp };
    const el = document.createElement("div");
    el.className = host ? "vm-embed" : "vm-overlay";
    if (!host) el.id = "vm-overlay";
    el.innerHTML = shellHtml(def, { mode: mode, names: names, elos: elos, inline: !!host });
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
    const sess = { def: def, E: E, B: B, U: U, AI: AI, mode: mode, remote: remote,
                mySide: side, el: el, ctl: ctl, state: state, timer: null,
                /* Noms affichés : le bandeau et les sièges les lisent. */
                names: names,
                /* Pendule par camp (secondes réellement passées au trait) et
                   aides au déplacement — même mémoire que le plateau Tsivy. */
                clocks: { 1: 0, 2: 0 }, clockTimer: null,
                help: (function () { try { return localStorage.getItem("daona_help") !== "0"; } catch (e) { return true; } })(),
                /* Apparence du compte local (hors ligne), et seulement elle :
                   celle de l'adversaire ne vient QUE de l'état du serveur. */
                pionFallback: o.pionStyles || null,
                /* `onState` : l'appelant veut suivre l'état (reprise après un
                   changement d'écran). Facultatif — l'overlay historique s'en
                   passe. */
                onState: typeof o.onState === "function" ? o.onState : null };
    current = sess;

    /* En version embarquée, la barre de titre et les actions sont ABSENTES :
       on ne câble que ce qui existe (l'écran doit se monter dans les 2 formes). */
    const bind = (id, fn) => { const b = el.querySelector("#" + id); if (b) b.onclick = fn; };
    bind("vm-quit", close);
    bind("vm-close", close);
    bind("vm-new", newGame);
    /* RÈGLES : en embarqué, la carte de l'assistant porte déjà son bouton ; ici
       on ouvre la même modale par l'appelant (`onRules`), à défaut on déplie les
       repères de la variante déjà présents dans le panneau. */
    bind("vm-rules", () => {
      const panel = el.querySelector("#vm-rules-panel");
      if (typeof o.onRules === "function") return o.onRules();
      if (panel) panel.hidden = !panel.hidden;
    });
    /* AIDES AU DÉPLACEMENT : même mémoire que le plateau Tsivy (`daona_help`),
       pour que le réglage vaille partout où l'on joue. */
    bind("vm-help", () => {
      if (!current) return;
      current.help = !current.help;
      try { localStorage.setItem("daona_help", current.help ? "1" : "0"); } catch (e) {}
      refresh();
    });
    /* « PROPOSER NUL » : une variante locale se joue sur un seul appareil (il
       n'y a personne à qui proposer) et le serveur n'arbitre pas de nulle
       négociée. Le bouton garde sa place dans les actions — l'information est
       là — mais il dit pourquoi il ne fait rien. */
    const nulBtn = el.querySelector("#vm-draw");
    if (nulBtn) {
      nulBtn.disabled = true;
      nulBtn.title = def.meta.indexOf("prise") >= 0
        ? "La nulle se joue sur triple répétition ; elle ne se propose pas hors ligne."
        : "La nulle se joue sur triple répétition ; elle ne se propose pas hors ligne.";
    }
    /* ABANDONNER : c'est l'appelant qui sait ce qu'abandonner veut dire (sortir
       d'une partie locale, ou envoyer `resign` au serveur). À défaut, on ferme. */
    bind("vm-resign", () => {
      if (typeof o.onResign === "function") return o.onResign();
      close();
    });
    /* Échap ferme l'overlay ; EMBARQUÉ, c'est l'assistant qui commande la
       sortie (flèche du bandeau bas) — un Échap ne doit pas laisser un cadre vide. */
    if (!host) el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    /* La pendule d'un camp ne tourne que pendant son trait. Un seul intervalle
       par partie, éteint par `close()`. */
    sess.clockTimer = setInterval(() => {
      if (current !== sess) return;
      tickClock(sess);
    }, 1000);

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

