/* =========================================================
   D-aôna — Client réel connecté au serveur (HTTP + WS)
   ========================================================= */
"use strict";

const App = (() => {

  /* ------------------ ÉTAT ------------------ */
  const DEFAULT_STATE = () => ({
    id: null, pseudo: "Joueur", elo: 1100, wins: 0, losses: 0,
    balance: 0, bonusLock: 0, kyc: false, bonusUsed: false, withdrawnToday: 0, avatar: null,
    txs: [], games: [], tournaments: [], myRegs: {}, leaderboard: [],
    skins: { owned: ["pions-classique"], equipped: { pions: "pions-classique", plateau: null, effet: null } },
    settings: { notifPush: true, notifTournoi: true, son: false },
    contacts: [], onlineUsers: [], chatThreads: {}, defis: [], friends: [],
    friendRequests: { incoming: [], outgoing: [] },
    currentSession: null, playerNum: 1, matchmaking: false, formats: FORMATS,
  });

  let S = DEFAULT_STATE();
  let playCfg = { mode: "online", format: "blitz", friend: "", wager: 0 };
  let playStep = 1;   // Wizard Jeux : 1=jeu, 2=mode, 3=format, 4=lancer
  let chatWith = "";
  let rankScope = "national", rankProvince = "Antananarivo", rankSearch = "";
  let lastGameCfg = null;
  let spectatingId = null;   // sessionId du match regardé en direct (mode spectateur)
  /* Messagerie flottante : fenêtres ouvertes (PC) / encoche (mobile), compteur de messages non lus */
  let chatDockOpen = false;
  let chatPopups = [];        // pseudos des conversations ouvertes en pop-up (PC)
  let unreadChats = {};       // pseudo -> nb de messages non lus

  /* ------------------ HELPERS UI ------------------ */
  function toast(msg, type = "ok", ms = 3400) {
    const host = document.getElementById("toasts");
    const t = document.createElement("div");
    t.className = "toast " + (type !== "ok" ? type : "");
    const ico = type === "error" ? "⛔" : type === "warn" ? "⚠️" : "✅";
    t.innerHTML = `<span class="t-ico">${ico}</span><span>${msg}</span>`;
    host.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, ms);
  }
  const miniToast = (msg, type = "info", ms = 2600) => toast(msg, type === "warn" ? "warn" : type === "error" ? "error" : "ok", ms);

  function showModal(html, size = "", locked = false) {
    const ov = document.getElementById("modal-overlay");
    const m = document.getElementById("modal");
    m.className = "modal " + size;
    m.innerHTML = html;
    ov.classList.add("show");
    ov.dataset.locked = locked ? "1" : "";
  }
  function closeModal() { document.getElementById("modal-overlay").classList.remove("show"); }

  function copyLink(text, label = "Lien copié") {
    const done = () => toast(label + " : " + text);
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(done).catch(done);
    else done();
  }

  const currentRoute = () => (location.hash.replace("#/", "") || "home").split("?")[0];
  function go(r) { location.hash = "#/" + r; }

  /* ------------------ THÈME (nuit / jour) ------------------ */
  const THEMES = ["night", "light"];
  const THEME_META = {
    night: { label: "Mode nuit", next: "jour", icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" opacity=".45"/>' },
    light: { label: "Mode jour", next: "nuit", icon: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>' },
  };
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  function applyTheme(theme, silent = false) {
    if (!THEMES.includes(theme)) theme = "light";
    const root = document.documentElement;
    root.classList.add("theme-anim");
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem("daona_theme", theme); } catch (e) {}
    const ico = document.getElementById("theme-icon");
    if (ico) ico.innerHTML = THEME_META[theme].icon;
    const btn = document.getElementById("btn-theme");
    if (btn) {
      btn.title = `${THEME_META[theme].label} — cliquer pour passer en mode ${THEME_META[theme].next}`;
      btn.onclick = cycleTheme;   // rebind systématique (l'écouteur peut être perdu)
    }
    setTimeout(() => root.classList.remove("theme-anim"), 420);
    if (!silent) toast(`${THEME_META[theme].label} activé`);
  }
  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
    applyTheme(next);
  }

  /* ------------------ PHOTO DE PROFIL : crop carré auto ------------------
     Accepte tous les formats/résolutions lisibles par le navigateur.
     L'image est recadrée en carré centré puis redimensionnée (256×256 JPEG)
     → pas de déformation, poids réduit (~30-80 Ko), compatible limite serveur. */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Lecture du fichier impossible"));
      r.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Format d'image non supporté"));
      img.src = src;
    });
  }
  /* Crop carré centré + resize. Exposé pour les tests. */
  function cropImageToSquare(img, size = 256) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("Image invalide");
    const side = Math.min(w, h);
    const sx = (w - side) / 2, sy = (h - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  }
  async function processAvatarFile(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("Choisissez un fichier image (PNG, JPG, WebP…)");
    if (file.size > 15 * 1024 * 1024) throw new Error("Image trop lourde (max 15 Mo)");
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    return cropImageToSquare(img, 256);
  }

  /* ------------------ SYNCHRO BACKEND ------------------ */
  async function refreshUser() {
    try {
      const d = await API.request("/api/user");
      const u = d.user;
      S.id = u.id; S.pseudo = u.pseudo; S.elo = u.elo; S.wins = u.wins; S.losses = u.losses;
      S.balance = u.balance; S.bonusLock = u.bonus_lock; S.kyc = !!u.kyc;
      S.bonusUsed = !!u.bonus_used; S.withdrawnToday = u.withdrawn_today || 0;
      S.avatar = u.avatar || null;
      S.txs = d.transactions || [];
      updateTopbar();
    } catch (e) { console.error("refreshUser", e); }
  }

  async function refreshTournaments() {
    try {
      const d = await API.request("/api/tournaments");
      S.tournaments = (d.tournaments || []).map((t) => ({
        id: t.id, name: t.name, game: t.game, format: t.format, entry: t.entry,
        maxPlayers: t.maxPlayers, status: t.status, minRank: t.minRank, sponsor: t.sponsor,
        startsInSec: t.startsInSec, registered: t.registered || [], isRegistered: t.isRegistered,
        results: t.results,
      }));
      S.myRegs = {};
      S.tournaments.forEach((t) => { if (t.isRegistered) S.myRegs[t.id] = true; });
    } catch (e) { console.error("refreshTournaments", e); }
  }

  async function refreshLeaderboard() {
    try {
      const d = await API.request("/api/leaderboard");
      S.leaderboard = d.leaderboard || [];
    } catch (e) { console.error("refreshLeaderboard", e); }
  }

  async function refreshSkins() {
    try {
      const d = await API.request("/api/skins");
      S.skins = { owned: d.owned || ["pions-classique"], equipped: d.equipped || { pions: "pions-classique", plateau: null, effet: null } };
    } catch (e) { console.error("refreshSkins", e); }
  }

  async function refreshGames() {
    try {
      const d = await API.request("/api/games/history");
      S.games = (d.games || []).map((g) => ({
        vs: g.p1_name === S.pseudo ? g.p2_name : g.p1_name,
        result: g.winner_id === null ? "En cours" : (g.winner_id === S.id ? "Victoire" : "Défaite"),
        delta: g.winner_id === S.id ? g.delta1 : (g.delta1 || 0),
        mode: g.mode + " · " + (FORMATS.find((f) => f.id === g.format)?.name || g.format),
        at: (g.created_at || "").slice(0, 10),
      }));
    } catch (e) { console.error("refreshGames", e); }
  }

  async function refreshContacts() {
    try {
      const d = await API.request("/api/chat/contacts");
      S.contacts = d.contacts || [];
      S.onlineUsers = d.onlineUsers || [];
      // charger les threads
      S.chatThreads = {};
      const all = [...S.contacts];
      for (const c of all) {
        try {
          const t = await API.request("/api/chat/" + encodeURIComponent(c.pseudo));
          S.chatThreads[c.pseudo] = (t.messages || []).map((m) => ({
            from: m.direction === "me" ? "me" : "them", text: m.text, at: (m.created_at || "").slice(11, 16),
          }));
        } catch (e) { S.chatThreads[c.pseudo] = []; }
      }
      if (!chatWith && S.contacts.length) chatWith = S.contacts[0].pseudo;
      renderChatDock();
    } catch (e) { console.error("refreshContacts", e); }
  }

  async function refreshFriends() {
    try {
      const d = await API.request("/api/friends");
      S.friends = d.friends || [];
      S.friendRequests = { incoming: d.incoming || [], outgoing: d.outgoing || [] };
    } catch (e) { console.error("refreshFriends", e); }
  }

  async function loadAll() {
    await Promise.allSettled([refreshUser(), refreshTournaments(), refreshLeaderboard(), refreshSkins(), refreshGames(), refreshContacts(), refreshFriends()]);
    applySkins();
    if (currentRoute() !== "board") route();
  }

  /* ------------------ TOPBAR ------------------ */
  function updateTopbar() {
    document.getElementById("tb-balance").textContent = fmtAr(S.balance);
    const tbAv = document.getElementById("tb-avatar");
    if (S.avatar) {
      tbAv.innerHTML = `<img src="${S.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      tbAv.classList.add("has-photo");
    } else {
      tbAv.textContent = S.pseudo.slice(0, 2).toUpperCase();
      tbAv.classList.remove("has-photo");
    }
    const kyc = document.getElementById("tb-kyc");
    kyc.textContent = S.kyc ? "✓ KYC vérifié" : "KYC à vérifier";
    kyc.classList.toggle("ok", S.kyc);
  }

  /* ------------------ BANNIÈRE « REPRENDRE LA PARTIE » ------------------ */
  /* Affichée dans le header tant qu'une partie est en cours alors que le
     joueur n'est PAS sur le plateau (il a cherché quelque chose, navigué
     ailleurs, ou sa connexion a été interrompue). Le clic ramène au plateau
     et resynchronise l'état autoritaire côté serveur. */
  function hasActiveGame() {
    // Ne compte pas les matchs simplement regardés (mode spectateur).
    if (Fanorona && Fanorona.state && Fanorona.state() && Fanorona.state().spectator) return !!S.currentSession;
    return !!S.currentSession || !!(Fanorona && Fanorona.isActive());
  }
  function updateResumeBanner() {
    const bar = document.getElementById("resume-bar");
    if (!bar) return;
    const show = hasActiveGame() && currentRoute() !== "board";
    bar.classList.toggle("show", show);
  }
  function resumeGame() {
    // Après une coupure, resynchroniser l'état avant de réafficher le plateau.
    if (S.currentSession && API.isConnected()) {
      API.send({ type: "sync_game", sessionId: S.currentSession });
    }
    go("board");
    updateResumeBanner();
  }


  /* ------------------ AUTH ------------------ */
  async function enterApp() {
    const val = document.getElementById("auth-id").value.replace(/</g, "").trim();
    if (!val) return toast("Entrez un pseudo.", "warn");
    try {
      const d = await API.request("/api/auth", "POST", { pseudo: val.slice(0, 14) });
      API.setToken(d.token);
      S.id = d.user.id; S.pseudo = d.user.pseudo; S.elo = d.user.elo; S.wins = d.user.wins;
      S.losses = d.user.losses; S.balance = d.user.balance; S.bonusLock = d.user.bonus_lock;
      S.kyc = !!d.user.kyc; S.bonusUsed = !!d.user.bonus_used;
      document.getElementById("auth").classList.add("hidden");
      API.connect();
      await loadAll();
      toast(`Veloma ${S.pseudo} 🇲🇬 — bienvenue sur D-aôna.`);
      if (!S.kyc) setTimeout(() => toast("Astuce : vérifiez votre CIN pour débloquer dépôts, retraits et mises.", "warn", 5200), 1600);
    } catch (e) {
      toast(e.message || "Erreur de connexion au serveur.", "error");
    }
  }

  async function autoLogin() {
    if (!API.getToken()) return;
    try {
      API.connect();
      await refreshUser();
      if (S.id) {
        document.getElementById("auth").classList.add("hidden");
        await loadAll();
      }
    } catch (e) { /* pas de session */ }
  }

  /* ------------------ KYC ------------------ */
  function kycRequired(after) {
    if (S.kyc) { after(); return; }
    showModal(`
      <h2>Vérification d'identité (KYC)</h2>
      <p class="m-sub">Obligatoire avant toute transaction réelle — dépôt, retrait, tournoi ou défi avec mise (PRD §4.4).</p>
      <div class="panel pad-lg" style="border-style:dashed; text-align:center;">
        <div style="font-size:36px;">🪪</div>
        <p class="small muted" style="margin:8px 0 14px;">Photographiez votre <b>Carte d'Identité Nationale</b> (recto).<br>Vérification sous 24 h.</p>
        <button class="btn primary block" id="kyc-upload">📷 Prendre la CIN en photo (simulation locale)</button>
      </div>
      <div class="m-foot"><button class="btn ghost" id="kyc-cancel">Plus tard</button></div>
    `);
    document.getElementById("kyc-cancel").onclick = closeModal;
    document.getElementById("kyc-upload").onclick = () => {
      showModal(`<h2>Analyse du document…</h2><div class="mm-spinner"><div class="mm-orbit"><i></i><i></i><i></i></div><p class="muted small">Vérification (démo locale).</p></div>`, "", true);
      setTimeout(async () => {
        try { await API.request("/api/kyc/verify", "POST", {}); }
        catch (e) { console.error("kyc persist", e); }
        S.kyc = true; updateTopbar(); closeModal();
        toast("🎉 Identité vérifiée — transactions débloquées.");
        after();
      }, 1900);
    };
  }

  /* ------------------ DÉPÔT / RETRAIT ------------------ */
  const OPERATORS = [
    { id: "mvola", name: "MVola", sub: "Telma Madagascar · frais ~2%", color: "#7ac142", txt: "M" },
    { id: "om", name: "Orange Money", sub: "Orange Madagascar · frais ~2%", color: "#ff7900", txt: "O" },
    { id: "airtel", name: "Airtel Money", sub: "Airtel Madagascar · frais ~2%", color: "#e40000", txt: "A" },
  ];
  let depOp = "mvola", depAmount = 5000;

  function depositFlow() {
    kycRequired(() => {
      showModal(`
        <h2>Déposer de l'argent</h2>
        <p class="m-sub">Joueur → opérateur → Wallet D-aôna. Aucune commission D-aôna sur les transactions internes (PRD §4.1).</p>
        ${OPERATORS.map((o) => `<button class="op-card ${o.id === depOp ? "on" : ""}" data-op="${o.id}"><span class="op-dot" style="background:${o.color}">${o.txt}</span><span><b>${o.name}</b><span>${o.sub}</span></span><span class="arrow">›</span></button>`).join("")}
        <label class="f-label">Montant (Ariary)</label>
        <div class="amount-grid">
          ${[2000, 5000, 10000, 20000, 50000, 100000].map((a) => `<div class="amt-chip ${a === depAmount ? "on" : ""}" data-amt="${a}">${new Intl.NumberFormat("fr-FR").format(a)}</div>`).join("")}
        </div>
        <hr class="divider">
        <div class="tn-rows">
          <div class="row"><span>Montant du dépôt</span><span id="dep-amt">${fmtAr(depAmount)}</span></div>
          <div class="row"><span>Frais opérateur estimés (~2%)</span><span class="amber" id="dep-fees">${fmtAr(depAmount * 0.02)}</span></div>
          <div class="row"><span>Crédité sur le wallet</span><span class="pos" id="dep-net">${fmtAr(depAmount)}</span></div>
        </div>
        <div class="m-foot"><button class="btn ghost" id="dep-cancel">Annuler</button><button class="btn primary" id="dep-ok">Confirmer le dépôt</button></div>
      `);
      const refreshChips = () => {
        document.querySelectorAll("#modal .amt-chip").forEach((c) => c.classList.toggle("on", +c.dataset.amt === depAmount));
        document.querySelectorAll("#modal .op-card").forEach((c) => c.classList.toggle("on", c.dataset.op === depOp));
      };
      document.querySelectorAll("#modal .amt-chip").forEach((c) => c.onclick = () => { depAmount = +c.dataset.amt; refreshChips(); });
      document.querySelectorAll("#modal .op-card").forEach((c) => c.onclick = () => { depOp = c.dataset.op; refreshChips(); });
      document.getElementById("dep-cancel").onclick = closeModal;
      document.getElementById("dep-ok").onclick = async () => {
        try {
          const d = await API.request("/api/deposit", "POST", { amount: depAmount, operator: OPERATORS.find((o) => o.id === depOp).name });
          S.balance = d.balance; updateTopbar(); closeModal();
          toast(`Wallet crédité de ${fmtAr(depAmount)}.`);
          await refreshUser();
          if (currentRoute() === "wallet") renderWallet();
        } catch (e) { toast(e.message, "error"); }
      };
    });
  }

  function withdrawFlow() {
    kycRequired(() => {
      const available = Math.max(0, S.balance - S.bonusLock);
      const max = Math.min(500000 - S.withdrawnToday, available);
      showModal(`
        <h2>Retirer mes gains</h2>
        <p class="m-sub">Retrait possible à tout moment, même sans avoir joué (PRD §4.4). Min. 1 000 Ar · Max. 500 000 Ar / jour.</p>
        <label class="f-label">Opérateur de destination</label>
        ${OPERATORS.map((o) => `<button class="op-card ${o.id === depOp ? "on" : ""}" data-op="${o.id}"><span class="op-dot" style="background:${o.color}">${o.txt}</span><span><b>${o.name}</b><span>${o.sub}</span></span><span class="arrow">›</span></button>`).join("")}
        <label class="f-label">Numéro destinataire</label>
        <input type="tel" id="wd-phone" value="034 12 345 67">
        <label class="f-label">Montant (disponible : ${fmtAr(Math.max(0, available))})</label>
        <input type="number" id="wd-amount" min="1000" max="${max}" value="1000">
        <div class="m-foot"><button class="btn ghost" id="wd-cancel">Annuler</button><button class="btn primary" id="wd-ok">Valider le retrait</button></div>
      `);
      document.querySelectorAll("#modal .op-card").forEach((c) => c.onclick = () => {
        depOp = c.dataset.op;
        document.querySelectorAll("#modal .op-card").forEach((x) => x.classList.toggle("on", x === c));
      });
      document.getElementById("wd-cancel").onclick = closeModal;
      document.getElementById("wd-ok").onclick = async () => {
        const amount = parseInt(document.getElementById("wd-amount").value) || 0;
        if (amount < 1000) return toast("Retrait minimum : 1 000 Ar.", "warn");
        if (amount > available) return toast("Solde insuffisant (bonus non retirable exclu).", "error");
        try {
          const op = OPERATORS.find((o) => o.id === depOp);
          await API.request("/api/withdraw", "POST", { amount, operator: op.name });
          closeModal();
          toast(`Retrait de ${fmtAr(amount)} en cours de traitement vers ${op.name}…`);
          await refreshUser();
          if (currentRoute() === "wallet") renderWallet();
        } catch (e) { toast(e.message, "error"); }
      };
    });
  }

  /* ------------------ ACCUEIL ------------------ */
  function renderHome() {
    const r = rankFor(S.elo);
    const nextT = S.tournaments.filter((t) => t.status === "inscriptions").sort((a, b) => a.startsInSec - b.startsInSec)[0];
    const winRate = Math.round(100 * S.wins / Math.max(1, S.wins + S.losses));
    const defisList = S.defis || [];
    document.getElementById("home-root").innerHTML = `
      <div class="home-grid">
        <div>
          <div class="home-hero">
            <span class="pill green" style="margin-bottom:12px;">Saison 2 — 2026 · classé ouvert</span>
            <div class="dash-profile">
              <span class="avatar dash-avatar">${S.pseudo.slice(0, 2).toUpperCase()}</span>
              <div class="dash-info">
                <h2>${S.pseudo}</h2>
                <div class="dash-meta">
                  <span class="pill" style="color:${r.color}; border-color:${r.color}55;">◆ ${r.name}</span>
                  <span class="pill amber mono">${S.elo} Elo</span>
                </div>
              </div>
            </div>
            <div class="dash-stats">
              <div class="dash-stat"><div class="v pos">${S.wins}</div><div class="k">Victoires</div></div>
              <div class="dash-stat"><div class="v neg">${S.losses}</div><div class="k">Défaites</div></div>
              <div class="dash-stat"><div class="v">${winRate}%</div><div class="k">Win rate</div></div>
            </div>
          </div>
          <div class="home-row">
            <div class="panel quick-stat"><div class="v">${S.games.length + S.wins + S.losses}</div><div class="l">Parties jouées</div></div>
            <div class="panel quick-stat"><div class="v pos">${winRate}%</div><div class="l">Victoires</div></div>
            <div class="panel quick-stat"><div class="v amber mono">${fmtAr(S.balance)}</div><div class="l">Solde wallet</div></div>
          </div>
          <div style="margin-top:16px;">
            <div class="panel-title">Dernières parties</div>
            <div class="panel">
              ${S.games.slice(0, 4).map((g) => `
                <div class="feed-item">
                  <span class="feed-ic" style="background:${g.result === "Victoire" ? "var(--green-soft)" : "var(--red-soft)"}">${g.result === "Victoire" ? "🏆" : "💥"}</span>
                  <div style="flex:1;"><div class="t1">${g.result} contre <b>${g.vs}</b> <span class="muted small">· ${g.mode}</span></div><div class="t2">${g.at}</div></div>
                  <span class="mono ${g.delta >= 0 ? "pos" : "neg"}" style="font-weight:700;">${g.delta >= 0 ? "+" : ""}${g.delta} Elo</span>
                </div>`).join("") || '<p class="muted">Aucune partie pour le moment.</p>'}
            </div>
          </div>
        </div>
        <div class="side-stack">
          ${nextT ? `
          <div class="t-card">
            <div class="tn-head"><h3>${nextT.name}</h3><span class="pill amber">Cashprice</span></div>
            <div class="t-meta">
              <div class="row"><span>Mise d'entrée (remboursable top 3)</span><span>${fmtAr(nextT.entry)}</span></div>
              <div class="row"><span>Pool estimé (8 joueurs)</span><span>${fmtAr(nextT.entry * nextT.maxPlayers)}</span></div>
              <div class="row"><span>Inscrits</span><span>${nextT.registered.length}/${nextT.maxPlayers}</span></div>
              <div class="row"><span>Début</span><span class="countdown" data-cd="${nextT.id}">${countdownParts(nextT.startsInSec)}</span></div>
            </div>
            <div class="progress"><i style="width:${(nextT.registered.length / nextT.maxPlayers) * 100}%"></i></div>
            <button class="btn primary block" style="margin-top:12px;" onclick="App.tournamentDetail('${nextT.id}')">
              ${S.myRegs[nextT.id] ? "Voir mon inscription" : "S'inscrire — " + fmtAr(nextT.entry)}
            </button>
          </div>` : ""}
          <div class="panel">
            <div class="panel-title">Défis</div>
            <div class="defis-home">
              ${defisList.length ? defisList.map((d) => `
                <div class="defi-row">
                  <span class="avatar" style="width:32px;height:32px;font-size:11px;cursor:default;">${d.from.slice(0, 2).toUpperCase()}</span>
                  <div class="d-info"><div class="d-name"><b>${d.from}</b> <span class="muted small">· ${d.fromElo} Elo · ${d.format}</span></div><div class="d-sub small muted">Mise ${fmtAr(d.wager)} · gain ${fmtAr(d.wager * 2 * 0.9)}</div></div>
                  <div class="d-actions">
                    <button class="btn primary mini-btn" onclick="App.acceptDefi('${d.id}')">Accepter</button>
                    <button class="btn danger mini-btn" onclick="App.refuseDefi('${d.id}')">Refuser</button>
                  </div>
                </div>`).join("")
              : `<div class="panel pad-lg" style="text-align:center; border-style:dashed;"><div style="font-size:30px;">🕊️</div><b style="color:var(--text-strong);">Aucun défi pour le moment</b><p class="small muted" style="margin-top:4px;">Les défis reçus apparaîtront ici.</p></div>`}
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ------------------ ÉCRAN JEUX (Wizard 4 étapes) ------------------ */
  function renderPlay() {
    const modes = [
      { id: "online", icon: "⚔️", title: "Partie classée 1v1", desc: "Matchmaking automatique ±200 points Elo contre un vrai joueur connecté." },
      { id: "defi", icon: "🤝", title: "Défi entre amis", desc: "Avec ou sans mise. Défi en ligne vers un joueur connecté." },
      { id: "ai", icon: "🤖", title: "Entraînement contre l'IA", desc: "Accessible sans KYC. Difficulté plafonnée — aucun impact Elo ni wallet." },
    ];
    const fmtAllowed = (f) => playCfg.mode !== "online" || f.id !== "pro";
    const friends = S.onlineUsers.length ? S.onlineUsers : [{ id: 0, pseudo: "MamyLeo", online: true }, { id: 0, pseudo: "NirinaZ", online: true }];

    /* --- Barre de progression du wizard --- */
    const STEPS = [["1", "Jeu"], ["2", "Mode"], ["3", "Format"], ["4", "Lancer"]];
    const stepBar = `
      <div class="wizard-steps">
        ${STEPS.map(([n, lab], i) => `
          <div class="wstep ${playStep > i ? "done" : ""} ${playStep === i + 1 ? "on" : ""}" data-step="${i + 1}">
            <span class="ws-n">${playStep > i + 1 ? "✓" : n}</span><span class="ws-lab">${lab}</span>
          </div>${i < STEPS.length - 1 ? '<span class="ws-sep"></span>' : ""}`).join("")}
      </div>`;

    /* --- Étape 1 : Choix du jeu --- */
    const step1 = `
      <div class="panel pad-lg">
        <div class="panel-title">Étape 1 — Choisissez votre jeu</div>
        ${GAMES_CATALOG.map((g) => g.status === "mvp" ? `
          <div class="mode-card on" style="cursor:default;">
            <span class="mc-ic">${iconFanorona()}</span>
            <div><h4>${g.name} <span class="pill green" style="margin-left:6px;">Disponible</span></h4><p>${g.desc}</p></div>
          </div>` : `
          <div class="mode-card off" style="opacity:.5; cursor:not-allowed;">
            <span class="mc-ic">🔜</span>
            <div><h4>${g.name} <span class="pill" style="margin-left:6px;">Bientôt</span></h4><p>${g.desc}</p></div>
          </div>`).join("")}
        <button class="btn ghost block" style="margin-top:10px;" onclick="App.rulesModal()">📜 Règles du Fanorona</button>
      </div>`;

    /* --- Étape 2 : Choix du mode --- */
    const step2 = `
      <div class="panel pad-lg">
        <div class="panel-title">Étape 2 — Choisissez le mode de jeu</div>
        ${modes.map((m) => `<div class="mode-card ${playCfg.mode === m.id ? "on" : ""}" data-mode="${m.id}"><span class="mc-ic">${m.icon}</span><div><h4>${m.title}</h4><p>${m.desc}</p></div></div>`).join("")}
        <div class="defi-box ${playCfg.mode === "defi" ? "" : "hidden"}" id="defi-config">
          <label class="f-label">Adversaire (joueur en ligne)</label>
          <select id="defi-friend">
            ${friends.map((f) => `<option ${playCfg.friend === f.pseudo ? "selected" : ""}>${f.pseudo}</option>`).join("")}
          </select>
          <label class="f-label">Mise du défi (les deux joueurs déposent le même montant)</label>
          <div class="chips">
            ${[500, 1000, 2000].map((w) => `<button class="chip ${playCfg.wager === w ? "on" : ""}" data-wager="${w}">${fmtAr(w)}</button>`).join("")}
          </div>
          <p class="small muted" style="margin-top:8px;">Commission plateforme sur les défis : 10% du total des mises (PRD §8.1).</p>
        </div>
      </div>`;

    /* --- Étape 3 : Choix du format --- */
    const step3 = `
      <div class="panel pad-lg">
        <div class="panel-title">Étape 3 — Choisissez le format</div>
        <div class="fmt-row">
          ${FORMATS.map((f) => `<div class="fmt-card ${playCfg.format === f.id ? "on" : ""} ${fmtAllowed(f) ? "" : "off"}" data-fmt="${f.id}" title="${fmtAllowed(f) ? f.desc : "Format Pro : réservé aux tournois Masters / Grand Maître et aux défis sérieux"}"><b>${f.name}</b><span>${f.label}</span><em>${f.desc}</em></div>`).join("")}
        </div>
      </div>`;

    /* --- Étape 4 : Récapitulatif + lancement --- */
    const modeLabel = (modes.find((m) => m.id === playCfg.mode) || {}).title || "";
    const fmtLabel = (FORMATS.find((f) => f.id === playCfg.format) || {}).name || "";
    const step4 = `
      <div class="panel pad-lg">
        <div class="panel-title">Étape 4 — Récapitulatif et lancement</div>
        <div class="recap-box">
          <div class="recap-row"><span class="muted">Jeu</span><b>Fanorona</b></div>
          <div class="recap-row"><span class="muted">Mode</span><b>${modeLabel}</b></div>
          ${playCfg.mode === "defi" ? `<div class="recap-row"><span class="muted">Adversaire</span><b>${playCfg.friend || "—"}</b></div>
          <div class="recap-row"><span class="muted">Mise</span><b class="mono amber">${fmtAr(playCfg.wager)}</b></div>` : ""}
          <div class="recap-row"><span class="muted">Format</span><b>${fmtLabel}</b></div>
        </div>
        <hr class="divider">
        <div class="screen-board" id="play-preview" style="margin:0 auto 6px; max-width:440px; aspect-ratio:1647/955; background:none; border:none; box-shadow:none;">
          <img class="board-img" src="assets/board/plateau_clean.png" alt="Plateau de Fanorona 9 × 5" draggable="false">
        </div>
        <p class="small muted" style="text-align:center; margin:0 0 14px;">Plateau Fanorona 9 × 5 — captures par approche / retrait.</p>
        <button class="btn primary lg block" id="btn-launch">
          ${playCfg.mode === "online" ? "🔎 Lancer le matchmaking" : playCfg.mode === "defi" ? "🤝 Envoyer le défi" : "🤖 Lancer l'entraînement"}
        </button>
        <p class="small muted" style="text-align:center; margin-top:10px;">
          ${playCfg.mode === "ai" ? "✓ Accessible sans KYC · l'IA s'adapte sans jamais être excessivement forte" :
            playCfg.mode === "defi" ? "Le défi est envoyé en temps réel au joueur sélectionné" :
            "Recherche d'un vrai adversaire (Elo " + S.elo + " ±200)"}
        </p>
      </div>`;

    const stepContent = [step1, step2, step3, step4][playStep - 1];
    const canNext = playStep === 1 ? true
      : playStep === 2 ? (playCfg.mode !== "defi" || (!!playCfg.friend && playCfg.wager >= 500))
      : playStep === 3 ? fmtAllowed(FORMATS.find((f) => f.id === playCfg.format) || {})
      : false;

    document.getElementById("play-root").innerHTML = `
      <div class="wizard-wrap">
        ${stepBar}
        <div class="wizard-body">${stepContent}</div>
        <div class="wizard-nav">
          ${playStep > 1 ? `<button class="btn" id="wz-prev">← Retour</button>` : "<span></span>"}
          ${playStep < 4 ? `<button class="btn primary" id="wz-next" ${canNext ? "" : "disabled"}>Suivant →</button>` : "<span></span>"}
        </div>
      </div>`;

    document.querySelectorAll("#play-root .mode-card[data-mode]").forEach((c) => c.onclick = () => {
      playCfg.mode = c.dataset.mode;
      if (playCfg.mode === "online" && playCfg.format === "pro") playCfg.format = "blitz";
      renderPlay();
    });
    document.querySelectorAll("#play-root .fmt-card").forEach((c) => c.onclick = () => {
      if (c.classList.contains("off")) return toast("Format Pro : réservé aux tournois Masters / Grand Maître et aux défis sérieux (PRD §2.4).", "warn");
      playCfg.format = c.dataset.fmt; renderPlay();
    });
    document.querySelectorAll("#play-root [data-wager]").forEach((c) => c.onclick = () => { playCfg.wager = +c.dataset.wager; renderPlay(); });
    const fs = document.getElementById("defi-friend");
    if (fs) { playCfg.friend = playCfg.friend || fs.value; fs.onchange = () => { playCfg.friend = fs.value; renderPlay(); }; }
    const prev = document.getElementById("wz-prev");
    if (prev) prev.onclick = () => { playStep = Math.max(1, playStep - 1); renderPlay(); };
    const next = document.getElementById("wz-next");
    if (next) next.onclick = () => {
      if (playStep === 2 && playCfg.mode === "defi") {
        if (!playCfg.friend) return toast("Choisissez un adversaire.", "warn");
        if (playCfg.wager < 500) return toast("Mise minimale de 500 Ar requise.", "warn");
      }
      playStep = Math.min(4, playStep + 1); renderPlay();
    };
    document.querySelectorAll("#play-root .wstep").forEach((c) => c.onclick = () => {
      const target = parseInt(c.dataset.step);
      if (target <= playStep) { playStep = target; renderPlay(); }
    });
    const lb = document.getElementById("btn-launch");
    if (lb) lb.onclick = launchGame;
  }

  async function launchGame() {
    if (playCfg.mode === "ai") {
      Fanorona.start({ mode: "ai", formatId: playCfg.format, opponent: { pseudo: "IA — Antso", elo: Math.max(600, S.elo - 60), region: "Madagascar" }, wager: 0 });
      go("board");
      _tossShown = false;
      const _st = Fanorona.state();
      openChooseSide({ mode: "ai", sessionId: null, meNum: _st.playerNum, opponent: { pseudo: "IA — Antso" } });
      return;
    }
    if (playCfg.mode === "defi") {
      const target = playCfg.friend || (S.onlineUsers[0] && S.onlineUsers[0].pseudo);
      if (!target) return toast("Sélectionnez un adversaire en ligne.", "warn");
      if (playCfg.wager < 500) return toast("Mise minimale de 500 Ar requise — les défis gratuits ne sont pas autorisés.", "warn");
      kycRequired(() => sendChallenge(target));
      return;
    }
    // online matchmaking
    if (S.matchmaking) return toast("Recherche déjà en cours…", "warn");
    S.matchmaking = true;
    API.send({ type: "find_match", format: playCfg.format, mode: "online" });
    showModal(`
      <h2>Recherche d'adversaire</h2>
      <p class="m-sub">File classée — Fanorona · ${FORMATS.find((f) => f.id === playCfg.format).name}</p>
      <div class="mm-spinner"><div class="mm-orbit"><i></i><i></i><i></i></div>
      <p class="muted small">Recherche d'un vrai joueur sur le serveur…</p></div>
      <div class="m-foot"><button class="btn ghost" id="mm-cancel">Annuler la recherche</button></div>
    `, "", true);
    document.getElementById("mm-cancel").onclick = () => {
      S.matchmaking = false;
      API.send({ type: "cancel_match" });
      closeModal();
    };
  }

  function sendChallenge(target) {
    if (playCfg.wager < 500) return toast("Mise minimale de 500 Ar requise.", "warn");
    API.send({ type: "send_challenge", toPseudo: target, wager: playCfg.wager, format: playCfg.format });
    showModal(`
      <h2>Défi envoyé à ${target} 🤝</h2>
      <p class="m-sub">Le défi expire dans 15 minutes s'il n'est pas accepté.</p>
      <div class="m-foot"><button class="btn ghost" onclick="App.closeModal()">Fermer</button></div>
    `);
  }

  function acceptDefi(id) {
    API.send({ type: "accept_challenge", challengeId: id });
    S.defis = (S.defis || []).filter((x) => x.id !== id);
    toast("Défi accepté — lancement du match…");
  }
  function refuseDefi(id) {
    API.send({ type: "reject_challenge", challengeId: id });
    S.defis = (S.defis || []).filter((x) => x.id !== id);
    toast("Défi refusé.", "warn");
    if (currentRoute() === "home") renderHome();
  }

  /* ------------------ PLATEAU (serveur autoritaire) ------------------ */
  function startServerGame(sessionId, playerNum, state, opponent, mode, format, wager) {
    S.currentSession = sessionId;
    S.playerNum = playerNum;
    go("board");
    updateResumeBanner();
    document.getElementById("hud-me-name").textContent = S.pseudo;
    document.getElementById("hud-me-elo").textContent = S.elo + " Elo";
    document.getElementById("hud-me-avatar").textContent = S.pseudo.slice(0, 2).toUpperCase();
    document.getElementById("me-rank-mini").textContent = rankFor(S.elo).name;
    Fanorona.applyServerState(state, {
      mode: mode === "ai" ? "ai" : (mode === "defi" ? "defi" : "online"),
      opponent, wager, playerNum,
      onMove: (m) => {
        if (m.end) API.send({ type: "end_chain", sessionId });
        else API.send({ type: "move", sessionId, move: m });
      },
    });
    _tossShown = false;
    if (state.phase === "choose") {
      openChooseSide({ mode, sessionId, meNum: playerNum, opponent, lockedSide: (state.choices && state.choices[playerNum]) || null });
    } else if (state.toss) {
      showTossResult({ side: state.toss.side, starter: state.toss.starter, meNum: playerNum, starterName: opponent && opponent.pseudo, oppName: "Adversaire" });
    }
  }

  function onServerGameState(msg) {
    if (!msg.state) return;
    const mode = msg.state.mode || "online";
    Fanorona.applyServerState(msg.state, {
      mode: mode === "ai" ? "ai" : (mode === "defi" ? "defi" : "online"),
      opponent: msg.state.opponent,
      wager: msg.state.wage || 0,
      playerNum: S.playerNum,
      onMove: (m) => {
        if (m.end) API.send({ type: "end_chain", sessionId: msg.sessionId });
        else API.send({ type: "move", sessionId: msg.sessionId, move: m });
      },
    });
    if (_onStateChoice) _onStateChoice(msg.state);
  }

  /* Réagit aux transitions de phase (choix des faces → jeu) sur l'état serveur. */
  function _onStateChoice(state) {
    const pn = S.playerNum;
    if (state.phase === "choose") {
      const myChoice = state.choices ? state.choices[pn] : null;
      openChooseSide({ mode: state.mode || "online", sessionId: S.currentSession, meNum: pn, opponent: state.opponent, lockedSide: myChoice });
    } else if (state.phase === "play" && state.toss) {
      closeChooseModal();
      showTossResult({ side: state.toss.side, starter: state.toss.starter, meNum: pn, starterName: state.opponent && state.opponent.pseudo, oppName: "Adversaire" });
    }
  }

  function onServerGameEnd(msg) {
    const r = msg.result;
    const won = r.winner === S.playerNum;
    const delta = r.delta || 0;
    const gain = r.gain || 0;
    S.currentSession = null;
    S.matchmaking = false;
    if (Fanorona && Fanorona.quit) Fanorona.quit(); // purge le plateau local terminé
    updateResumeBanner();
    const reasonTxt = { capture: "par capture totale", abandon: "par abandon", temps: "au temps", blocage: "par blocage" }[r.reason] || "";
    showModal(`
      <div class="result-banner" style="position:relative;">
        <div class="rb-ico">${won ? "🏆" : "💥"}</div>
        <h2 style="color:${won ? "var(--brand-2)" : "#ffb4b7"};">${won ? "Victoire" : "Défaite"} ${reasonTxt}</h2>
        <p class="muted small">${r.mode === "ai" ? "Entraînement — aucun impact Elo ni wallet" : `contre ${r.opponent} · ${r.moves} coups`}</p>
      </div>
      <div class="result-stats">
        <div class="stat-cell"><div class="v ${delta >= 0 ? "pos" : "neg"}">${r.mode === "ai" ? "—" : (delta >= 0 ? "+" : "") + delta}</div><div class="k">Points Elo</div></div>
        <div class="stat-cell"><div class="v amber">${gain ? "+" + fmtAr(gain) : "—"}</div><div class="k">Gains</div></div>
        <div class="stat-cell"><div class="v">${r.meLeft} / 22</div><div class="k">Pions restants</div></div>
      </div>
      <div class="m-foot">
        <button class="btn" id="res-back">Retour aux jeux</button>
      </div>
    `, "", false);
    document.getElementById("res-back").onclick = () => { closeModal(); go("play"); };
    refreshUser();
  }

  /* Fin de partie locale (mode IA) */
  function onLocalGameEnd(res) {
    const won = res.winner === 1;
    const reasonTxt = { capture: "par capture totale", abandon: "par abandon", temps: "au temps", blocage: "par blocage" }[res.reason] || "";
    showModal(`
      <div class="result-banner" style="position:relative;">
        <div class="rb-ico">${won ? "🏆" : "💥"}</div>
        <h2 style="color:${won ? "var(--brand-2)" : "#ffb4b7"};">${won ? "Victoire" : "Défaite"} ${reasonTxt}</h2>
        <p class="muted small">Entraînement — aucun impact Elo ni wallet (PRD §2.5)</p>
      </div>
      <div class="result-stats">
        <div class="stat-cell"><div class="v">—</div><div class="k">Points Elo</div></div>
        <div class="stat-cell"><div class="v">—</div><div class="k">Gains</div></div>
        <div class="stat-cell"><div class="v">${res.meLeft} / 22</div><div class="k">Pions restants</div></div>
      </div>
      <div class="m-foot"><button class="btn primary" id="ai-res-back">Retour aux jeux</button></div>
    `, "", false);
    document.getElementById("ai-res-back").onclick = () => { closeModal(); go("play"); };
    updateResumeBanner();
  }

  /* ------------------ MATCH ------------------ */
  function renderMatch() {
    const actifs = S.tournaments.filter((t) => t.status === "inscriptions");
    const finis = S.tournaments.filter((t) => t.status === "termine");
    const fmtName = (id) => FORMATS.find((f) => f.id === id)?.name || id;
    const card = (t) => {
      const full = t.registered.length >= t.maxPlayers;
      const rankOk = RANKS.findIndex((r2) => r2.name === rankFor(S.elo).name) >= RANKS.findIndex((r2) => r2.name === t.minRank);
      return `
      <div class="tn-card">
        <div class="tn-head"><h3>${t.name}</h3><span class="pill amber">${t.status === "termine" ? "Terminé" : "Inscriptions"}</span></div>
        ${t.sponsor ? `<span class="pill blue" style="align-self:flex-start;">🎖️ ${t.sponsor}</span>` : ""}
        <div class="tn-rows">
          <div class="row"><span>Jeu · Format</span><span>${t.game} · ${fmtName(t.format)}</span></div>
          <div class="row"><span>Mise (rembours. top 3)</span><span>${fmtAr(t.entry)}</span></div>
          <div class="row"><span>Pool cashprice</span><span class="pos">${fmtAr(t.entry * t.maxPlayers)}</span></div>
          <div class="row"><span>Rang minimum</span><span>${t.minRank}${rankOk ? "" : " 🔒"}</span></div>
          <div class="row"><span>Début</span><span class="countdown" data-cd="${t.id}">${countdownParts(t.startsInSec)}</span></div>
        </div>
        <div class="progress"><i style="width:${(t.registered.length / t.maxPlayers) * 100}%"></i></div>
        <div class="small muted" style="text-align:right;">${t.registered.length}/${t.maxPlayers} joueurs ${S.myRegs[t.id] ? '· <span class="pos">✓ inscrit</span>' : ""}</div>
        <div class="tn-foot">
          <button class="btn" onclick="App.tournamentDetail('${t.id}')">Détail & bracket</button>
          ${S.myRegs[t.id]
            ? `<button class="btn warn" onclick="App.simulateTournament('${t.id}')">▶ Simuler</button>`
            : `<button class="btn primary ${full || !rankOk ? "disabled" : ""}" onclick="App.joinTournament('${t.id}')">S'inscrire</button>`}
        </div>
      </div>`;
    };
    document.getElementById("match-root").innerHTML = `
      <div class="panel" style="border-left:3px solid var(--amber);">
        <b style="color:var(--text-strong);">Matchs & spectateurs</b>
        <p class="small muted" style="margin-top:4px;">Défis entre amis, tournois et matchmaking en cours. Jouez en ligne en temps réel.</p>
      </div>
      <div class="panel-title" style="margin-top:18px;">🔴 Matchs en direct — vos connaissances</div>
      <div class="panel pad-lg" style="margin-bottom:6px;" id="live-games-root">
        <p class="muted small">Chargement des matchs en direct…</p>
      </div>
      <div class="panel-title" style="margin-top:18px;">Défis entre amis</div>
      <div class="panel pad-lg" style="margin-bottom:6px;">
        <b style="color:var(--text-strong);">Défis reçus (${S.defis.length})</b>
        <div class="defis-home" style="margin-top:10px;">
          ${S.defis.length ? S.defis.map((d) => `
            <div class="defi-row">
              <span class="avatar" style="width:32px;height:32px;font-size:11px;cursor:default;">${d.from.slice(0, 2).toUpperCase()}</span>
              <div class="d-info"><div class="d-name"><b>${d.from}</b> <span class="muted small">· ${d.fromElo} Elo · ${d.format}</span></div><div class="d-sub small muted">Mise ${fmtAr(d.wager)} · gain ${fmtAr(d.wager * 2 * 0.9)}</div></div>
              <div class="d-actions">
                <button class="btn primary mini-btn" onclick="App.acceptDefi('${d.id}')">Accepter</button>
                <button class="btn danger mini-btn" onclick="App.refuseDefi('${d.id}')">Refuser</button>
              </div>
            </div>`).join("") : '<p class="muted">Aucun défi pour le moment.</p>'}
        </div>
      </div>
      <div class="panel pad-lg">
        <b style="color:var(--text-strong);">Joueurs en ligne (${S.onlineUsers.length})</b>
        <div class="live-grid" style="margin-top:10px;">
          ${S.onlineUsers.length ? S.onlineUsers.map((u) => `
            <div class="live-card">
              <div class="live-head"><span class="live-dot"></span><b class="link-pseudo" onclick="App.openProfileById(${u.id})" style="cursor:pointer;" title="Voir le profil">${u.pseudo}</b><span class="pill green" style="margin-left:auto;">En ligne</span></div>
              <div class="live-foot">
                <button class="btn primary mini-btn" onclick="App.challengeUser('${u.pseudo}')">⚔️ Défier</button>
                <button class="btn mini-btn" onclick="App.openChatPopup('${u.pseudo}')">💬 Message</button>
              </div>
            </div>`).join("") : '<p class="muted">Aucun joueur en ligne pour le moment. Lancez une partie classée pour trouver un adversaire.</p>'}
        </div>
      </div>
      <div class="panel-title" style="margin-top:18px;">Tournois</div>
      <div class="panel" style="border-left:3px solid var(--amber); margin-bottom:12px;">
        <b style="color:var(--text-strong);">Modèle de cashprice (PRD §4.3)</b>
        <p class="small muted" style="margin-top:4px;">Mise remboursée aux 3 premières places · gain net réparti <b class="mono">50% / 25% / 0%</b> · commission D-aôna 25%.</p>
      </div>
      <div class="panel-title" style="margin-top:8px;">Tournois à venir (${actifs.length})</div>
      <div class="tournament-grid">${actifs.map(card).join("") || '<p class="muted">Aucun tournoi ouvert.</p>'}</div>
      <div class="panel-title" style="margin-top:18px;">Terminés récemment</div>
      <div class="tournament-grid">${finis.map(card).join("") || '<p class="muted small">Aucun.</p>'}</div>`;
    loadLiveGames();
  }

  /* ------------------ SPECTATEUR (matchs en direct) ------------------ */
  /* Liste les parties en cours des amis et contacts, et permet de les
     regarder en direct sur le plateau (lecture seule, état serveur). */
  async function loadLiveGames() {
    const root = document.getElementById("live-games-root");
    if (!root) return;
    const fmtName = (id) => (FORMATS.find((f) => f.id === id) || {}).name || id;
    try {
      const d = await API.request("/api/games/live");
      const live = d.live || [];
      if (!live.length) {
        root.innerHTML = '<p class="muted">Aucun match en cours parmi vos amis et contacts pour le moment.</p>';
        return;
      }
      root.innerHTML = live.map((g) => `
        <div class="defi-row" style="border-bottom:.5px solid var(--line); padding:10px 0;">
          <span class="avatar" style="width:32px;height:32px;font-size:11px;cursor:pointer;" onclick="App.openProfileById(${g.player1.id})" title="Profil de ${g.player1.pseudo}">${g.player1.pseudo.slice(0, 2).toUpperCase()}</span>
          <div class="d-info">
            <div class="d-name">
              <b class="link-pseudo" style="cursor:pointer;" onclick="App.openProfileById(${g.player1.id})">${g.player1.pseudo}</b>
              <span class="muted small">${g.player1.elo}</span>
              <span class="muted">vs</span>
              <b class="link-pseudo" style="cursor:pointer;" onclick="App.openProfileById(${g.player2.id})">${g.player2.pseudo}</b>
              <span class="muted small">${g.player2.elo}</span>
            </div>
            <div class="d-sub small muted">${fmtName(g.format)} · ${g.mode === "defi" ? "Défi" + (g.wager ? " · mise " + fmtAr(g.wager) : "") : "Partie classée"} · ${g.moves} coup(s)</div>
          </div>
          <div class="d-actions">
            <button class="btn primary mini-btn" onclick="App.spectate('${g.sessionId}')">👁 Regarder</button>
          </div>
        </div>`).join("");
    } catch (e) {
      root.innerHTML = '<p class="muted small">Impossible de charger les matchs en direct.</p>';
    }
  }

  function spectate(sessionId) {
    if (hasActiveGame()) return toast("Terminez d'abord votre propre partie avant de regarder un match.", "warn");
    if (spectatingId === sessionId) return go("board");
    if (spectatingId) API.send({ type: "unspectate", sessionId: spectatingId });
    spectatingId = sessionId;
    API.send({ type: "spectate", sessionId });
    go("board");
  }

  function stopSpectating() {
    if (!spectatingId) return;
    API.send({ type: "unspectate", sessionId: spectatingId });
    spectatingId = null;
    if (Fanorona && Fanorona.quit) Fanorona.quit();
  }

  function onSpectateState(msg) {
    if (msg.sessionId !== spectatingId || !msg.state) return;
    const st = msg.state;
    const p1 = st.player1 || { pseudo: "Joueur 1", elo: 1100 };
    const p2 = st.player2 || { pseudo: "Joueur 2", elo: 1100 };
    document.getElementById("hud-me-name").textContent = p1.pseudo;
    document.getElementById("hud-me-elo").textContent = p1.elo + " Elo";
    document.getElementById("hud-me-avatar").textContent = p1.pseudo.slice(0, 2).toUpperCase();
    document.getElementById("me-rank-mini").textContent = rankFor(p1.elo).name;
    Fanorona.applyServerState(st, {
      mode: st.mode === "defi" ? "defi" : "online",
      opponent: p2, wager: st.wage || 0, playerNum: 1,
      spectator: true, onMove: () => {},
    });
  }

  function onSpectateEnd(msg) {
    if (msg.sessionId !== spectatingId) return;
    spectatingId = null;
    if (Fanorona && Fanorona.quit) Fanorona.quit();
    const reasonTxt = { capture: "par capture totale", abandon: "par abandon", temps: "au temps", blocage: "par blocage" }[msg.reason] || "";
    showModal(`
      <div class="result-banner">
        <div class="rb-ico">🏁</div>
        <h2>Match terminé</h2>
        <p class="muted small"><b>${msg.winnerPseudo || ""}</b> remporte la partie ${reasonTxt}</p>
      </div>
      <div class="m-foot"><button class="btn primary" onclick="App.closeModal(); App.go('match');">Retour aux matchs</button></div>
    `, "", false);
  }

  function challengeUser(pseudo) {
    playCfg.mode = "defi"; playCfg.friend = pseudo; playCfg.wager = 500;
    playStep = 2;
    go("play");
    toast("Configuré pour défier " + pseudo + " (mise minimale 500 Ar)");
  }
  function openChat(pseudo) {
    chatWith = pseudo;
    go("chat");
  }

  /* ------------------ TOURNOIS ------------------ */
  function tournamentDetail(id) {
    const t = S.tournaments.find((x) => x.id === id);
    if (!t) return;
    const pool = t.entry * t.maxPlayers;
    const net = pool - 3 * t.entry;
    showModal(`
      <button class="btn ghost mini-btn m-close" onclick="App.closeModal()">✕</button>
      <h2>${t.name}</h2>
      <p class="m-sub">${t.game} · format ${FORMATS.find((f) => f.id === t.format)?.name || t.format} · elimination directe</p>
      <div class="chips" style="margin-bottom:12px;">
        <span class="pill amber">Pool : ${fmtAr(pool)}</span>
        <span class="pill">Mise : ${fmtAr(t.entry)}</span>
        <span class="pill">Rang min. : ${t.minRank}</span>
        <span class="pill ${t.status === "termine" ? "" : "green"}">${t.status === "termine" ? "Terminé" : "Début : " + countdownParts(t.startsInSec)}</span>
        ${t.sponsor ? `<span class="pill blue">🎖️ ${t.sponsor}</span>` : ""}
      </div>
      <div class="panel pad-lg">
        <div class="panel-title">Inscrits (${t.registered.length}/${t.maxPlayers})</div>
        ${t.registered.length ? t.registered.map((p) => `<div class="lb-row ${p === S.pseudo ? "me" : ""}"><span class="rk">•</span><span class="ps">${p}</span></div>`).join("") : '<p class="muted">Aucun inscrit.</p>'}
      </div>
      <div class="panel-title" style="margin-top:6px;">Répartition du cashprice (PRD §4.3)</div>
      <table class="prize-table">
        <tr><th>Place</th><th>Mise remboursée</th><th>Part du gain net (${fmtAr(net)})</th><th>Total reversé</th></tr>
        <tr><td>🥇 1re place</td><td>${fmtAr(t.entry)}</td><td>50% = ${fmtAr(net * 0.5)}</td><td class="pos">${fmtAr(t.entry + net * 0.5)}</td></tr>
        <tr><td>🥈 2e place</td><td>${fmtAr(t.entry)}</td><td>25% = ${fmtAr(net * 0.25)}</td><td>${fmtAr(t.entry + net * 0.25)}</td></tr>
        <tr><td>🥉 3e place</td><td>${fmtAr(t.entry)}</td><td>0%</td><td>${fmtAr(t.entry)}</td></tr>
        <tr><td>🏦 D-aôna (commission)</td><td>—</td><td>25% = ${fmtAr(net * 0.25)}</td><td class="amber">${fmtAr(net * 0.25)}</td></tr>
      </table>
      <div class="m-foot">
        ${t.status !== "termine" && !S.myRegs[t.id]
          ? `<button class="btn primary" onclick="App.joinTournament('${t.id}')">S'inscrire — ${fmtAr(t.entry)}</button>` : ""}
        ${t.status !== "termine" && S.myRegs[t.id]
          ? `<button class="btn warn" onclick="App.simulateTournament('${t.id}')">▶ Simuler ce tournoi</button>` : ""}
        <button class="btn ghost" onclick="App.closeModal()">Fermer</button>
      </div>
    `, "lg");
  }

  async function joinTournament(id) {
    const t = S.tournaments.find((x) => x.id === id);
    if (!t || S.myRegs[id]) return;
    const rankOk = RANKS.findIndex((r2) => r2.name === rankFor(S.elo).name) >= RANKS.findIndex((r2) => r2.name === t.minRank);
    if (!rankOk) return toast(`Rang ${t.minRank} requis pour ce tournoi.`, "warn");
    if (t.registered.length >= t.maxPlayers) return toast("Tournoi complet.", "warn");
    if (S.balance < t.entry) return toast(`Solde insuffisant — déposez d'abord ${fmtAr(t.entry - S.balance)}.`, "warn");
    kycRequired(async () => {
      try {
        await API.request("/api/tournaments/join", "POST", { tournamentId: parseInt(id) });
        toast(`Inscription confirmée à ${t.name} — bonne chance ! 🍀`);
        closeModal();
        await refreshTournaments(); await refreshUser();
        renderMatch(); updateTopbar();
      } catch (e) { toast(e.message, "error"); }
    });
  }

  function simulateTournament(id) {
    API.send({ type: "simulate_tournament", tournamentId: parseInt(id) });
    closeModal();
    showModal(`
      <h2>Tournoi en cours…</h2>
      <p class="m-sub">Simulation — arbitrage serveur.</p>
      <div class="mm-spinner"><div class="mm-orbit"><i></i><i></i><i></i></div>
      <p class="mono small amber" id="tn-progress">Démarrage…</p></div>
    `, "", true);
  }

  /* ------------------ CLASSEMENT ------------------ */
  function renderRanks() {
    const r = rankFor(S.elo);
    const meNational = S.leaderboard.find((p) => p.me);
    const meRank = meNational?.rank || "—";
    const top3 = S.leaderboard.slice(0, 3);
    const medalFor = (rank) => rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : "";
    const badgeChip = (b) => b
      ? `<span class="badge-chip" style="color:${b.color}; border-color:${b.color}66; background:${b.color}14;" title="Badge ${b.name}"><span class="bi">${b.icon}</span>${b.name}</span>`
      : "";
    /* Échappement pour attributs HTML (protège contre apostrophes/guillemets dans les pseudos) */
    const escAttr = (s) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
    const avatarHtml = (p, size = 36, link = true) => {
      const ini = (p.pseudo || "?").slice(0, 2).toUpperCase();
      const click = link && p.id && !p.me ? `onclick="App.openProfileById(${p.id})" style="cursor:pointer;" title="Voir le profil"` : "";
      if (p.avatar) return `<span class="avatar has-photo" ${click} style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px;${link && p.id ? "cursor:pointer;" : ""}"><img src="${escAttr(p.avatar)}" alt="${escAttr(p.pseudo)}"></span>`;
      return `<span class="avatar" ${click} style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px;">${ini}</span>`;
    };

    let list, headLabel;
    if (rankScope === "province") {
      // Classement provincial : recalculé indépendamment du rang national
      list = S.leaderboard
        .filter((p) => (p.province || "") === rankProvince)
        .map((p, i) => ({ ...p, rank: i + 1 }));
      headLabel = `Rang provincial — ${rankProvince}`;
    } else {
      list = S.leaderboard;
      headLabel = "Rang national";
    }
    // Barre de recherche : filtre par pseudo (insensible à la casse)
    const q = (rankSearch || "").trim().toLowerCase();
    if (q) list = list.filter((p) => (p.pseudo || "").toLowerCase().includes(q));

    document.getElementById("ranks-root").innerHTML = `
      <div class="rank-layout">
        <div class="side-stack">
          <div class="panel">
            <div class="panel-title">Votre rang — Saison 2</div>
            <div class="rank-card">
              <span class="rank-badge" style="background:${r.color};">◆</span>
              <div><b style="color:var(--text-strong); font-size:16px;">${r.name}</b><div class="small muted mono">${S.elo} Elo · #${meRank} national</div></div>
            </div>
            ${meNational?.badge ? `<div style="margin:4px 0 8px;">${badgeChip(meNational.badge)}</div>` : ""}
            <div class="rank-prog"><i style="width:${rankProgress(S.elo)}%"></i></div>
            <hr class="divider">
            <ul class="rules-list" style="font-size:12px;">
              <li>Calibration : aucune perte de rang sur les 10 premières parties</li>
              <li>Inactivité 30 j → −30 Elo / mois</li>
              <li>Saison de 6 mois : reset partiel le 1ᵉʳ jan. / 1ᵉʳ juil.</li>
            </ul>
          </div>
          <div class="panel">
            <div class="panel-title">Podium national</div>
            <div class="podium">
              ${[top3[1], top3[0], top3[2]].map((p, i) => `
                <div class="pod ${i === 1 ? "p1" : i === 0 ? "p2" : "p3"}">
                  <div class="crown">${i === 1 ? "🥇" : i === 0 ? "🥈" : "🥉"}</div>
                  <div class="pn">${p ? p.pseudo : "—"}</div>
                  <div class="pe">${p ? p.elo : ""}</div>
                </div>`).join("")}
            </div>
          </div>
        </div>
        <div class="panel">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
            <div class="chips">
              ${[["national", "🇲🇬 National"], ["province", "📍 Province"]].map(([id, l]) =>
                `<button class="chip ${rankScope === id ? "on" : ""}" data-scope="${id}">${l}</button>`).join("")}
            </div>
            <span class="small muted">${headLabel}</span>
          </div>
          <div class="rank-toolbar">
            <div class="rank-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              <input type="text" id="rank-search" placeholder="Rechercher un joueur…" maxlength="20" value="${rankSearch.replace(/"/g, "&quot;")}">
              ${rankSearch ? `<button class="rs-clear" id="rank-search-clear" title="Effacer">✕</button>` : ""}
            </div>
            ${rankScope === "province" ? `
              <select class="province-select" id="province-select" title="Filtrer par province">
                ${PROVINCES.map((pv) => `<option value="${pv}" ${rankProvince === pv ? "selected" : ""}>${pv}</option>`).join("")}
              </select>` : ""}
          </div>
          <div class="rank-row head"><span>#</span><span>Joueur</span><span>Elo</span><span title="Médaille">🏅</span></div>
          ${list.length ? list.map((p) => `
            <div class="rank-row ${p.me ? "me" : ""}">
              <span class="mono muted">${p.rank}</span>
              <span class="rank-who">
                <span class="who-line">
                  ${avatarHtml(p, 32)}
                  ${p.me ? `<span class="who-pseudo">${p.pseudo}</span>` : `<span class="who-pseudo link-pseudo" onclick="App.openProfileById(${p.id})" style="cursor:pointer;" title="Voir le profil">${p.pseudo}</span>`}
                  ${rankScope === "national" ? badgeChip(p.badge) : ""}
                </span>
                <span class="who-province">📍 ${p.province || "—"}</span>
              </span>
              <span class="elo" style="color:${rankFor(p.elo).color}">${p.elo}</span>
              <span class="medal">${medalFor(p.rank)}</span>
            </div>`).join("") : `<p class="muted" style="padding:14px 4px;">${rankSearch ? `Aucun joueur ne correspond à « ${rankSearch} ».` : "Aucun joueur classé dans cette province pour le moment."}</p>`}
        </div>
      </div>`;
    document.querySelectorAll("#ranks-root [data-scope]").forEach((c) => c.onclick = () => { rankScope = c.dataset.scope; renderRanks(); });
    const provSel = document.getElementById("province-select");
    if (provSel) provSel.onchange = () => { rankProvince = provSel.value; renderRanks(); };
    // Barre de recherche : filtrage instantané (avec restauration du curseur)
    const rs = document.getElementById("rank-search");
    if (rs) {
      rs.oninput = () => {
        const pos = rs.selectionStart;
        rankSearch = rs.value;
        renderRanks();
        const nrs = document.getElementById("rank-search");
        if (nrs) { nrs.focus(); try { nrs.setSelectionRange(pos, pos); } catch (e) {} }
      };
      if (rankSearch) { rs.focus(); try { rs.setSelectionRange(rs.value.length, rs.value.length); } catch (e) {} }
    }
    const rc = document.getElementById("rank-search-clear");
    if (rc) rc.onclick = () => { rankSearch = ""; renderRanks(); };
  }

  /* ------------------ WALLET ------------------ */
  function renderWallet() {
    const txIcon = (t) => {
      if (/Dépôt/.test(t)) return "⬇️";
      if (/Retrait/.test(t)) return "⬆️";
      if (/Cashprice|Gain/.test(t)) return "🏆";
      if (/Mise/.test(t)) return "🎟️";
      if (/Bonus/.test(t)) return "🎁";
      if (/skin/i.test(t)) return "🎨";
      return "💸";
    };
    const available = Math.max(0, S.balance - S.bonusLock);
    document.getElementById("wallet-root").innerHTML = `
      <div class="wallet-layout">
        <div class="side-stack">
          <div class="balance-card">
            <div class="lbl">Solde disponible</div>
            <div class="amount">${fmtAr(available)}</div>
            <div class="btc">Portefeuille interne D-aôna · Ariary (Ar)</div>
            ${S.bonusLock ? `<div class="small amber" style="margin-top:6px;">dont ${fmtAr(S.bonusLock)} de bonus (non retirable)</div>` : ""}
            <div class="balance-actions">
              <button class="btn primary" onclick="App.depositFlow()">＋ Déposer</button>
              <button class="btn" onclick="App.withdrawFlow()">↗ Retirer</button>
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">Règles du wallet (PRD §4)</div>
            <ul class="rules-list">
              <li>0% de commission sur les transactions internes (mises, défis)</li>
              <li>Commission de 25% uniquement à la distribution des cashprices</li>
              <li>Retrait libre, min. 1 000 Ar · max. 500 000 Ar / jour</li>
              <li>KYC (photo CIN) obligatoire avant toute transaction réelle</li>
            </ul>
            <button class="btn ghost block" style="margin-top:8px; ${S.kyc ? "display:none" : ""}" onclick="App.kycRequired(()=>{})">🪪 Vérifier mon identité</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">Historique des transactions</div>
          ${S.txs.length ? S.txs.map((tx) => `
            <div class="tx-row">
              <span class="tx-ic" style="background:${tx.dir === "in" ? "var(--green-soft)" : "var(--red-soft)"}">${txIcon(tx.label)}</span>
              <div class="tx-info"><div class="t">${tx.label}</div><div class="d">${(tx.created_at || "").slice(0, 16)}</div></div>
              <span class="tx-amt ${tx.dir === "in" ? "pos" : "neg"}">${tx.dir === "in" ? "+" : "−"}${fmtAr(tx.amount)}</span>
            </div>`).join("") : '<p class="muted">Aucune transaction pour le moment.</p>'}
        </div>
      </div>`;
  }

  /* ------------------ PROFIL ------------------ */
  function renderProfile() {
    const r = rankFor(S.elo);
    const me = S.leaderboard.find((p) => p.me);
    const myBadge = me?.badge;
    document.getElementById("profile-root").innerHTML = `
      <div class="profile-layout">
        <div class="side-stack">
          <div class="panel profile-card">
            ${(() => { const avSize = parseInt(localStorage.getItem("daona_avatar_size") || "84"); return `
            <div class="big-avatar" id="profile-avatar" style="position:relative; cursor:pointer; width:${avSize}px; height:${avSize}px; font-size:${Math.round(avSize/3)}px;" title="Cliquer pour changer la photo">
              ${S.avatar ? `<img src="${S.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : S.pseudo.slice(0, 2).toUpperCase()}
              <input type="file" id="avatar-input" accept="image/*" style="display:none;">
            </div>
            <div style="display:flex; gap:6px; justify-content:center; align-items:center; margin:2px 0 8px;" title="Taille de la photo">
              <span class="small muted">Taille photo :</span>
              ${[[64, "S"], [84, "M"], [110, "L"]].map(([sz, lab]) => `<button class="chip ${avSize === sz ? "on" : ""}" data-avsize="${sz}" style="min-width:34px; padding:4px 8px;">${lab}</button>`).join("")}
            </div>`; })()}
            <h2>${S.pseudo}</h2>
            <p class="small muted">ID joueur #${S.id || "—"} · 📍 ${me?.province || "—"} · membre depuis août 2026</p>
            <div style="display:flex; gap:8px; justify-content:center; margin:10px 0 4px; flex-wrap:wrap;">
              <span class="pill" style="color:${r.color}; border-color:${r.color}55;">◆ ${r.name}</span>
              <span class="pill amber mono">${S.elo} Elo</span>
            </div>
            ${myBadge ? `<div style="margin-top:6px;"><span class="badge-chip" style="color:${myBadge.color}; border-color:${myBadge.color}66; background:${myBadge.color}14;" title="Badge national"><span class="bi">${myBadge.icon}</span>${myBadge.name} <span class="muted mono" style="font-weight:400;">#${me.rank}</span></span></div>` : ""}
            <div class="stat-grid" style="text-align:center;">
              <div class="stat-cell"><div class="v">${S.wins + S.losses}</div><div class="k">Parties</div></div>
              <div class="stat-cell"><div class="v pos">${S.wins}</div><div class="k">Victoires</div></div>
              <div class="stat-cell"><div class="v neg">${S.losses}</div><div class="k">Défaites</div></div>
              <div class="stat-cell"><div class="v mono">${fmtAr(S.balance)}</div><div class="k">Solde wallet</div></div>
            </div>
          </div>
          <div class="panel ${S.kyc ? "kyc-card ok" : "kyc-card"}">
            <div class="panel-title">Vérification KYC</div>
            ${S.kyc
              ? `<div class="kyc-step"><span class="n" style="background:var(--brand-dark);color:var(--brand-2);">✓</span> CIN vérifiée</div>
                 <div class="kyc-step"><span class="n" style="background:var(--brand-dark);color:var(--brand-2);">✓</span> Transactions réelles débloquées</div>`
              : `<div class="kyc-step"><span class="n">1</span> Photographier la CIN (recto)</div>
                 <div class="kyc-step"><span class="n">2</span> Vérification par l'équipe (< 24 h)</div>
                 <div class="kyc-step"><span class="n">3</span> Dépôts, retraits, tournois et défis débloqués</div>
                 <button class="btn primary block" style="margin-top:10px;" onclick="App.kycRequired(()=>{})">Vérifier mon identité</button>`}
          </div>
        </div>
        <div class="side-stack">
          <div class="panel">
            <div class="panel-title">Boutique — Skins (PRD §2.7)</div>
            <div class="skins-grid">
              ${SKINS_CATALOG.map((sk) => {
                const owned = S.skins.owned.includes(sk.id);
                const equipped = S.skins.equipped[sk.kind === "pions" ? "pions" : sk.kind === "plateau" ? "plateau" : "effet"] === sk.id;
                return `
                <div class="skin-card ${equipped ? "equipped" : ""}">
                  <div class="skin-preview">${skinPreview(sk)}</div>
                  <h4>${sk.name} <span class="muted small">· ${sk.kind}</span></h4>
                  <p>${sk.desc}</p>
                  <div class="sk-foot">
                    ${sk.price ? `<span class="mono amber small">${fmtAr(sk.price)}</span>` : '<span class="small pos">Gratuit</span>'}
                    ${equipped
                      ? '<span class="pill green">Équipé</span>'
                      : owned
                        ? `<button class="btn mini-btn" onclick="App.equipSkin('${sk.id}')">Équiper</button>`
                        : `<button class="btn mini-btn primary" onclick="App.buySkin('${sk.id}')">Acheter</button>`}
                  </div>
                </div>`;
              }).join("")}
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">Paramètres</div>
            ${[["notifPush", "Notifications push"], ["notifTournoi", "Rappels de tournois"], ["son", "Sons du plateau"]].map(([k, l]) => `
              <div class="setting-row"><span>${l}</span><span class="switch ${S.settings[k] ? "on" : ""}" data-set="${k}"></span></div>`).join("")}
            <div style="display:flex; gap:9px; margin-top:12px; flex-wrap:wrap;">
              <button class="btn" onclick="App.supportModal()">🛟 Service client</button>
              <button class="btn" onclick="App.copyLink(location.origin, 'Lien du serveur copié — partagez-le à vos amis')">🔗 Partager le lien</button>
              <button class="btn danger" onclick="App.logout()">Déconnexion</button>
            </div>
          </div>
        </div>
      </div>`;
    document.querySelectorAll("#profile-root .switch").forEach((sw) => sw.onclick = () => {
      const k = sw.dataset.set; S.settings[k] = !S.settings[k]; sw.classList.toggle("on", S.settings[k]);
    });
    // Choix de la taille de la photo de profil
    document.querySelectorAll("#profile-root [data-avsize]").forEach((c) => c.onclick = () => {
      try { localStorage.setItem("daona_avatar_size", c.dataset.avsize); } catch (e) {}
      renderProfile();
    });
    // Upload photo de profil
    const av = document.getElementById("profile-avatar");
    const avIn = document.getElementById("avatar-input");
    if (av && avIn) {
      av.onclick = () => avIn.click();
      avIn.onchange = async () => {
        const f = avIn.files[0];
        avIn.value = "";
        if (!f) return;
        try {
          toast("Traitement de la photo…");
          const cropped = await processAvatarFile(f);   // crop carré centré + resize 256px
          const d = await API.request("/api/user/avatar", "POST", { avatar: cropped });
          S.avatar = d.avatar;
          toast("Photo de profil mise à jour ✓");
          renderProfile(); updateTopbar();
        } catch (e) { toast(e.message || "Erreur lors de l'envoi", "error"); }
      };
    }
  }

  function skinPreview(sk) {
    if (sk.id === "pions-emeraude") return '<span class="demo-pieces"><span class="demo-piece" style="background:radial-gradient(circle at 32% 28%,#d8ffe9,#35c99a 55%,#0f6b4c)"></span><span class="demo-piece" style="background:radial-gradient(circle at 32% 28%,#4a4257,#2a2438 55%,#141020)"></span></span>';
    if (sk.id === "pions-obsidienne") return '<span class="demo-pieces"><span class="demo-piece" style="background:radial-gradient(circle at 32% 28%,#f7ead0,#d9b988 55%,#9c7a4c)"></span><span class="demo-piece" style="background:radial-gradient(circle at 32% 28%,#6b4a57,#33192b 55%,#12060f)"></span></span>';
    if (sk.kind === "plateau") return '<span style="font-size:22px;">🌌</span>';
    if (sk.id === "trace-emeraude") return '<span style="font-size:22px;">✨</span>';
    if (sk.id === "anim-flamme") return '<span style="font-size:22px;">🔥</span>';
    return '<span class="demo-pieces"><span class="demo-piece" style="background:radial-gradient(circle at 32% 28%,#f7ead0,#d9b988 55%,#9c7a4c)"></span><span class="demo-piece" style="background:radial-gradient(circle at 32% 28%,#4a4257,#2a2438 55%,#141020)"></span></span>';
  }

  async function buySkin(id) {
    const sk = SKINS_CATALOG.find((s) => s.id === id);
    try {
      const d = await API.request("/api/skins/buy", "POST", { skinId: id });
      S.balance = d.balance;
      await refreshSkins();
      toast(`Skin « ${sk.name} » acheté !`);
      renderProfile(); updateTopbar();
    } catch (e) { toast(e.message, "error"); }
  }
  async function equipSkin(id) {
    const sk = SKINS_CATALOG.find((s) => s.id === id);
    try {
      await API.request("/api/skins/equip", "POST", { skinId: id, kind: sk.kind });
      await refreshSkins();
      applySkins();
      toast(`« ${sk.name} » équipé — visible sur votre prochain plateau.`);
      renderProfile();
    } catch (e) { toast(e.message, "error"); }
  }
  function applySkins() {
    const stage = document.getElementById("board-stage");
    const board = document.getElementById("fanorona-board");
    if (!stage || !board) return;
    stage.classList.toggle("skin-plateau-anosy", S.skins.equipped.plateau === "plateau-anosy");
    stage.classList.toggle("fx-trace", S.skins.equipped.effet === "trace-emeraude");
    board.classList.toggle("skin-pions-emeraude", S.skins.equipped.pions === "pions-emeraude");
    board.classList.toggle("skin-pions-obsidienne", S.skins.equipped.pions === "pions-obsidienne");
  }

  function logout() {
    API.setToken(null);
    location.reload();
  }

  /* ------------------ CHAT ------------------ */
  function renderChat() {
    const list = S.contacts.length ? S.contacts.map((c) => c.pseudo) : [];
    if (!chatWith && list.length) chatWith = list[0];
    if (!chatWith) {
      document.getElementById("chat-root").innerHTML = `<div class="panel pad-lg" style="text-align:center;"><b style="color:var(--text-strong);">Aucun contact</b><p class="small muted">Échangez en match et vos contacts apparaîtront ici.</p></div>`;
      return;
    }
    const thread = S.chatThreads[chatWith] || [];
    document.getElementById("chat-root").innerHTML = `
      <div class="chat-layout">
        <div class="panel chat-list">
          <div class="panel-title">Contacts</div>
          ${list.map((n) => {
            const lastMsgs = S.chatThreads[n] || [];
            const last = lastMsgs[lastMsgs.length - 1];
            const online = S.onlineUsers.some((u) => u.pseudo === n);
            return `<div class="chat-contact ${chatWith === n ? "on" : ""}" data-chat="${n}">
              <span class="avatar" style="cursor:default;">${n.slice(0, 2).toUpperCase()}</span>
              <div class="c-info"><div class="c-name">${n}</div><div class="c-prev">${last ? last.text : ""}</div></div>
              <span class="online-dot ${online ? "" : "off"}"></span>
            </div>`;
          }).join("")}
          <p class="small muted" style="margin-top:12px;">🔒 Chat restreint aux joueurs connus — aucune messagerie ouverte (PRD §12).</p>
        </div>
        <div class="panel chat-pane">
          <div class="chat-msgs" id="chat-msgs">
            ${thread.map((m) => `<div class="msg ${m.from}">${m.text}<span class="at">${m.at}</span></div>`).join("")}
          </div>
          <div class="chat-input">
            <input type="text" id="chat-field" placeholder="Écrire à ${chatWith}…">
            <button class="btn primary" id="chat-send">Envoyer</button>
            <button class="btn" id="chat-defi" title="Défier ce contact">⚔️</button>
          </div>
        </div>
      </div>`;
    const msgs = document.getElementById("chat-msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    document.querySelectorAll("#chat-root [data-chat]").forEach((c) => c.onclick = () => { chatWith = c.dataset.chat; renderChat(); });
    const send = () => {
      const f = document.getElementById("chat-field");
      const txt = f.value.trim();
      if (!txt) return;
      sendChatText(chatWith, txt);
      f.value = "";
      renderChat();
    };
    document.getElementById("chat-send").onclick = send;
    document.getElementById("chat-field").onkeydown = (e) => { if (e.key === "Enter") send(); };
    document.getElementById("chat-defi").onclick = () => { playCfg.mode = "defi"; playCfg.friend = chatWith; playCfg.wager = 500; playStep = 2; go("play"); };
  }

  /* ------------------ MESSAGERIE FLOTTANTE (dock) ------------------
     PC  : fenêtres pop-up façon Facebook (chat sans changer d'écran).
     Mobile : encoche à droite, rétractable, qui change de couleur sur message. */
  function sendChatText(toPseudo, txt) {
    API.send({ type: "chat_message", toPseudo, text: txt.slice(0, 500) });
    S.chatThreads[toPseudo] = S.chatThreads[toPseudo] || [];
    S.chatThreads[toPseudo].push({ from: "me", text: txt.replace(/</g, "<"), at: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) });
  }

  function unreadTotal() {
    return Object.values(unreadChats).reduce((a, b) => a + b, 0);
  }

  function updateChatFab() {
    const fab = document.getElementById("chat-fab");
    const badge = document.getElementById("chat-fab-badge");
    if (!fab || !badge) return;
    const n = unreadTotal();
    fab.classList.toggle("has-unread", n > 0);
    badge.classList.toggle("hidden", n <= 0);
    badge.textContent = n > 99 ? "99+" : n;
  }

  function contactOnline(pseudo) {
    return S.onlineUsers.some((u) => u.pseudo === pseudo);
  }

  function renderChatDock() {
    const tray = document.getElementById("chat-tray");
    if (!tray) return;
    let html = "";
    // Fenêtres pop-up ouvertes (max 3 côte à côte, façon Facebook)
    chatPopups.slice(0, 3).forEach((pseudo) => {
      const thread = S.chatThreads[pseudo] || [];
      const unread = unreadChats[pseudo] || 0;
      html += `
        <div class="chat-pop" data-pop="${pseudo}">
          <div class="cp-head" data-pop-head="${pseudo}">
            <span class="avatar" data-pop-profile="${pseudo}" title="Voir le profil">${pseudo.slice(0, 2).toUpperCase()}</span>
            <span class="cp-name" data-pop-profile="${pseudo}">${pseudo}</span>
            ${unread ? `<span class="cp-unread">${unread}</span>` : ""}
            <button class="cp-btn" data-pop-min="${pseudo}" title="Réduire">—</button>
            <button class="cp-btn" data-pop-close="${pseudo}" title="Fermer">✕</button>
          </div>
          <div class="cp-body">
            <div class="cp-msgs" data-pop-msgs="${pseudo}">
              ${thread.length ? thread.map((m) => `<div class="msg ${m.from}">${m.text}<span class="at">${m.at}</span></div>`).join("") : '<p class="small muted" style="text-align:center; margin-top:14px;">Démarrez la conversation 👋</p>'}
            </div>
            <div class="cp-input">
              <input type="text" data-pop-field="${pseudo}" placeholder="Écrire à ${pseudo}…" maxlength="500">
              <button data-pop-send="${pseudo}">Envoyer</button>
            </div>
          </div>
        </div>`;
    });
    // Panneau liste des conversations (fab ouvert)
    if (chatDockOpen) {
      const list = S.contacts.length ? S.contacts.map((c) => c.pseudo) : [];
      html += `
        <div class="chat-panel">
          <div class="cp-title">Messagerie</div>
          ${list.length ? list.map((n) => {
            const lastMsgs = S.chatThreads[n] || [];
            const last = lastMsgs[lastMsgs.length - 1];
            const unread = unreadChats[n] || 0;
            return `<div class="chat-contact" data-dock-chat="${n}">
              <span class="avatar">${n.slice(0, 2).toUpperCase()}</span>
              <div class="c-info"><div class="c-name">${n} ${contactOnline(n) ? '<span class="pill green" style="font-size:9px; padding:1px 6px;">en ligne</span>' : ""}</div><div class="c-prev">${last ? last.text : "Nouvelle conversation"}</div></div>
              ${unread ? `<span class="cp-unread">${unread}</span>` : ""}
            </div>`;
          }).join("") : '<div class="cp-empty">Aucun contact pour le moment.<br>Jouez un match pour rencontrer des joueurs.</div>'}
        </div>`;
    }
    tray.innerHTML = html;

    // Bind fenêtres pop-up
    tray.querySelectorAll("[data-pop-head]").forEach((el) => el.onclick = (e) => {
      if (e.target.closest("[data-pop-min],[data-pop-close],[data-pop-profile]")) return;
      el.closest(".chat-pop").classList.toggle("min");
    });
    tray.querySelectorAll("[data-pop-min]").forEach((el) => el.onclick = () => el.closest(".chat-pop").classList.toggle("min"));
    tray.querySelectorAll("[data-pop-close]").forEach((el) => el.onclick = () => {
      chatPopups = chatPopups.filter((p) => p !== el.dataset.popClose);
      renderChatDock();
    });
    tray.querySelectorAll("[data-pop-profile]").forEach((el) => el.onclick = () => openProfileByPseudo(el.dataset.popProfile));
    tray.querySelectorAll("[data-pop-send]").forEach((el) => el.onclick = () => {
      const pseudo = el.dataset.popSend;
      const f = tray.querySelector(`[data-pop-field="${pseudo}"]`);
      const txt = f.value.trim();
      if (!txt) return;
      sendChatText(pseudo, txt);
      f.value = "";
      renderChatDock();
    });
    tray.querySelectorAll("[data-pop-field]").forEach((el) => el.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      const pseudo = el.dataset.popField;
      const txt = el.value.trim();
      if (!txt) return;
      sendChatText(pseudo, txt);
      el.value = "";
      renderChatDock();
    });
    tray.querySelectorAll("[data-dock-chat]").forEach((el) => el.onclick = () => openChatPopup(el.dataset.dockChat));

    // Scroll en bas des fils ouverts
    tray.querySelectorAll("[data-pop-msgs]").forEach((el) => { el.scrollTop = el.scrollHeight; });
    updateChatFab();
  }

  function openChatPopup(pseudo) {
    if (!chatPopups.includes(pseudo)) chatPopups.unshift(pseudo);
    chatPopups = chatPopups.slice(0, 3);
    chatDockOpen = false;
    delete unreadChats[pseudo];
    renderChatDock();
  }

  function toggleChatDock() {
    chatDockOpen = !chatDockOpen;
    if (chatDockOpen) refreshContacts();
    renderChatDock();
  }

  /* Réception d'un message : badge messagerie uniquement (jamais la cloche). */
  function onIncomingChat(fromPseudo) {
    const onChatScreen = currentRoute() === "chat" && chatWith === fromPseudo;
    const popupOpen = chatPopups.includes(fromPseudo);
    if (!onChatScreen && !popupOpen) {
      unreadChats[fromPseudo] = (unreadChats[fromPseudo] || 0) + 1;
      toast(`💬 ${fromPseudo} vous a envoyé un message`, "info", 2600);
    }
    if (popupOpen) delete unreadChats[fromPseudo];
    renderChatDock();
  }

  /* ------------------ AMIS ------------------ */
  function renderFriends() {
    const root = document.getElementById("friends-root");
    const friends = S.friends || [];
    root.innerHTML = `
      <div class="panel pad-lg" style="margin-bottom:12px;">
        <b style="color:var(--text-strong);">🔍 Rechercher un joueur</b>
        <div class="friends-search" style="display:flex; gap:8px; margin-top:10px;">
          <input type="text" id="friend-q" placeholder="Pseudo exact ou partiel…" maxlength="20"
                 style="flex:1; padding:10px 12px; border-radius:8px; border:.5px solid var(--line); background:var(--panel-2); color:var(--text);">
          <button class="btn primary" id="friend-search-btn">Rechercher</button>
        </div>
        <div id="friend-results" style="margin-top:12px;"></div>
      </div>

      ${(S.friendRequests.incoming.length || S.friendRequests.outgoing.length) ? `
      <div class="panel pad-lg" style="margin-bottom:12px;" id="freq-panel">
        ${S.friendRequests.incoming.length ? `
          <div class="panel-title">📨 Demandes reçues (${S.friendRequests.incoming.length})</div>
          ${S.friendRequests.incoming.map((r) => `
            <div class="friend-row" style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:.5px solid var(--line);">
              <span class="avatar" style="width:38px;height:38px;font-size:12px;cursor:pointer;" onclick="App.openProfileById(${r.from_id})" title="Voir le profil">${r.avatar ? `<img src="${r.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : r.pseudo.slice(0, 2).toUpperCase()}</span>
              <div style="flex:1;">
                <div style="font-weight:600; color:var(--text-strong);"><span class="link-pseudo" onclick="App.openProfileById(${r.from_id})" style="cursor:pointer;">${r.pseudo}</span></div>
                <div class="small muted">${r.elo} Elo${r.province ? " · 📍 " + r.province : ""} · veut devenir votre ami</div>
              </div>
              <button class="btn primary mini-btn" data-accept="${r.id}">✓ Accepter</button>
              <button class="btn danger mini-btn" data-decline="${r.id}">✕ Refuser</button>
            </div>`).join("")}` : ""}
        ${S.friendRequests.outgoing.length ? `
          <div class="panel-title" style="margin-top:${S.friendRequests.incoming.length ? "14px" : "0"};">⏳ Demandes envoyées (${S.friendRequests.outgoing.length})</div>
          ${S.friendRequests.outgoing.map((r) => `
            <div class="friend-row" style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:.5px solid var(--line);">
              <span class="avatar" style="width:38px;height:38px;font-size:12px;cursor:pointer;" onclick="App.openProfileById(${r.to_id})" title="Voir le profil">${r.avatar ? `<img src="${r.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : r.pseudo.slice(0, 2).toUpperCase()}</span>
              <div style="flex:1;">
                <div style="font-weight:600; color:var(--text-strong);"><span class="link-pseudo" onclick="App.openProfileById(${r.to_id})" style="cursor:pointer;">${r.pseudo}</span></div>
                <div class="small muted">${r.elo} Elo · en attente de sa réponse…</div>
              </div>
              <span class="pill">En attente</span>
            </div>`).join("")}` : ""}
      </div>` : ""}

      <div class="panel-title">Mes amis (${friends.length})</div>
      <div class="panel pad-lg" id="friends-list">
        ${friends.length ? friends.map((f) => `
          <div class="friend-row" style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:.5px solid var(--line);">
            <span class="avatar" style="width:38px;height:38px;font-size:12px;cursor:pointer;" onclick="App.openProfileById(${f.id})" title="Voir le profil">${f.pseudo.slice(0, 2).toUpperCase()}</span>
            <div style="flex:1;">
              <div style="font-weight:600; color:var(--text-strong);"><span class="link-pseudo" onclick="App.openProfileById(${f.id})" style="cursor:pointer;" title="Voir le profil">${f.pseudo}</span> ${f.online ? '<span class="pill green" style="font-size:10px;margin-left:6px;">En ligne</span>' : ''}</div>
              <div class="small muted">${f.elo} Elo · ${f.wins}V/${f.losses}D</div>
            </div>
            <button class="btn mini-btn" data-chat="${f.pseudo}">💬</button>
            <button class="btn mini-btn" data-defi="${f.pseudo}">⚔️</button>
            <button class="btn danger mini-btn" data-remove="${f.pseudo}">✕</button>
          </div>`).join("") : '<p class="muted" style="text-align:center;">Aucun ami pour le moment. Recherchez un joueur ci-dessus et envoyez-lui une demande d\'ami.</p>'}
      </div>`;

    // Recherche
    const doSearch = async () => {
      const q = document.getElementById("friend-q").value.trim();
      const res = document.getElementById("friend-results");
      if (!q) { res.innerHTML = ""; return; }
      res.innerHTML = '<p class="muted small">Recherche…</p>';
      try {
        const d = await API.request("/api/users/search?q=" + encodeURIComponent(q));
        const users = d.users || [];
        if (!users.length) { res.innerHTML = '<p class="muted small">Aucun joueur trouvé.</p>'; return; }
        res.innerHTML = users.map((u) => `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:.5px solid var(--line);">
            <span class="avatar" style="width:34px;height:34px;font-size:11px;cursor:pointer;" onclick="App.openProfileById(${u.id})" title="Voir le profil">${u.pseudo.slice(0, 2).toUpperCase()}</span>
            <div style="flex:1;"><b class="link-pseudo" style="color:var(--text-strong);cursor:pointer;" onclick="App.openProfileById(${u.id})" title="Voir le profil">${u.pseudo}</b> <span class="small muted">${u.elo} Elo</span></div>
            ${u.isFriend
              ? '<span class="pill green" style="font-size:10px;">Déjà ami</span>'
              : u.requestSent
                ? '<span class="pill" style="font-size:10px;">Demande envoyée</span>'
                : `<button class="btn primary mini-btn" data-add="${u.pseudo}">📨 Envoyer une demande</button>`}
          </div>`).join("");
        res.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => addFriend(b.dataset.add));
      } catch (e) { res.innerHTML = '<p class="muted small">Erreur de recherche.</p>'; }
    };
    document.getElementById("friend-search-btn").onclick = doSearch;
    document.getElementById("friend-q").onkeydown = (e) => { if (e.key === "Enter") doSearch(); };

    // Actions liste
    document.querySelectorAll("#friends-list [data-chat]").forEach((b) => b.onclick = () => openChatPopup(b.dataset.chat));
    document.querySelectorAll("#friends-list [data-defi]").forEach((b) => b.onclick = () => challengeUser(b.dataset.defi));
    document.querySelectorAll("#friends-list [data-remove]").forEach((b) => b.onclick = () => removeFriend(b.dataset.remove));
    // Actions demandes d'ami
    document.querySelectorAll("#freq-panel [data-accept]").forEach((b) => b.onclick = () => respondFriendRequest(+b.dataset.accept, "accept"));
    document.querySelectorAll("#freq-panel [data-decline]").forEach((b) => b.onclick = () => respondFriendRequest(+b.dataset.decline, "decline"));
  }

  /* Envoi d'une demande d'ami (le destinataire devra accepter ou refuser) */
  async function addFriend(pseudo) {
    try {
      const d = await API.request("/api/friends/request", "POST", { pseudo });
      if (d.status === "accepted") toast(`Vous êtes maintenant ami avec ${pseudo} 🤝`);
      else toast(`Demande d'ami envoyée à ${pseudo} 📨`);
      await refreshFriends();
      renderFriends();
    } catch (e) { toast(e.message || "Impossible d'envoyer la demande.", "error"); }
  }
  /* Répondre à une demande reçue : "accept" ou "decline" */
  async function respondFriendRequest(id, action) {
    try {
      const d = await API.request("/api/friends/respond", "POST", { id, action });
      if (d.status === "accepted") toast(`Vous êtes maintenant ami avec ${d.friend?.pseudo || "ce joueur"} 🤝 — message D-aona envoyé !`);
      else toast("Demande d'ami refusée.", "warn");
      await refreshFriends();
      renderFriends();
    } catch (e) { toast(e.message || "Erreur.", "error"); }
  }
  async function removeFriend(pseudo) {
    try {
      await API.request("/api/friends/" + encodeURIComponent(pseudo), "DELETE");
      toast(`${pseudo} retiré de vos amis.`, "warn");
      await refreshFriends();
      renderFriends();
    } catch (e) { toast(e.message || "Erreur.", "error"); }
  }

  /* ------------------ MODALES DIVERSES ------------------ */
  // Résultat du tirage au sort pile/face (qui commence). Révélation transitoire.
  let _tossShown = false;
  function showTossResult({ side, starter, meNum, starterName, oppName }) {
    if (_tossShown) return;
    _tossShown = true;
    const starterIsMe = meNum != null ? starter === meNum : (S ? starter === S.playerNum : true);
    const name = starterIsMe ? "Vous" : (starterName || oppName || "Adversaire");
    const color = starter === 1 ? "Noir" : "Blanc";
    showModal(`
      <button class="btn ghost mini-btn m-close" onclick="App.closeModal()">✕</button>
      <div class="toss-wrap"><div class="coin result-${side === "face" ? "face" : "pile"}"><span class="coin-face">PILE</span><span class="coin-back">FACE</span></div></div>
      <h2 style="text-align:center;">Tirage au sort : ${side === "pile" ? "PILE" : "FACE"}</h2>
      <p class="m-sub" style="text-align:center;">Le tirage au sort désigne <b>${name}</b> (${color}) — il joue en premier.</p>
      <div class="m-foot"><button class="btn primary" onclick="App.closeModal()">C'est parti !</button></div>
    `);
    // Auto-fermeture pour ne pas bloquer le plateau.
    setTimeout(closeModal, 2500);
  }
  const tossModal = showTossResult; // compat

  /* Choix des faces du tirage au sort. Chaque joueur choisit PILE ou FACE ;
     une fois une face prise par un joueur, l'autre reçoit automatiquement
     l'autre face. Ensuite on lance la pièce : celui dont la face sort commence. */
  let _chooseCtx = null;
  function openChooseSide(ctx) {
    _chooseCtx = ctx; // { mode, sessionId, meNum, opponent, lockedSide }
    renderChooseModal();
  }
  function renderChooseModal() {
    if (!_chooseCtx) return;
    const c = _chooseCtx;
    const mine = c.lockedSide || null;
    const oppName = (c.opponent && c.opponent.pseudo) || "Adversaire";
    showModal(`
      <h2 style="text-align:center;">🎯 Choisissez votre face</h2>
      <p class="m-sub" style="text-align:center;">Chaque joueur choisit PILE ou FACE. Une fois une face prise par un joueur, l'autre reçoit automatiquement l'autre face. Ensuite la pièce est lancée : celui dont la face sort commence.</p>
      <div class="choose-coin">
        <button class="coin-opt ${mine === "pile" ? "sel" : "free"}" id="choose-pile" ${mine ? "disabled" : "onclick=\"App.pickSide('pile')\""}>💙 PILE</button>
        <button class="coin-opt ${mine === "face" ? "sel" : "free"}" id="choose-face" ${mine ? "disabled" : "onclick=\"App.pickSide('face')\""}>✋ FACE</button>
      </div>
      ${mine
        ? `<p class="m-sub" style="text-align:center;">Vous jouez <b>${mine === "pile" ? "PILE" : "FACE"}</b> — ${c.mode === "ai" ? "lancement du tirage…" : "en attente de l'adversaire…"}</p>`
        : `<p class="muted small" style="text-align:center; margin-top:8px;"><b>${oppName}</b> recevra automatiquement l'autre face.</p>`}
    `, "md", true);
  }
  function pickSide(side) {
    if (!_chooseCtx) return;
    const c = _chooseCtx;
    // Entraînement IA local : tirage résolu immédiatement côté client.
    if (c.mode === "ai" && !c.sessionId) {
      const st = Fanorona.chooseSide(side);
      closeChooseModal();
      if (st && st.toss) showTossResult({ side: st.toss.side, starter: st.toss.starter, meNum: st.playerNum, starterName: st.opponent && st.opponent.pseudo, oppName: "IA — Antso" });
      return;
    }
    // En ligne (ou IA serveur) : on envoie le choix au serveur, qui résout.
    if (c.sessionId) API.send({ type: "pick_side", sessionId: c.sessionId, side });
    c.lockedSide = side;
    renderChooseModal();
  }
  function closeChooseModal() { _chooseCtx = null; closeModal(); }


  function rulesModal() {
    showModal(`
      <button class="btn ghost mini-btn m-close" onclick="App.closeModal()">✕</button>
      <h2>Règles du Fanorona</h2>
      <p class="m-sub">Jeu traditionnel malgache — 22 pions par joueur sur un plateau 9 × 5. Avant de commencer, chaque joueur choisit PILE ou FACE ; une fois une face prise, l'autre joueur reçoit automatiquement l'autre face. Le lancer de pièce désigne le joueur qui commence.</p>
      <ul class="rules-list">
        <li><b>But du jeu :</b> capturer tous les pions de l'adversaire.</li>
        <li><b>Déplacement :</b> à son tour, on déplace un de ses pions dans n'importe quelle direction, d'une intersection à une autre (en suivant les lignes), pourvu que le point d'arrivée soit vide.</li>
        <li><b>Capture par approche :</b> avancer vers un ou plusieurs pions adverses alignés capture tous les pions de l'alignement.</li>
        <li><b>Capture par éloignement (retrait) :</b> s'éloigner d'un ou plusieurs pions adverses alignés capture tous les pions de l'alignement.</li>
        <li>⚠️ <b>On ne capture que les pions d'un alignement interrompu.</b></li>
        <li><b>Prises en chaîne :</b> au cours d'un même mouvement on peut enchaîner les prises avec le même pion, pourvu qu'il change de direction à chaque déplacement et qu'il ne repasse pas deux fois sur la même intersection.</li>
        <li><b>Capture obligatoire :</b> si une prise est possible, vous devez la jouer.</li>
        <li><b>Tirage au sort :</b> chaque joueur choisit une face (PILE ou FACE) ; une fois une face prise par un joueur, l'autre joueur reçoit automatiquement l'autre face. La pièce lancée désigne celui qui commence.</li>
        <li><b>Victoire :</b> capturer les 22 pions adverses.</li>
        <li><b>Forfait :</b> quitter une partie en cours fait perdre la partie et les points Elo (PRD §14.2).</li>
      </ul>
      <div class="m-foot"><button class="btn primary" onclick="App.closeModal()">C'est compris !</button></div>
    `, "lg");
  }

  function supportModal() {
    showModal(`
      <button class="btn ghost mini-btn m-close" onclick="App.closeModal()">✕</button>
      <h2>Service client</h2>
      <p class="m-sub">Changement de numéro, difficulté de connexion ou litige : envoyez une demande (PRD §11).</p>
      <label class="f-label">Motif</label>
      <select id="sp-motif">
        <option>Changement de numéro de téléphone</option>
        <option>Connexion impossible</option>
        <option>Retrait non reçu</option>
        <option>Litige sur une partie</option>
        <option>Autre</option>
      </select>
      <label class="f-label">Votre demande</label>
      <textarea id="sp-msg" rows="4" placeholder="Décrivez votre situation…"></textarea>
      <div class="m-foot">
        <button class="btn ghost" onclick="App.closeModal()">Annuler</button>
        <button class="btn primary" id="sp-send">Envoyer la demande</button>
      </div>
    `);
    document.getElementById("sp-send").onclick = () => {
      closeModal();
      toast("Ticket créé — le service client traite votre demande sous 48 h. ✉️");
    };
  }

  /* ------------------ WEBSOCKET HANDLERS ------------------ */
  function setupWebSocket() {
    API.on("match_found", (msg) => {
      S.matchmaking = false;
      S.pendingMatch = msg;
      showModal(`
        <h2>Adversaire trouvé ! ⚔️</h2>
        <div class="panel pad-lg" style="display:flex; gap:14px; align-items:center; margin-top:8px;">
          <span class="avatar" style="width:52px;height:52px;border-color:rgba(229,72,77,.5);cursor:default;">${msg.opponent.pseudo.slice(0, 2).toUpperCase()}</span>
          <div style="flex:1;">
            <b style="color:var(--text-strong); font-size:16px;">${msg.opponent.pseudo}</b>
            <div class="small muted">${rankFor(msg.opponent.elo).name}</div>
          </div>
          <div style="text-align:right;"><div class="mono" style="font-size:20px; font-weight:700;">${msg.opponent.elo}</div><div class="small muted">Elo</div></div>
        </div>
        <p class="m-sub" style="margin-top:12px;">Format : ${FORMATS.find((f) => f.id === msg.format)?.name || msg.format} · Partie classée</p>
        <div class="m-foot">
          <button class="btn ghost" id="mm-decline">Refuser</button>
          <button class="btn primary" id="mm-accept">✅ Accepter le match</button>
        </div>
      `, "", true);
      document.getElementById("mm-accept").onclick = () => {
        API.send({ type: "accept_match", matchKey: msg.matchKey });
        showModal(`
          <h2>En attente de l'adversaire…</h2>
          <div class="mm-spinner"><div class="mm-orbit"><i></i><i></i><i></i></div>
          <p class="muted small" id="mm-wait">Vous avez accepté. En attente que ${msg.opponent.pseudo} accepte aussi…</p></div>
        `, "", true);
      };
      document.getElementById("mm-decline").onclick = () => {
        API.send({ type: "cancel_match" });
        closeModal();
        toast("Match refusé.", "warn");
      };
    });
    API.on("friend_request", async (msg) => {
      toast(`📨 ${msg.from} vous a envoyé une demande d'ami !`, "ok", 5000);
      await refreshFriends();
      if (currentRoute() === "friends") renderFriends();
    });
    API.on("friend_update", async () => {
      await refreshFriends();
      if (currentRoute() === "friends") renderFriends();
    });
    API.on("match_status", (msg) => {
      const el = document.getElementById("mm-wait");
      if (el) el.textContent = (msg.p1Ready && msg.p2Ready) ? "Les deux joueurs ont accepté — lancement…" : "Vous avez accepté. En attente de l'adversaire…";
    });
    API.on("match_cancelled", () => {
      closeModal();
      toast("L'adversaire a annulé le match.", "warn");
    });
    API.on("game_start", (msg) => {
      S.matchmaking = false;
      S.pendingMatch = null;
      closeModal();
      startServerGame(msg.sessionId, msg.playerNum, msg.state, msg.opponent, msg.mode, msg.format, msg.wager);
    });
    API.on("game_state", (msg) => {
      if (msg.sessionId === S.currentSession) onServerGameState(msg);
    });
    API.on("game_end", (msg) => {
      if (msg.sessionId === S.currentSession) onServerGameEnd(msg);
    });
    API.on("matchmaking", (msg) => {
      if (msg.status === "searching") { /* en attente */ }
    });
    API.on("wallet_update", (msg) => {
      S.balance = msg.balance; S.bonusLock = msg.bonusLock;
      updateTopbar();
    });
    API.on("tournament_update", () => {
      refreshTournaments();
    });
    API.on("challenge_received", (msg) => {
      const c = msg.challenge;
      S.defis = S.defis || [];
      S.defis.unshift({ id: c.id, from: c.from, fromElo: c.fromElo, wager: c.wager, format: c.format });
      toast(`Nouveau défi de ${c.from} (${c.wager ? fmtAr(c.wager) : "gratuit"}) !`, "warn");
      if (currentRoute() === "home") renderHome();
      if (currentRoute() === "match") renderMatch();
    });
    API.on("challenge_sent", (msg) => {
      toast(`Défi envoyé à ${msg.to} 👍`);
    });
    API.on("challenge_accepted", (msg) => {
      toast("Votre défi a été accepté ! Lancement du match…");
    });
    API.on("challenge_status", (msg) => {
      if (msg.status === "rejected") toast("Votre défi a été refusé.", "warn");
      if (msg.status === "expired") toast("Votre défi a expiré.", "warn");
    });
    API.on("chat_message", (msg) => {
      if (msg.direction === "me") return;
      S.chatThreads[msg.from] = S.chatThreads[msg.from] || [];
      S.chatThreads[msg.from].push({ from: "them", text: msg.text, at: msg.at || "À l'instant" });
      if (!S.contacts.some((c) => c.pseudo === msg.from)) S.contacts.push({ pseudo: msg.from });
      if (currentRoute() === "chat" && chatWith === msg.from) renderChat();
      onIncomingChat(msg.from);
    });
    API.on("spectate_state", onSpectateState);
    API.on("spectate_end", onSpectateEnd);
    API.on("live_update", () => { if (currentRoute() === "match") loadLiveGames(); });
    API.on("tournament_sim_step", (msg) => {
      const el = document.getElementById("tn-progress");
      if (el) el.textContent = msg.step;
    });
    API.on("tournament_sim_result", (msg) => {
      const place = msg.place, gained = msg.gained || 0;
      closeModal();
      showModal(`
        <div class="result-banner">
          <div class="rb-ico">${place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : "🏁"}</div>
          <h2>${place === 1 ? "Champion du tournoi !" : place === 2 ? "Vice-champion !" : place === 3 ? "3e place — mise remboursée" : "Éliminé"}</h2>
          <p class="muted small">${msg.results ? msg.results.first : ""} · ${msg.results ? msg.results.second : ""} · ${msg.results ? msg.results.third : ""}</p>
        </div>
        ${gained ? `<p class="small" style="text-align:center; margin-top:10px;">Crédité : <b class="mono pos">${fmtAr(gained)}</b> ✓</p>` : ""}
        <div class="m-foot"><button class="btn primary" onclick="App.closeModal(); App.go('match');">OK</button></div>
      `);
      refreshTournaments(); refreshUser();
      if (currentRoute() === "match") renderMatch();
    });
    API.on("error", (msg) => {
      toast(msg.message || "Erreur", "error");
      // Un coup rejeté laisse G.busy à true côté client → débloquer le plateau immédiatement.
      if (Fanorona && Fanorona.unstuck) Fanorona.unstuck();
    });
    // À la (re)connexion WebSocket, resynchroniser l'état autoritaire pour éviter
    // que le client part d'un état périmé (désynchro → "je ne peux plus bouger").
    API.on("open", () => {
      updateResumeBanner();
      if (S.currentSession && API.isConnected()) {
        API.send({ type: "sync_game", sessionId: S.currentSession });
      }
    });
    API.on("challenges_update", (msg) => {
      S.defis = (msg.challenges || []).map((c) => ({ id: c.id, from: c.from_pseudo, fromElo: c.from_elo, wager: c.wager, format: c.format }));
      if (currentRoute() === "home") renderHome();
      if (currentRoute() === "match") renderMatch();
    });
  }

  /* ------------------ HORLOGE ------------------ */
  function ticker() {
    Fanorona.tickClock();
    document.querySelectorAll("[data-cd]").forEach((el) => {
      const t = S.tournaments.find((x) => x.id === el.dataset.cd);
      if (t && t.status === "inscriptions") el.textContent = countdownParts(t.startsInSec);
    });
  }

  /* ------------------ PROFIL PUBLIC (par ID joueur) ------------------ */
  /* Chaque joueur est identifié par son ID unique (jamais son pseudo, qui peut
     changer). Cliquer sur un pseudo redirige vers #/profile?id=<ID>. */
  function findUserIdByPseudo(pseudo) {
    const pools = [S.onlineUsers, S.friends, S.contacts, S.leaderboard];
    for (const pool of pools) {
      const hit = (pool || []).find((u) => u.pseudo === pseudo && u.id);
      if (hit) return hit.id;
    }
    return null;
  }

  async function openProfileByPseudo(pseudo) {
    if (pseudo === S.pseudo) return go("profile");
    const id = findUserIdByPseudo(pseudo);
    if (id) return openProfileById(id);
    // Sinon : résoudre l'ID via la recherche serveur (le pseudo n'est qu'un alias)
    try {
      const d = await API.request("/api/users/search?q=" + encodeURIComponent(pseudo));
      const u = (d.users || []).find((x) => x.pseudo === pseudo);
      if (u) return openProfileById(u.id);
    } catch (e) { /* ignore */ }
    toast("Profil introuvable pour " + pseudo, "warn");
  }

  function openProfileById(id) {
    if (id === S.id) return go("profile");
    location.hash = "#/profile?id=" + id;
  }

  async function renderPublicProfile(id) {
    const root = document.getElementById("profile-root");
    root.innerHTML = `<div class="panel pad-lg" style="text-align:center;"><p class="muted">Chargement du profil…</p></div>`;
    let d;
    try {
      d = await API.request("/api/users/" + id);
    } catch (e) {
      root.innerHTML = `<div class="panel pad-lg" style="text-align:center;"><b style="color:var(--text-strong);">Joueur introuvable</b><p class="small muted" style="margin-top:6px;">Ce profil n'existe pas ou a été supprimé.</p><button class="btn" style="margin-top:12px;" onclick="App.go('home')">Retour à l'accueil</button></div>`;
      return;
    }
    const u = d.user;
    const games = d.games || [];
    const r = rankFor(u.elo);
    const winRate = Math.round(100 * u.wins / Math.max(1, u.wins + u.losses));
    root.innerHTML = `
      <div class="profile-layout">
        <div class="side-stack">
          <div class="panel profile-card">
            <div class="big-avatar">
              ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : u.pseudo.slice(0, 2).toUpperCase()}
            </div>
            <h2>${u.pseudo}</h2>
            <p class="small muted">ID joueur #${u.id} · 📍 ${u.province || "—"}</p>
            <div style="display:flex; gap:8px; justify-content:center; margin:10px 0 4px; flex-wrap:wrap;">
              <span class="pill" style="color:${r.color}; border-color:${r.color}55;">◆ ${r.name}</span>
              <span class="pill amber mono">${u.elo} Elo</span>
              ${u.online ? '<span class="pill green">En ligne</span>' : ""}
            </div>
            ${u.badge ? `<div style="margin-top:6px;"><span class="badge-chip" style="color:${u.badge.color}; border-color:${u.badge.color}66; background:${u.badge.color}14;" title="Badge national"><span class="bi">${u.badge.icon}</span>${u.badge.name}${u.rank ? ` <span class="muted mono" style="font-weight:400;">#${u.rank}</span>` : ""}</span></div>` : ""}
            <div class="stat-grid" style="text-align:center;">
              <div class="stat-cell"><div class="v">${u.wins + u.losses}</div><div class="k">Parties</div></div>
              <div class="stat-cell"><div class="v pos">${u.wins}</div><div class="k">Victoires</div></div>
              <div class="stat-cell"><div class="v neg">${u.losses}</div><div class="k">Défaites</div></div>
              <div class="stat-cell"><div class="v">${winRate}%</div><div class="k">Win rate</div></div>
            </div>
            <div style="display:flex; gap:8px; justify-content:center; margin-top:14px; flex-wrap:wrap;">
              <button class="btn primary" id="pp-msg">💬 Message</button>
              <button class="btn" id="pp-defi">⚔️ Défier</button>
              ${u.friendStatus === "friends"
                ? `<button class="btn danger" id="pp-unfriend">Retirer l'ami</button>`
                : u.friendStatus === "sent"
                  ? `<button class="btn" id="pp-cancelreq" disabled>⏳ Demande envoyée</button>`
                  : u.friendStatus === "received"
                    ? `<button class="btn primary" id="pp-acceptreq" data-req="${u.requestId}">✓ Accepter la demande</button>
                       <button class="btn danger" id="pp-declinereq" data-req="${u.requestId}">✕ Refuser</button>`
                  : `<button class="btn" id="pp-addfriend">📨 Envoyer une demande d'ami</button>`}
            </div>
          </div>
        </div>
        <div class="side-stack">
          <div class="panel">
            <div class="panel-title">Ses dernières parties</div>
            ${games.length ? games.slice(0, 8).map((g) => `
              <div class="feed-item">
                <span class="feed-ic" style="background:${g.result === "Victoire" ? "var(--green-soft)" : "var(--red-soft)"}">${g.result === "Victoire" ? "🏆" : "💥"}</span>
                <div style="flex:1;"><div class="t1">${g.result} contre <b>${g.vs}</b> <span class="muted small">· ${g.mode}</span></div><div class="t2">${g.at}</div></div>
                <span class="mono ${g.delta >= 0 ? "pos" : "neg"}" style="font-weight:700;">${g.delta >= 0 ? "+" : ""}${g.delta} Elo</span>
              </div>`).join("") : '<p class="muted">Aucune partie jouée pour le moment.</p>'}
          </div>
        </div>
      </div>`;
    document.getElementById("pp-msg").onclick = () => openChatPopup(u.pseudo);
    document.getElementById("pp-defi").onclick = () => challengeUser(u.pseudo);
    const addBtn = document.getElementById("pp-addfriend");
    if (addBtn) addBtn.onclick = async () => {
      try {
        const d = await API.request("/api/friends/request", "POST", { pseudo: u.pseudo });
        if (d.status === "accepted") toast(`Vous êtes maintenant ami avec ${u.pseudo} 🤝`);
        else toast(`Demande d'ami envoyée à ${u.pseudo} 📨`);
        refreshFriends();
        renderPublicProfile(id);
      } catch (e) { toast(e.message || "Impossible d'envoyer la demande.", "error"); }
    };
    const accBtn = document.getElementById("pp-acceptreq");
    if (accBtn) accBtn.onclick = async () => {
      try {
        const d = await API.request("/api/friends/respond", "POST", { id: +accBtn.dataset.req, action: "accept" });
        toast(`Vous êtes maintenant ami avec ${u.pseudo} 🤝 — message D-aona envoyé !`);
        refreshFriends();
        renderPublicProfile(id);
      } catch (e) { toast(e.message || "Erreur.", "error"); }
    };
    const decBtn = document.getElementById("pp-declinereq");
    if (decBtn) decBtn.onclick = async () => {
      try {
        await API.request("/api/friends/respond", "POST", { id: +decBtn.dataset.req, action: "decline" });
        toast("Demande d'ami refusée.", "warn");
        refreshFriends();
        renderPublicProfile(id);
      } catch (e) { toast(e.message || "Erreur.", "error"); }
    };
    const delBtn = document.getElementById("pp-unfriend");
    if (delBtn) delBtn.onclick = async () => {
      try {
        await API.request("/api/friends/" + encodeURIComponent(u.pseudo), "DELETE");
        toast(u.pseudo + " retiré de vos amis");
        refreshFriends();
        renderPublicProfile(id);
      } catch (e) { toast(e.message || "Erreur.", "error"); }
    };
  }

  /* ------------------ ROUTER ------------------ */
  const ROUTES = ["home", "play", "board", "match", "ranks", "wallet", "profile", "chat", "friends"];
  function route() {
    const raw = (location.hash.replace("#/", "") || "home");
    const [h, query] = raw.split("?");
    const r = ROUTES.includes(h) ? h : "home";
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + r));
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.route === r));
    // Profil d'un autre joueur : #/profile?id=<ID joueur>
    const viewId = query ? parseInt(new URLSearchParams(query).get("id")) : null;
    const renderers = { home: renderHome, play: renderPlay, match: renderMatch, ranks: renderRanks, wallet: renderWallet, profile: viewId && viewId !== S.id ? () => renderPublicProfile(viewId) : async () => { await refreshUser(); renderProfile(); }, chat: renderChat, friends: renderFriends, board: () => {} };
    renderers[r] && renderers[r]();
    // Quitter le plateau alors qu'on regarde un match → arrêter le spectate
    if (r !== "board" && spectatingId) stopSpectating();
    updateResumeBanner();
    window.scrollTo({ top: 0 });
  }

  /* ------------------ BIND GLOBAL ------------------ */
  function bindGlobal() {
    window.addEventListener("hashchange", route);
    document.querySelectorAll(".nav button").forEach((b) => b.onclick = () => {
      if (b.dataset.route === "board" && !Fanorona.isActive()) return toast("Aucune partie en cours — lancez un match depuis l'onglet Jeux.", "warn");
      go(b.dataset.route);
    });
    document.getElementById("logo").onclick = () => go("home");
    document.getElementById("resume-bar").onclick = resumeGame;
    document.getElementById("tb-wallet").onclick = () => go("wallet");
    document.getElementById("tb-avatar").onclick = () => go("profile");
    document.getElementById("tb-kyc").onclick = () => { if (!S.kyc) kycRequired(() => {}); else toast("Identité vérifiée ✓"); };
    document.getElementById("btn-friends").onclick = () => { refreshFriends(); go("friends"); };
    document.getElementById("chat-fab").onclick = toggleChatDock;
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay" && !e.target.dataset.locked) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("modal-overlay").dataset.locked) closeModal();
    });
    document.getElementById("btn-resign").onclick = () => {
      if (!Fanorona.isActive()) return;
      showModal(`
        <h2>Abandonner la partie ?</h2>
        <p class="m-sub">Un abandon fait perdre la partie et les points Elo (PRD §14.2).</p>
        <div class="m-foot">
          <button class="btn ghost" onclick="App.closeModal()">Continuer à jouer</button>
          <button class="btn danger" id="resign-ok">Abandonner</button>
        </div>`);
      document.getElementById("resign-ok").onclick = () => {
        closeModal();
        if (S.currentSession) API.send({ type: "resign", sessionId: S.currentSession });
        else Fanorona.resign();
      };
    };
    document.getElementById("btn-draw").onclick = () => {
      if (!Fanorona.isActive()) return;
      toast("Proposition de nulle envoyée…");
    };
    document.getElementById("btn-spectate").onclick = () =>
      copyLink(`${location.origin}`, "Lien du serveur copié — partagez-le à vos amis");
    document.getElementById("btn-chain-end").onclick = () => Fanorona.endChain();
    document.getElementById("auth-enter").onclick = enterApp;
    document.getElementById("auth-google").onclick = enterApp;
    document.getElementById("btn-theme").onclick = cycleTheme;
  }

  function iconFanorona() {
    return `<svg viewBox="0 0 32 32" fill="none">
      <rect x="3" y="3" width="26" height="26" rx="4" stroke="rgba(229,158,39,.7)" stroke-width="1.4"/>
      <circle cx="11" cy="11" r="3.4" fill="#d9b988"/>
      <circle cx="21" cy="21" r="3.4" fill="#2a2438" stroke="rgba(229,158,39,.6)"/>
      <circle cx="16" cy="16" r="1.1" fill="rgba(229,158,39,.9)"/>
    </svg>`;
  }

  /* ------------------ INIT ------------------ */
  function init() {
    applyTheme(currentTheme(), true);   // restaure l'icône du thème sauvegardé
    bindGlobal();
    setupWebSocket();
    updateTopbar();
    applySkins();
    route();
    updateResumeBanner();
    renderChatDock();
    setInterval(ticker, 1000);
    autoLogin();
  }

  document.addEventListener("DOMContentLoaded", init);

  /* API publique */
  return {
    go, toast, miniToast, depositFlow, withdrawFlow, kycRequired,
    joinTournament, tournamentDetail, simulateTournament,
    buySkin, equipSkin, rulesModal, tossModal, openChooseSide, pickSide, supportModal,
    copyLink, onGameEnd: onLocalGameEnd, closeModal,
    acceptDefi, refuseDefi, challengeUser, openChat,
    openChatPopup, openProfileById, openProfileByPseudo,
    spectate, stopSpectating,
    logout,
    state: () => S,
  };
})();

window.App = App;