/* =========================================================
   D-aôna — Plateau Fanorona (9 x 5) — mode autoritaire serveur
   + mode IA local pour l'entraînement.
   ========================================================= */
"use strict";

const Fanorona = (() => {
  const ROWS = 5, COLS = 9;
  /* Coordonnées alignées sur l'image plateau_exact.svg (1647×955), mesurées par
     détection des lignes gravées : colonnes x = 197 → 1447 px (pas 156,25),
     lignes y = 144 → 768 px (pas 156). Cases quasi carrées sur l'image. */
  const PX = (c) => (197 + c * 156.25) / 1647 * 100;   // % du cadre
  const PY = (r) => (144 + r * 156) / 955 * 100;       // % du cadre

  const DIRS = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr || dc) DIRS.push([dr, dc]);

  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const even = (r, c) => (r + c) % 2 === 0;

  let G = null;
  let eligibilityCache = [];
  let onMoveCb = null;

  /* ---------- Rôle du joueur local (1 ou 2) & aide au mouvement ---------- */
  const meVal = () => (G ? G.playerNum : 1);
  const oppVal = () => (G ? (G.playerNum === 1 ? 2 : 1) : 2);
  /* POV : retourne la ligne d'affichage selon le joueur local — le joueur 2
     voit son camp en bas (retournement vertical du plateau). */
  const dy = (r) => (G && G.playerNum === 2 ? ROWS - 1 - r : r);
  /* L'aide au déplacement ne s'active QUE en entraînement IA (POV compétitif). */
  const helpOn = () => !!(G && G.mode === "ai" && helpEnabled);
  let helpEnabled = true;
  try { helpEnabled = localStorage.getItem("daona_help") !== "0"; } catch (e) {}
  function setHelp(v) {
    helpEnabled = !!v;
    try { localStorage.setItem("daona_help", v ? "1" : "0"); } catch (e) {}
    updateAll();
  }
  function isHelp() { return helpEnabled; }

  /* ---------- Génération des coups (IA locale & validation) ---------- */
  function movesFrom(grid, r, c, me, chain) {
    const enemy = me === 1 ? 2 : 1;
    const out = [];
    for (const [dr, dc] of DIRS) {
      // Diagonale : permise UNIQUEMENT depuis un point fort ((r+c) pair) — sur le
      // plateau gravé, les croisements obliques (motifs étoile/losange) n'existent
      // qu'à ces intersections. Depuis un point faible, seules les 4 directions
      // orthogonales sont des arêtes. Un pas diagonal conserve la parité de (r+c),
      // donc l'arrivée est aussi un point fort.
      if (dr !== 0 && dc !== 0 && !even(r, c)) continue;
      if (chain && chain.lastDir && chain.lastDir[0] === dr && chain.lastDir[1] === dc) continue;
      const nr = r + dr, nc = c + dc;
      if (!inBoard(nr, nc) || grid[nr][nc] !== 0) continue;
      if (chain && chain.visited && chain.visited.has(nr + "," + nc)) continue;
      const apr = [];
      let ar = nr + dr, ac = nc + dc;
      while (inBoard(ar, ac) && grid[ar][ac] === enemy) { apr.push([ar, ac]); ar += dr; ac += dc; }
      const ret = [];
      let wr = r - dr, wc = c - dc;
      while (inBoard(wr, wc) && grid[wr][wc] === enemy) { ret.push([wr, wc]); wr -= dr; wc -= dc; }
      if (apr.length) out.push({ from: [r, c], to: [nr, nc], dir: [dr, dc], kind: "apr",  cap: apr });
      if (ret.length) out.push({ from: [r, c], to: [nr, nc], dir: [dr, dc], kind: "ret",  cap: ret });
      if (!apr.length && !ret.length) out.push({ from: [r, c], to: [nr, nc], dir: [dr, dc], kind: "paika", cap: [] });
    }
    return out;
  }

  function legalMoves(grid, me, chain) {
    let all = [];
    if (chain) {
      all = movesFrom(grid, chain.pos[0], chain.pos[1], me, chain).filter((m) => m.cap.length);
      return all;
    }
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c] === me) all = all.concat(movesFrom(grid, r, c, me, null));
    const caps = all.filter((m) => m.cap.length);
    return caps.length ? caps : all;
  }

  const countPieces = (grid, who) => grid.flat().filter((v) => v === who).length;

  /* ---------- Construction du plateau DOM ---------- */
  function buildBoard() {
    const host = document.getElementById("fanorona-board");
    if (!host) return;
    host.innerHTML = "";
    /* Le treillis (lignes, diagonales, intersections) est gravé dans l'image
       plateau_exact.svg — plus besoin de le dessiner en SVG superposé. */
    host.insertAdjacentHTML("beforeend",
      `<div class="pov">
         <img class="board-img" src="assets/board/plateau_clean.png" alt="Plateau de Fanorona" draggable="false">
         <div class="lastmove" id="lastmove" hidden></div>
         <div class="dots" id="dots"></div>
         <div class="pieces" id="pieces"></div>
         <div class="cells" id="cells"></div>
       </div>
       <div class="capture-choice" id="capture-choice" hidden></div>`);
    host.classList.toggle("pov-flip", !!(G && G.playerNum === 2));

    const cells = document.getElementById("cells");
    if (cells) {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const z = document.createElement("div");
          z.className = "cell";
          z.style.left = PX(c) + "%";
          z.style.top = PY(r) + "%";
          z.dataset.r = r; z.dataset.c = c;
          z.addEventListener("click", () => onCell(r, c));
          cells.appendChild(z);
        }
    }
    renderPieces();
    refreshInteractive();
  }

  function renderPieces() {
    const pieces = document.getElementById("pieces");
    if (!pieces || !G) return;
    pieces.innerHTML = "";
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = G.grid[r][c];
        if (!v) continue;
        const p = document.createElement("div");
        p.className = "piece " + (v === 1 ? "me" : "opp");
        p.dataset.r = r; p.dataset.c = c; p.dataset.v = v;
        p.style.left = PX(c) + "%";
        p.style.top = PY(r) + "%";
        pieces.appendChild(p);
      }
  }

  const pieceAt = (r, c) => document.querySelector(`.piece[data-r="${r}"][data-c="${c}"]`);

  /* ---------- Surlignage / coups disponibles ---------- */
  function clearDots() {
    const d = document.getElementById("dots");
    if (d) d.innerHTML = "";
    document.querySelectorAll(".piece.sel").forEach((p) => p.classList.remove("sel"));
    hideChoice();
  }

  function select(r, c) {
    clearDots();
    G.sel = { r, c };
    pieceAt(r, c)?.classList.add("sel");
    const mine = eligibilityCache.filter((m) => m.from[0] === r && m.from[1] === c);
    const dots = document.getElementById("dots");
    if (!dots) return;
    const byDest = {};
    mine.forEach((m) => { const k = m.to[0] + "," + m.to[1]; (byDest[k] = byDest[k] || []).push(m); });
    Object.values(byDest).forEach((group) => {
      const m = group[0];
      const d = document.createElement("div");
      d.className = "dot" + (m.cap.length ? " cap" : "") + (group.length > 1 ? " dual" : "");
      d.style.left = PX(m.to[1]) + "%";
      d.style.top = PY(m.to[0]) + "%";
      d.title = m.cap.length ? `Prise de ${m.cap.length} pion(s)` : "Déplacement simple";
      d.addEventListener("click", (e) => {
        e.stopPropagation();
        if (group.length > 1) showChoice(group);
        else doMove(group[0]);
      });
      dots.appendChild(d);
    });
  }

  function showChoice(group) {
    const box = document.getElementById("capture-choice");
    if (!box) return;
    const [tr, tc] = group[0].to;
    box.innerHTML = "";
    box.style.left = PX(tc) + "%";
    box.style.top = PY(dy(tr)) + "%";
    box.hidden = false;
    group.forEach((m) => {
      const b = document.createElement("button");
      b.className = "choice-btn";
      b.textContent = (m.kind === "apr" ? "Prise par approche" : "Prise par retrait") + ` (${m.cap.length})`;
      b.addEventListener("click", (e) => { e.stopPropagation(); doMove(m); });
      box.appendChild(b);
    });
  }
  const hideChoice = () => { const b = document.getElementById("capture-choice"); if (b) b.hidden = true; };

  /* ---------- Interaction humaine ---------- */
  function onCell(r, c) {
    if (!G || G.over || G.spectator || G.turn !== meVal() || G.busy) return;
    const v = G.grid[r][c];
    if (G.sel && G.sel.r === r && G.sel.c === c && !G.chain) { G.sel = null; clearDots(); return; }
    if (v === meVal()) {
      const playable = eligibilityCache.some((m) => m.from[0] === r && m.from[1] === c);
      if (playable) select(r, c);
      else pulsePlayable(r, c);
      return;
    }
    // Un pion est déjà sélectionné : on peut valider le déplacement en tapant
    // DIRECTEMENT la case de destination (fiable sur mobile, au lieu de viser
    // le petit point). Si plusieurs types de prise mènent au même endroit, on
    // laisse choisir (approche/retrait).
    if (G.sel) {
      const moves = eligibilityCache.filter(
        (m) => m.from[0] === G.sel.r && m.from[1] === G.sel.c && m.to[0] === r && m.to[1] === c
      );
      if (moves.length) {
        if (moves.length > 1) showChoice(moves);
        else doMove(moves[0]);
      }
      return;
    }
  }

  /* Retour visuel quand on clique un pion qui ne peut pas bouger :
     lève le doute "je ne peux rien faire" en montrant où jouer. */
  function pulsePlayable(clickedR, clickedC) {
    const clicked = document.querySelector(`.piece[data-r="${clickedR}"][data-c="${clickedC}"]`);
    if (clicked) { clicked.classList.remove("reject"); void clicked.offsetWidth; clicked.classList.add("reject"); }
    // Révéler les pions réellement jouables UNIQUEMENT en entraînement IA.
    if (helpOn()) {
      document.querySelectorAll(".piece.playable").forEach((p) => {
        p.classList.remove("pulse"); void p.offsetWidth; p.classList.add("pulse");
      });
    }
    if (App && App.miniToast) {
      App.miniToast(G.chain
        ? "Prise en chaîne : continuez avec le même pion"
        : helpOn() ? "Ce pion ne peut pas jouer — les coups se font sur les pions mis en surbrillance"
                   : "Ce pion ne peut pas jouer", "warn", 3200);
    }
  }

  function doMove(m) {
    clearDots();
    G.busy = true;
    // Mode en ligne : envoie au serveur, attend l'état officiel
    if (G.mode === "online" || G.mode === "defi") {
      if (G.busyWatch) clearTimeout(G.busyWatch);
      // Watchdog anti-gel : si aucune réponse (état ou erreur) ne revient, on se débloque.
      G.busyWatch = setTimeout(() => unstuck(), 5000);
      if (onMoveCb) onMoveCb(m);
      else G.busy = false;
      return;
    }
    // Mode IA local
    const [fr, fc] = m.from, [tr, tc] = m.to;
    G.grid[fr][fc] = 0;
    G.grid[tr][tc] = G.turn;
    m.cap.forEach(([cr, cc]) => { G.grid[cr][cc] = 0; });
    markLastMove(fr, fc, tr, tc);
    logMove(m);
    setTimeout(() => {
      G.busy = false;
      if (m.cap.length) {
        const visited = G.chain ? new Set(G.chain.visited) : new Set([fr + "," + fc]);
        visited.add(tr + "," + tc);
        G.chain = { pos: [tr, tc], visited, lastDir: m.dir };
        const cont = legalMoves(G.grid, G.turn, G.chain);
        if (cont.length) {
          eligibilityCache = cont;
          renderPieces(); // chaîne : reflète la prise en cours avant de continuer
          updateAll();
          if (G.turn === 1) {
            document.getElementById("chain-bar").hidden = false;
            select(tr, tc);
          } else scheduleAi(560);
          return;
        }
      }
      G.chain = null;
      document.getElementById("chain-bar").hidden = true;
      endTurn();
    }, m.cap.length ? 430 : 330);
  }

  function endChain() {
    if (!G || G.turn !== 1 || !G.chain) return;
    if (G.mode === "online" || G.mode === "defi") {
      if (onMoveCb) { G.sel = null; clearDots(); onMoveCb({ end: true }); }
      return;
    }
    G.chain = null; G.sel = null;
    clearDots();
    document.getElementById("chain-bar").hidden = true;
    endTurn();
  }

  function endTurn() {
    renderPieces(); // re-synchronise le DOM avec le nouveau plateau (pièces qui bougent/disparaissent)
    updateCaptured();
    const winner = checkWin();
    if (winner) return finish(winner, "capture");
    G.turn = G.turn === 1 ? 2 : 1;
    eligibilityCache = legalMoves(G.grid, G.turn, null);
    if (!eligibilityCache.length) return finish(G.turn === 1 ? 2 : 1, "blocage");
    updateAll();
    if (G.turn === 2) scheduleAi(700 + Math.random() * 500);
  }

  function checkWin() {
    const me = countPieces(G.grid, meVal()), opp = countPieces(G.grid, oppVal());
    if (!opp) return 1;
    if (!me) return 2;
    return 0;
  }

  /* ---------- IA locale ---------- */
  function scheduleAi(delay) {
    if (!G || G.over) return;
    G.aiTimer = setTimeout(aiStep, delay);
  }
  function aiStep() {
    if (!G || G.over || G.turn !== 2) return;
    const moves = legalMoves(G.grid, 2, G.chain);
    if (!moves.length) return finish(1, "blocage");
    const caps = moves.filter((m) => m.cap.length);
    let m;
    if (caps.length) {
      const best = Math.max(...caps.map((x) => x.cap.length));
      const pool = caps.filter((x) => x.cap.length === best || (Math.random() < 0.25 && x.cap.length === best - 1));
      m = pool[Math.floor(Math.random() * pool.length)];
    } else {
      m = moves[Math.floor(Math.random() * moves.length)];
    }
    doMove(m);
  }

  /* ---------- Rendu HUD ---------- */
  function markLastMove(fr, fc, tr, tc) {
    const lm = document.getElementById("lastmove");
    if (!lm) return;
    /* dy est en % de la hauteur : on le ramène en « % de largeur » (ratio 955/1647)
       pour que la longueur et l'angle de la trace soient exacts sur le plateau large. */
    const dx = PX(tc) - PX(fc), dy = (PY(tr) - PY(fr)) * (955 / 1647);
    lm.hidden = false;
    lm.style.left = PX(fc) + "%";
    lm.style.top = PY(fr) + "%";
    lm.style.width = Math.hypot(dx, dy) + "%";
    lm.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }

  function coord(r, c) { return String.fromCharCode(97 + c) + (5 - r); }

  function logMove(m) {
    if (!m || !m.from || !m.to) return;
    const who = G.opponent && G.turn === 2 ? "Vous" : (G.opponent ? G.opponent.pseudo : "Adversaire");
    const li = document.createElement("li");
    li.innerHTML = `<span class="mv-who">${who}</span> ${coord(m.from[0], m.from[1])} → ${coord(m.to[0], m.to[1])}` +
      (m.cap && m.cap.length ? ` <b class="mv-cap">×${m.cap.length}</b>` : "");
    const log = document.getElementById("move-log");
    if (log) { log.appendChild(li); log.scrollTop = log.scrollHeight; }
  }

  function updateCaptured() {
    const oppTaken = 22 - countPieces(G.grid, oppVal());
    const meTaken = 22 - countPieces(G.grid, meVal());
    const c1 = document.getElementById("cap-me");
    const c2 = document.getElementById("cap-opp");
    if (c1) c1.textContent = "×" + oppTaken;
    if (c2) c2.textContent = "×" + meTaken;
    const fill = document.getElementById("scorebar-fill");
    if (fill) fill.style.width = (50 + (oppTaken - meTaken) * 2.2) + "%";
  }

  function updateAll() {
    updateCaptured();
    const t1 = document.getElementById("hud-turn-me");
    const t2 = document.getElementById("hud-turn-opp");
    if (t1) t1.classList.toggle("on", G.turn === meVal());
    if (t2) t2.classList.toggle("on", G.turn === oppVal());
    updateTurnBanner();
    refreshInteractive();
  }

  /* Bandeau « À qui le tour ? » — visible pour les joueurs et les spectateurs.
     Colore le bandeau du bon camp et surligne la barre du joueur actif. */
  function updateTurnBanner() {
    const bar = document.getElementById("turn-banner");
    const txt = document.getElementById("turn-banner-txt");
    const nameEl = document.getElementById("turn-banner-name");
    const meBar = document.querySelector(".player-bar:not(.opp)");
    const oppBar = document.querySelector(".player-bar.opp");
    const show = !!(G && !G.over && G.turn);
    if (bar) bar.classList.toggle("show", show);
    if (meBar) {
      meBar.classList.toggle("on-turn", show && G.turn === meVal());
      oppBar.classList.toggle("on-turn", show && G.turn === oppVal());
      meBar.classList.toggle("muted", show && G.turn !== meVal());
      oppBar.classList.toggle("muted", show && G.turn !== oppVal());
    }
    if (!show) return;
    const meName = (document.getElementById("hud-me-name") || {}).textContent || "Vous";
    const oppName = (document.getElementById("hud-opp-name") || {}).textContent || "Adversaire";
    const mine = G.turn === meVal();
    const who = mine ? meName : oppName;
    bar.classList.toggle("me", mine);
    bar.classList.toggle("opp", !mine);
    txt.textContent = (mine && !G.spectator) ? "⚡ À VOUS de jouer —" : "⏳ Tour de";
    nameEl.textContent = who;
  }

  function refreshInteractive() {
    const boardEl = document.getElementById("fanorona-board");
    if (!boardEl || !G) return;
    boardEl.classList.toggle("myturn", G.turn === meVal() && !G.over);
    const help = helpOn();
    document.querySelectorAll(".piece").forEach((p) => {
      const myPlayable = G.turn === meVal() && +p.dataset.v === meVal() &&
        eligibilityCache.some((m) => m.from[0] === +p.dataset.r && m.from[1] === +p.dataset.c);
      p.classList.toggle("playable", !!(myPlayable && help));
    });
    // Indication d'aide — uniquement en entraînement IA
    const hint = document.getElementById("hint");
    if (hint) {
      if (!G || G.over) hint.textContent = "";
      else if (!help) hint.textContent = "";
      else if (G.turn !== meVal()) hint.textContent = "⏳ Tour de l'adversaire…";
      else hint.textContent = `💡 À vous de jouer — ${eligibilityCache.length} coup(s) possible(s)`;
    }
  }

  function tickClock() {
    if (!G || G.over) return;
    const t = G.turn === meVal() ? "me" : "opp";
    G.clock[t] = Math.max(0, G.clock[t] - 1);
    const el = document.getElementById("clock-" + t);
    if (el) {
      const s = G.clock[t];
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      el.classList.toggle("low", s < 60);
    }
    if (G.clock[t] === 0 && !G.spectator) finish(t === "me" ? 2 : 1, "temps");
  }

  /* ---------- Fin de partie ---------- */
  function finish(winner, reason) {
    if (G && G.over) return;
    if (G) {
      G.over = true;
      clearTimeout(G.aiTimer);
      const cb = document.getElementById("chain-bar");
      if (cb) cb.hidden = true;
      clearDots();
      updateAll();
      if (App && App.onGameEnd) App.onGameEnd({
        winner, reason, mode: G.mode, opponent: G.opponent,
        wager: G.wager, format: G.format, moves: (G.moves || []).length,
        oppLeft: countPieces(G.grid, oppVal()), meLeft: countPieces(G.grid, meVal()),
      });
    }
  }

  function quit() {
    if (G) clearTimeout(G.aiTimer);
    G = null;
    const bar = document.getElementById("turn-banner");
    if (bar) bar.classList.remove("show");
  }

  /* Débloque le plateau après un échec d'envoi (coup rejeté par le serveur,
     coupure WS…) pour éviter qu'un joueur reste gelé "busy" jusqu'au coup adverse. */
  function unstuck() {
    if (G) {
      if (G.busyWatch) { clearTimeout(G.busyWatch); G.busyWatch = null; }
      G.busy = false;
      refreshInteractive();
    }
  }

  /* ---------- Init ---------- */
  function initialGrid() {
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    for (let c = 0; c < COLS; c++) { g[0][c] = 2; g[1][c] = 2; g[3][c] = 1; g[4][c] = 1; }
    g[2] = [2, 1, 2, 1, 0, 1, 2, 1, 2];
    return g;
  }

  function setupHud({ mode, formatId, opponent, wager, playerNum, spectator }) {
    const format = FORMATS.find((f) => f.id === formatId) || FORMATS[0];
    const oppName = document.getElementById("hud-opp-name");
    if (oppName) oppName.textContent = opponent ? opponent.pseudo : "Adversaire";
    const oppElo = document.getElementById("hud-opp-elo");
    if (oppElo) oppElo.textContent = (opponent ? opponent.elo : 1100) + " Elo";
    const oppAv = document.getElementById("hud-opp-avatar");
    if (oppAv) oppAv.textContent = opponent ? opponent.pseudo.slice(0, 2).toUpperCase() : "AD";
    const hudFmt = document.getElementById("hud-format");
    if (hudFmt) hudFmt.textContent = `Fanorona · ${format.name} · ${format.label}`;
    const hudW = document.getElementById("hud-wager");
    if (hudW) hudW.textContent =
      spectator ? "👁 Mode spectateur — match en direct (lecture seule)" :
      mode === "defi" && wager ? `Mise : ${fmtAr(wager)} × 2` :
      mode === "online" ? "Partie classée — points Elo en jeu" :
      mode === "ai" ? "Entraînement — sans impact Elo ni wallet" : "Match en cours";
    // Un spectateur ne peut ni abandonner ni proposer une nulle
    const br = document.getElementById("btn-resign");
    if (br) br.disabled = !!spectator;
    const bd = document.getElementById("btn-draw");
    if (bd) bd.disabled = !!spectator;
    const oppRank = document.getElementById("opp-rank-mini");
    if (oppRank) oppRank.textContent = rankFor(opponent ? opponent.elo : 1100).name;
    const ml = document.getElementById("move-log");
    if (ml) ml.innerHTML = "";
    const c1 = document.getElementById("clock-me");
    if (c1) c1.textContent = `${String(format.time / 60).padStart(2, "0")}:00`;
    const c2 = document.getElementById("clock-opp");
    if (c2) c2.textContent = `${String(format.time / 60).padStart(2, "0")}:00`;
    const cbar = document.getElementById("chain-bar");
    if (cbar) cbar.hidden = true;
  }

  /* start : mode IA local */
  function start({ mode, formatId, opponent, wager }) {
    quit();
    const format = FORMATS.find((f) => f.id === formatId) || FORMATS[0];
    /* Tirage au sort (règle officielle) : le joueur 1 choisit PILE ou FACE,
       l'IA reçoit automatiquement l'autre face, puis on lance la pièce. */
    G = {
      grid: initialGrid(), turn: null, sel: null, chain: null, over: false, busy: false,
      mode, format, opponent, wager: wager || 0, playerNum: 1,
      phase: "choose", choices: { 1: null, 2: null }, toss: null,
      clock: { me: format.time, opp: format.time }, moves: [], aiTimer: null,
    };
    onMoveCb = null;
    setupHud({ mode, formatId, opponent, wager });
    buildBoard();
    eligibilityCache = [];
    updateAll();
    if (mode === "ai" && App && App.miniToast) {
      App.miniToast("Choisissez votre face (PILE ou FACE). Une fois prise, l'IA reçoit automatiquement l'autre face.", "info");
    }
  }

  /* Choix de la face par le joueur humain (mode IA local). Le joueur 1 choisit
     PILE ou FACE ; l'IA (joueur 2) reçoit automatiquement l'autre face. */
  function chooseSide(side) {
    if (!G || G.phase !== "choose" || G.over) return G;
    if (side !== "pile" && side !== "face") return G;
    G.choices[1] = side;
    G.choices[2] = side === "pile" ? "face" : "pile";
    G.phase = "play";
    G.toss = {
      side: Math.random() < 0.5 ? "pile" : "face",
      starter: 1, choices: { 1: G.choices[1], 2: G.choices[2] },
    };
    G.starter = G.choices[1] === G.toss.side ? 1 : 2;
    G.turn = G.starter;
    eligibilityCache = (G.turn === meVal() && !G.over) ? legalMoves(G.grid, G.turn, null) : [];
    updateAll();
    if (G.mode === "ai" && G.turn === 2) scheduleAi(600 + Math.random() * 600);
    return G;
  }

  /* ---------- API serveur : appliquer un état officiel ---------- */
  function applyServerState(state, { mode, opponent, wager, playerNum, onMove, spectator }) {
    if (G && G.busyWatch) { clearTimeout(G.busyWatch); G.busyWatch = null; }
    const format = FORMATS.find((f) => f.id === (state.format && state.format.id)) || FORMATS[0];
    if (!G || G.mode !== mode || !!G.spectator !== !!spectator) {
      G = {
        grid: state.grid, turn: state.turn, sel: null,
        chain: state.chain ? { pos: state.chain.pos, visited: new Set(state.chain.visited), lastDir: state.chain.lastDir } : null,
        over: state.over || false, busy: false,
        phase: state.phase || "play", choices: state.choices || { 1: null, 2: null },
        mode, format, opponent, wager: wager || 0,
        clock: state.clock ? { me: state.clock[playerNum], opp: state.clock[playerNum === 1 ? 2 : 1] } : { me: format.time, opp: format.time },
        moves: state.moves || [], aiTimer: null,
        toss: state.toss || null,
        playerNum, spectator: !!spectator,
      };
      onMoveCb = onMove;
      setupHud({ mode, formatId: format.id, opponent, wager, playerNum, spectator });
      buildBoard();
    } else {
      G.grid = state.grid;
      G.turn = state.turn;
      G.chain = state.chain ? { pos: state.chain.pos, visited: new Set(state.chain.visited), lastDir: state.chain.lastDir } : null;
      G.over = state.over || false;
      G.phase = state.phase || "play";
      G.choices = state.choices || G.choices;
      G.clock = state.clock ? { me: state.clock[playerNum], opp: state.clock[playerNum === 1 ? 2 : 1] } : G.clock;
      G.moves = state.moves || G.moves;
      G.toss = state.toss || G.toss;
      G.busy = false;
      G.sel = null;
      renderPieces();
    }
    // journal des derniers coups
    const log = document.getElementById("move-log");
    if (log) {
      log.innerHTML = "";
      const last = (G.moves || []).slice(-20);
      last.forEach((m) => {
        if (!m.from || !m.to) return;
        const li = document.createElement("li");
        li.innerHTML = coord(m.from[0], m.from[1]) + " → " + coord(m.to[0], m.to[1]) +
          (m.cap && m.cap.length ? ` <b class="mv-cap">×${m.cap.length}</b>` : "");
        log.appendChild(li);
      });
      log.scrollTop = log.scrollHeight;
    }
    // dernière case
    const lm = document.getElementById("lastmove");
    if (lm) {
      const last = (G.moves || []).slice(-1)[0];
      if (last && last.from && last.to) markLastMove(last.from[0], last.from[1], last.to[0], last.to[1]);
      else lm.hidden = true;
    }
    eligibilityCache = (G.turn === meVal() && !G.over && !G.spectator) ? legalMoves(G.grid, meVal(), G.chain) : [];
    updateAll();
    const cbar = document.getElementById("chain-bar");
    if (cbar && G.chain && G.turn === meVal() && !G.spectator) cbar.hidden = false;
    // Prise en chaîne : sélection automatique du pion actif + affichage de ses
    // destinations de continuation. Sans cela, l'utilisateur ne sait pas quel
    // pion continuer ni vers où → il cliquait d'autres pions et recevait en
    // boucle « Ce pion ne peut pas jouer ».
    if (!G.spectator && G.turn === meVal() && G.chain && eligibilityCache.length) {
      select(G.chain.pos[0], G.chain.pos[1]);
    }
  }

  return {
    start, quit, applyServerState, endChain, tickClock,
    chooseSide,
    isActive: () => !!(G && !G.over),
    resign: () => { if (G && !G.over) finish(2, "abandon"); },
    state: () => G,
    setOnMove: (cb) => { onMoveCb = cb; },
    setHelp, isHelp, unstuck,
  };
})();

window.Fanorona = Fanorona;