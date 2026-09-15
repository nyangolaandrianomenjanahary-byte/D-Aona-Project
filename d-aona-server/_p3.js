/* =========================================================================
   GESTES UTILISATEUR (toujours via l'interface réelle)
   ========================================================================= */
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
}, sel);

const textOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.innerText.trim() : null;
}, sel);

const modalText = (page) => page.evaluate(() => {
  const ov = document.getElementById("modal-overlay");
  if (!ov || !ov.classList.contains("show")) return "";
  return (document.getElementById("modal").innerText || "").replace(/\s+/g, " ").trim();
});

/* La modale est-elle ouverte ? (classe `show` posée par showModal) */
const modalOpen = (page) => page.evaluate(() =>
  document.getElementById("modal-overlay").classList.contains("show"));

const modalClosed = (page, ms = 9000) => until(page, () =>
  !document.getElementById("modal-overlay").classList.contains("show"), ms);

/* Referme le tiroir de messagerie flottant s'il est ouvert : positionné en
   fixed (z-index 60), il recouvre la zone de saisie de l'écran Messagerie. */
async function closeChatDock(page) {
  const opened = () => page.evaluate(() => {
    const t = document.getElementById("chat-tray");
    return !!t && !!t.querySelector(".chat-panel");
  });
  if (!(await opened())) return true;
  await page.click("#chat-fab").catch(() => {});
  await sleep(600);
  return !(await opened());
}

/* Ouvre une conversation dans l'écran Messagerie. Trois gestes d'un vrai
   joueur : refermer les fenêtres restées ouvertes, refermer le tiroir flottant
   (z-index 60, il recouvre la liste), puis amener la ligne au CENTRE de la
   zone visible — laissée sous la barre du haut, elle reste partiellement
   cachée et le clic n'aboutit jamais. En cas d'échec, on nomme ce qui gêne. */
async function openConversation(page, pseudo) {
  await dismissModals(page);
  await closeChatDock(page);
  const item = page.locator(`#chat-root [data-chat="${pseudo}"]`).first();
  if (!(await item.count())) return "la conversation n'est pas proposée dans la liste";
  await page.evaluate((p) => {
    const el = document.querySelector(`#chat-root [data-chat="${p}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, pseudo);
  await sleep(350);
  /* La ligne peut rester sous la barre du haut (fixe) : quand c'est le cas, on
     tape la partie visible de la ligne plutôt que son centre recouvert. */
  const pt = await page.evaluate((p) => {
    const el = document.querySelector(`#chat-root [data-chat="${p}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return null;
    const bar = document.querySelector(".topbar, #topbar");
    const bas = bar ? bar.getBoundingClientRect().bottom : 0;
    const x = b.left + b.width / 2;
    const y = Math.max(b.top + Math.min(10, b.height / 4), bas + 8);
    if (y > b.bottom - 4) return null;
    const dessus = document.elementFromPoint(x, y);
    return { x, y, ok: !!dessus && (dessus === el || el.contains(dessus)),
      nom: dessus ? (dessus.id || dessus.className || dessus.tagName) : "aucun" };
  }, pseudo);
  if (!pt) return "la conversation reste cachée sous la barre du haut";
  if (!pt.ok) return "clic impossible sur la conversation : " + pt.nom + " recouvre la ligne";
  await page.mouse.click(pt.x, pt.y);
  return true;
}

/* Ferme les fenêtres restées ouvertes (résultat de partie, tirage, …) comme le
   ferait un joueur : bouton de fermeture, puis Échap, puis closeModal(). */
async function dismissModals(page) {
  for (let i = 0; i < 5; i++) {
    if (!(await modalOpen(page))) return true;
    const hit = await page.evaluate(() => {
      const m = document.getElementById("modal");
      const btn = m && m.querySelector(".m-close, [onclick*='closeModal'], .m-foot .btn.primary, .m-foot .btn");
      if (btn) { btn.click(); return true; }
      if (window.App && window.App.closeModal) { window.App.closeModal(); return true; }
      return false;
    });
    if (!hit) await page.keyboard.press("Escape");
    await sleep(700);
  }
  return !(await modalOpen(page));
}

const toasts = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("#toasts *")).map((t) => t.innerText.replace(/\s+/g, " ").trim()));

/* Inscription d'un compte neuf, étape par étape, comme un joueur le ferait. */
async function uiSignup(page, pseudo, pwd = PWD) {
  await gotoApp(page);
  await page.click("#wb-signup");
  const form = await until(page, () => {
    const e = document.getElementById("su-pseudo");
    return !!e && e.offsetParent !== null;
  }, 8000);
  if (!form) throw new Error("formulaire d'inscription non affiché");
  await page.fill("#su-pseudo", pseudo);
  await page.fill("#su-contact", pseudo.toLowerCase() + "@exemple.mg");
  await page.fill("#su-phone", "034" + String(Math.floor(Math.random() * 9000000 + 1000000)));
  await page.click("#su-next");
  const step2 = await until(page, () => {
    const e = document.getElementById("su-pass");
    return !!e && e.offsetParent !== null;
  }, 8000);
  if (!step2) return "étape 2 jamais affichée" + (await errorsOn(page, ["su-pseudo-err", "su-contact-err", "su-phone-err"]));
  await page.selectOption("#su-province", "Antananarivo");
  await page.fill("#su-pass", pwd);
  await page.fill("#su-pass2", pwd);
  await page.click("#su-enter");
  const ok = await until(page, () => document.getElementById("auth").classList.contains("hidden"), 20000);
  await sleep(500);
  if (!ok) return "compte non connecté après validation" + (await errorsOn(page, ["su-prov-err", "su-pass-err", "su-pass2-err"]));
  return true;
}

/* Messages d'erreur affichés par le formulaire, pour un diagnostic utile. */
async function errorsOn(page, ids) {
  const list = await page.evaluate((list) => list
    .map((i) => { const e = document.getElementById(i); return e && (e.innerText || "").trim() ? e.innerText.trim() : null; })
    .filter(Boolean), ids);
  return list.length ? " — " + list.join(" / ") : " (aucun message du formulaire)";
}

/* Connexion par le formulaire de connexion (après déconnexion). */
async function uiLogin(page, pseudo, pwd = PWD) {
  await gotoApp(page);
  await page.fill("#auth-id", pseudo);
  await page.fill("#auth-pass", pwd);
  await page.click("#auth-enter");
  const ok = await until(page, () => document.getElementById("auth").classList.contains("hidden"), 20000);
  await sleep(500);
  return ok;
}

/* Navigation par route (mêmes entrées que la barre d'onglets). */
async function goScreen(page, route) {
  await page.evaluate((r) => { location.hash = "#/" + r; }, route);
  const ok = await until(page, (r) => {
    const s = document.getElementById("screen-" + r);
    return !!s && s.classList.contains("active");
  }, route, 10000);
  await sleep(350);
  return ok;
}

/* Nombre de pions affichés par camp + cases cliquables. */
const pieceCounts = (page) => page.evaluate(() => ({
  me: document.querySelectorAll(".piece.me").length,
  opp: document.querySelectorAll(".piece.opp").length,
  cells: document.querySelectorAll("#cells .cell").length,
}));

/* État réel du plateau, lu dans la page. `log` = nombre de coups inscrits au
   journal visible (#move-log) : c'est la trace qu'un joueur a sous les yeux,
   et la seule fiable en entraînement (l'objet d'état y garde `moves` vide,
   alors qu'il reçoit la liste officielle du serveur en partie en ligne). */
const boardState = (page) => page.evaluate(() => {
  const g = window.Fanorona && window.Fanorona.state ? window.Fanorona.state() : null;
  if (!g) return null;
  return {
    grid: g.grid, turn: g.turn, playerNum: g.playerNum, over: !!g.over,
    spectator: !!g.spectator, phase: g.phase || null, mode: g.mode || null,
    chain: g.chain ? { pos: g.chain.pos, visited: Array.from(g.chain.visited || []), lastDir: g.chain.lastDir } : null,
    moves: (g.moves || []).length, wager: g.wager || 0,
    log: document.querySelectorAll("#move-log li").length,
    opponent: g.opponent ? g.opponent.pseudo : null,
  };
});

/* Tape une case du plateau comme un joueur : au centre de la case. Les pions
   sont inertes (pointer-events: none) mais en entraînement un point d'aide
   cliquable peut recouvrir la case d'arrivée : on vise alors le centre de
   l'élément réellement posé au-dessus de la case — c'est le geste prévu par
   l'interface. Le plateau peut être retourné (POV joueur 2) : on passe par les
   coordonnées écran, jamais par un calcul de position. */
async function tapCell(page, r, c) {
  const cell = page.locator(`#cells .cell[data-r="${r}"][data-c="${c}"]`).first();
  if (!(await cell.count())) return false;
  /* Un joueur commence par amener le plateau sous ses yeux : sans ce
     défilement, un clic calculé en coordonnées écran tombe hors de la zone
     visible (le plateau est plus bas que la fenêtre) et n'atteint personne. */
  await cell.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(150);
  const pt = await page.evaluate(([rr, cc]) => {
    const z = document.querySelector(`#cells .cell[data-r="${rr}"][data-c="${cc}"]`);
    if (!z) return null;
    const b = z.getBoundingClientRect();
    if (b.width < 2 || b.height < 2 || b.top < 0 || b.top > innerHeight - 2) return null;
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const el = top && (top.classList.contains("cell") || top.classList.contains("dot")) ? top : z;
    const eb = el.getBoundingClientRect();
    return { x: eb.left + eb.width / 2, y: eb.top + eb.height / 2, w: b.width, h: b.height,
      top: (top ? top.className : "aucun"), cible: el.className };
  }, [r, c]);
  if (!pt) return false;
  console.log("   [DIAG tap]", r, c, JSON.stringify(pt));
  await page.mouse.click(pt.x, pt.y);
  return true;
}
/* Joue un coup comme un joueur, en tapant les VRAIES cases du plateau :
   - les sources essayées d'abord sont les pions que l'interface signale
     jouables (aide à l'entraînement), puis celles du moteur du jeu ;
   - en entraînement, la destination est le point cliquable affiché par
     l'interface (geste prévu) ; ailleurs (partie classée, défi), où les aides
     sont coupées, on tape les cases d'arrivée proposées par le moteur et on
     s'arrête dès que le plateau accepte le coup.
   Le coup retenu est constaté sur le journal des coups (visible) et sur l'état
   officiel — jamais supposé. */
async function playMove(page) {
  const st = await boardState(page);
  if (!st || st.over || st.spectator) return null;
  if (st.turn !== st.playerNum) return null;
  const before = st.log;
  const chain = st.chain
    ? { pos: st.chain.pos, visited: new Set(st.chain.visited), lastDir: st.chain.lastDir }
    : null;
  const moteur = game.legalMoves(st.grid, st.playerNum, chain);
  if (!moteur.length) return null;
  const sources = [];
  const addSrc = (r, c) => { if (!sources.some((x) => x[0] === r && x[1] === c)) sources.push([r, c]); };
  const marques = await page.evaluate(() => Array.from(document.querySelectorAll(".piece.playable"))
    .map((p) => [+p.dataset.r, +p.dataset.c]));
  marques.forEach(([r, c]) => addSrc(r, c));
  moteur.forEach((m) => addSrc(m.from[0], m.from[1]));

  let dernier = null;
  for (const [fr, fc] of sources.slice(0, 8)) {
    if (!(await tapCell(page, fr, fc))) continue;
    await sleep(320);
    /* Point d'aide cliquable posé par l'interface sur les cases d'arrivée. */
    const dot = await page.evaluate(() => {
      const d = document.querySelector("#dots .dot");
      if (!d) return null;
      const b = d.getBoundingClientRect();
      return b.width > 1 ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
    });
    if (dot) {
      await page.mouse.click(dot.x, dot.y);
      await sleep(800);
      if (!dernier) dernier = { from: [fr, fc], to: null, cap: null, choix: null };
    } else {
      const cands = moteur.filter((m) => m.from[0] === fr && m.from[1] === fc).slice(0, 8);
      for (const cand of cands) {
        if (!(await tapCell(page, cand.to[0], cand.to[1]))) continue;
        await sleep(650);
        dernier = { from: cand.from, to: cand.to, cap: (cand.cap || []).length, choix: cands.length };
        if ((await boardState(page)).log > before) break;
      }
    }
    /* Prise ambiguë : l'interface demande approche / retrait. */
    const choice = await page.evaluate(() => {
      const b = document.getElementById("capture-choice");
      return !!b && !b.hidden && b.querySelectorAll("button").length > 0;
    });
    if (choice) {
      await page.locator("#capture-choice button").first().click({ timeout: 10000 }).catch(() => {});
      await sleep(800);
    }
    let fin = await boardState(page);
    if (fin && fin.chain && fin.turn === fin.playerNum) {
      await page.click("#btn-chain-end", { timeout: 8000 }).catch(() => {});
      await sleep(700);
      fin = await boardState(page);
    }
    if (fin && (fin.log > before || fin.moves > st.moves || fin.turn !== st.turn)) {
      return {
        from: (dernier && dernier.from) || [fr, fc], to: dernier ? dernier.to : null,
        cap: dernier ? dernier.cap : null, choix: dernier ? dernier.choix : null,
        retenu: true, journal: fin.log, avis: "",
      };
    }
  }
  const fin = await boardState(page);
  return {
    from: dernier ? dernier.from : null, to: dernier ? dernier.to : null,
    cap: dernier ? dernier.cap : null, choix: dernier ? dernier.choix : null,
    retenu: false, journal: fin ? fin.log : null,
    avis: (await toasts(page)).slice(-2).join(" / "),
  };
}

﻿/* Ouvre la fenetre de conversation flottante avec un contact, depuis la liste
   d'amis : c'est le geste naturel (bouton de conversation d'une ligne d'ami) et
   il ne depend pas du defilement de l'ecran Messagerie, dont la liste peut
   rester hors de la zone visible. */
async function uiOpenChatPopup(page, pseudo) {
  await dismissModals(page);
  await goScreen(page, "friends");
  const pret = await until(page, (p) => !!document.querySelector(`#friends-list [data-chat="${p}"]`), pseudo, 9000);
  if (!pret) return "le contact n'apparait pas dans la liste d'amis";
  const btn = page.locator(`#friends-list [data-chat="${pseudo}"]`).first();
  await btn.click({ timeout: 12000 });
  const ok = await until(page, (p) => !!document.querySelector(`.chat-pop[data-pop="${p}"]`), pseudo, 8000);
  return ok ? true : "la fenetre de conversation ne s'ouvre pas";
}
