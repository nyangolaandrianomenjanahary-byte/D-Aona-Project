/* =========================================================================
   D-aôna — CAMPAGNE DE TESTS SCÉNARIOS (interface réelle, navigateur)
   -------------------------------------------------------------------------
   Chaque scénario reproduit le geste d'un VRAI joueur dans un navigateur
   (clic, saisie, route) contre une instance jetable du serveur. Aucune
   écriture dans la base réelle : elle est copiée (VACUUM INTO) puis
   l'instance de test travaille sur la copie, supprimée en fin de campagne.

   Usage :  node test_ui_scenarios.js          (campagne complète)
            node test_ui_scenarios.js S6       (un seul scénario)
   Sortie : rapport lisible + code de sortie 1 si échec.
   Navigateur : Microsoft Edge ou Chrome installé (aucun téléchargement).
   ========================================================================= */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("playwright");
const game = require("./game.js");

const PORT = Number(process.env.D_AONA_TEST_PORT || 8098);
const BASE = `http://127.0.0.1:${PORT}`;
const REAL_DB = path.join(__dirname, "d-aona.db");
const PWD = "Scenario!2026Zz";
const ONLY = (process.argv[2] || "").toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (n) => Math.floor(Math.random() * 900000 + 100000) + n;

/* ---------- Copie jetable de la base (source ouverte en lecture seule) ---------- */
let tmpDir = null;
function snapshotDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daona-ui-"));
  const dest = path.join(tmpDir, "d-aona.db");
  const src = new DatabaseSync(REAL_DB, { readOnly: true });
  src.exec(`VACUUM INTO '${dest.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  src.close();
  return dest;
}

/* ---------- Instance jetable du serveur, sur la copie ---------- */
function startServer(dbPath) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, D_AONA_PORT: String(PORT), D_AONA_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitServer(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(BASE + "/api/user"); if (r.status) return true; } catch (e) {}
    await sleep(250);
  }
  throw new Error("le serveur de test n'a pas démarré sur le port " + PORT);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill(); } catch (e) { clearTimeout(t); resolve(); }
  });
}

function cleanup() {
  try { if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
}

/* ---------- Préparation de la copie jetable ----------
   La base réelle ne contient que des tournois dont l'heure de début est déjà
   passée (leur statut reste pourtant « inscriptions »). Pour pouvoir tester
   l'inscription côté interface, on ajoute — sur la COPIE uniquement — un
   tournoi réellement ouvert (début dans 30 minutes, rang Bronze, mise 1 000). */
const TID_UI = 9101;
function prepareFixture(dbPath) {
  const d = new DatabaseSync(dbPath);
  d.prepare("DELETE FROM tournament_matches WHERE tournament_id = ?").run(TID_UI);
  d.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ?").run(TID_UI);
  d.prepare("DELETE FROM tournaments WHERE id = ?").run(TID_UI);
  d.prepare(`INSERT INTO tournaments
      (id,name,game,format,entry,max_players,status,min_rank,sponsor,starts_at,results_json,match_duration_min,interval_min)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    TID_UI, "Tournoi UI — Scénarios", "Fanorona", "blitz", 1000, 8, "inscriptions", "Bronze", null,
    new Date(Date.now() + 30 * 60000).toISOString(), null, 5, 5);
  d.close();
}

/* =========================================================================
   RAPPORT DE CAMPAGNE
   ========================================================================= */
const results = [];
let CURRENT = "?";
function scen(id, title) { CURRENT = id; console.log(`\n=== ${id} — ${title} ===`); }
async function step(label, fn) {
  const t0 = Date.now();
  let ok = false, note = "";
  try {
    const r = await fn();
    ok = r === true;
    if (!ok) note = typeof r === "string" ? r : "condition non remplie";
  } catch (e) {
    note = String((e && e.message) || e).split("\n")[0].slice(0, 180);
  }
  results.push({ id: CURRENT, label, ok, ms: Date.now() - t0, note });
  console.log(`  ${ok ? "OK    " : "ECHEC "} ${label}${ok ? "" : "   <-- " + note}`);
  return ok;
}

/* =========================================================================
   NAVIGATEUR + OUTILLAGE DE PAGE
   ========================================================================= */
const jsErrors = [];
/* 401 provoqués volontairement par les scénarios (mot de passe erroné) : ce
   sont les réponses attendues du serveur, pas des défauts de l'application. */
const authNoise = [];
async function launchBrowser() {
  const tries = [
    () => chromium.launch({ channel: "msedge" }),
    () => chromium.launch({ channel: "chrome" }),
    () => chromium.launch(),
  ];
  let last = null;
  for (const t of tries) { try { return await t(); } catch (e) { last = e; } }
  throw last;
}

async function newPlayer(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => jsErrors.push(`[${label}] pageerror: ` + String(e.message).split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    /* Un 401 renvoyé par /api/auth/login est la réponse attendue du test
       négatif d'authentification (mot de passe erroné) : le navigateur le
       journalise comme une ressource en échec. On le compte à part. */
    const where = (m.location && m.location().url) || "";
    const txt = m.text().slice(0, 160);
    if (where.includes("/api/auth/login")) { authNoise.push(txt); return; }
    jsErrors.push(`[${label}] console: ` + txt);
  });
  return { ctx, page, label };
}

async function gotoApp(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#auth-form", { timeout: 20000 });
}

/* Attend qu'une condition JS devienne vraie ; renvoie false au lieu de lever. */
async function until(page, fn, arg, ms) {
  if (typeof arg === "number" && ms === undefined) { ms = arg; arg = null; }
  ms = ms || 10000;
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

const routeOf = (page) => page.evaluate(() => (location.hash || "").replace("#/", "").split("?")[0]);

const stateOf = (page) => page.evaluate(() => {
  const s = window.App.state();
  return {
    id: s.id, pseudo: s.pseudo, elo: s.elo, balance: s.balance, bonusLock: s.bonusLock,
    kyc: s.kyc, currentSession: s.currentSession, playerNum: s.playerNum,
    skins: s.skins, notifUnread: s.notifUnread, bonusUsed: s.bonusUsed,
    route: (location.hash || "").replace("#/", "").split("?")[0],
  };
});

/* Appel REST avec le jeton réellement stocké par la page. */
async function apiFromPage(page, p, method = "GET", body = null) {
  const token = await page.evaluate(() => localStorage.getItem("daona_token"));
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

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

/* =========================================================================
   JOUEURS (chaque joueur = un navigateur isolé : cookies, session, WebSocket)
   ========================================================================= */
const players = {};
const PREFIX = "ZzUi" + String(Math.floor(Math.random() * 900 + 100));
/* Récupère (ou crée) un joueur. Par défaut, le compte est inscrit à la volée :
   chaque scénario peut ainsi être lancé seul (node test_ui_scenarios.js S3). */
async function ensure(browser, label, { signup = true } = {}) {
  let p = players[label];
  if (!p) {
    p = await newPlayer(browser, label);
    p.pseudo = PREFIX + label + Math.floor(Math.random() * 90 + 10);
    players[label] = p;
  }
  if (signup && !p.authed) {
    const r = await uiSignup(p.page, p.pseudo);
    if (r === true) p.authed = true;
  }
  return p;
}

/* =========================================================================
   S1 — AUTHENTIFICATION (inscription, déconnexion, reconnexion)
   ========================================================================= */
async function s1_auth(browser) {
  const A = await ensure(browser, "A", { signup: false });

  await step("inscription d'un compte neuf par le formulaire (2 étapes)", async () => {
    const r = await uiSignup(A.page, A.pseudo);
    if (r === true) A.authed = true;
    return r;
  });

  await step("session ouverte : écran d'authentification masqué + solde de bienvenue 5 000 Ar", async () => {
    if (await visible(A.page, "#auth")) return "l'écran de connexion reste affiché après inscription";
    const s = await stateOf(A.page);
    if (s.pseudo !== A.pseudo) return "pseudo en session inattendu : " + s.pseudo;
    const bal = (await textOf(A.page, "#tb-balance")) || "";
    if (!/5\s?000/.test(bal.replace(/[\u202f\u00a0]/g, " "))) return "solde affiché inattendu : " + bal;
    return true;
  });

  await step("déconnexion par le bouton « Déconnexion » de l'écran Profil", async () => {
    await goScreen(A.page, "profile");
    const btn = A.page.locator("#profile-root button.danger", { hasText: "Déconnexion" });
    if (!(await btn.count())) return "bouton « Déconnexion » introuvable dans le profil";
    await btn.first().click();
    await sleep(900);
    return (await visible(A.page, "#auth")) ? true : "l'écran de connexion n'est pas revenu";
  });

  await step("connexion refusée avec un mauvais mot de passe", async () => {
    const ok = await uiLogin(A.page, A.pseudo, "MauvaisMotDePasse!9");
    if (ok) return "la connexion a réussi avec un mot de passe erroné";
    return (await visible(A.page, "#auth")) ? true : "état incohérent : ni connecté ni sur l'écran de connexion";
  });

  await step("reconnexion réussie avec le bon mot de passe", async () => {
    const ok = await uiLogin(A.page, A.pseudo);
    if (!ok) return "connexion impossible avec le bon mot de passe";
    const s = await stateOf(A.page);
    return s.pseudo === A.pseudo ? true : "pseudo en session inattendu : " + s.pseudo;
  });
}

/* =========================================================================
   S2 — NAVIGATION : chaque écran s'ouvre, s'affiche et se remplit
   ========================================================================= */
const ROUTES = [
  ["home", "Accueil"], ["play", "Jeux"], ["match", "Matchs"], ["ranks", "Classement"],
  ["wallet", "Wallet"], ["profile", "Profil"], ["friends", "Amis"], ["chat", "Messagerie"],
  ["notifications", "Notifications"], ["tournament", "Tournois"],
];
async function s2_nav(browser) {
  const A = await ensure(browser, "A");

  for (const [route, label] of ROUTES) {
    await step(`écran « ${label} » (#/${route}) s'ouvre et affiche du contenu`, async () => {
      if (!(await goScreen(A.page, route))) return "l'écran ne devient pas actif";
      const info = await A.page.evaluate((r) => {
        const root = document.getElementById(r + "-root");
        if (!root) return { err: "racine #" + r + "-root absente" };
        return { html: root.innerHTML.length };
      }, route);
      if (info.err) return info.err;
      if (info.html < 40) return "écran rendu vide (contenu " + info.html + " caractères)";
      return true;
    });
  }

  await step("la barre d'onglets reste accessible sur l'accueil", async () => {
    await goScreen(A.page, "home");
    return (await visible(A.page, "#mainTabbar")) ? true : "barre d'onglets invisible sur l'accueil";
  });
}

/* =========================================================================
   S3 — ENTRAÎNEMENT CONTRE L'IA : assistant, plateau, tirage au sort, coups
   ========================================================================= */
async function wizard(page, { mode = "ai", fmt = "blitz" }) {
  await goScreen(page, "play");
  if (!(await visible(page, "#pg-cta"))) return "bouton principal de l'assistant absent";
  await page.click("#pg-cta");
  await sleep(400);
  const opt = page.locator(`#play-root .pg-opt[data-mode="${mode}"]`);
  if (!(await opt.count())) return `aucune option de mode « ${mode} » à l'étape 2`;
  await opt.first().click();
  await sleep(400);
  await page.click("#pg-cta");
  await sleep(400);
  const f = page.locator(`#play-root .pg-fmt[data-fmt="${fmt}"]`);
  if (!(await f.count())) return `aucun format « ${fmt} » à l'étape 3`;
  const cls = (await f.first().getAttribute("class")) || "";
  if (/off/.test(cls)) return `format « ${fmt} » indisponible pour ce mode`;
  await f.first().click();
  await sleep(350);
  await page.click("#pg-cta");
  await sleep(450);
  return true;
}

async function s3_ai(browser) {
  const A = await ensure(browser, "A");

  await step("assistant de jeu : 4 étapes franchies au clic (mode Entraînement IA)", async () => {
    const r = await wizard(A.page, { mode: "ai", fmt: "blitz" });
    if (r !== true) return r;
    const label = await textOf(A.page, "#pg-cta");
    if (!/entraînement/i.test(label || "")) return "libellé final du bouton inattendu : " + label;
    return true;
  });

  await step("lancement : le plateau s'ouvre avec 45 cases et 22 pions de chaque côté", async () => {
    await A.page.click("#pg-cta");
    await sleep(1300);
    if (!(await visible(A.page, "#fanorona-board"))) return "le plateau n'est pas affiché";
    const c = await pieceCounts(A.page);
    if (c.cells !== 45) return `grille incomplète : ${c.cells} cases cliquables (45 attendues)`;
    if (c.me !== 22 || c.opp !== 22) return `pions posés : ${c.me} contre ${c.opp} (22 / 22 attendus)`;
    return true;
  });

  await step("tirage au sort : la modale PILE / FACE est proposée et le choix est accepté", async () => {
    const m = await modalText(A.page);
    if (!/pile|face/i.test(m)) return "aucune modale de tirage au sort : « " + m.slice(0, 70) + " »";
    const enabled = await A.page.evaluate(() => {
      const b = ["choose-pile", "choose-face"]
        .map((id) => document.getElementById(id))
        .filter((e) => e && !e.disabled && e.offsetParent !== null);
      return b.length ? b[0].id : null;
    });
    if (!enabled) return "les deux faces sont indisponibles (tirage bloqué)";
    await A.page.click("#" + enabled);
    const closed = await modalClosed(A.page, 10000);
    return closed ? true : "la modale de tirage ne se referme pas (résultat du tirage affiché durablement)";
  });

  await step("un coup joué au clic est accepté par le plateau", async () => {
    const myTurn = await until(A.page, () => {
      const g = window.Fanorona.state();
      return !!g && !g.over && g.turn === g.playerNum;
    }, 15000);
    if (!myTurn) return "le joueur n'obtient jamais la main après le tirage";
    if (await modalOpen(A.page)) {
      const m = await modalText(A.page);
      return "une fenêtre recouvre le plateau au moment de jouer : « " + m.slice(0, 70) + " »";
    }
    const before = (await boardState(A.page)).log;
    const mv = await playMove(A.page);
    if (!mv) return "aucun coup légal cliquable trouvé";
    if (!mv.retenu) {
      return `le clic n'a pas été retenu par le plateau (coup ${mv.from} → ${mv.to}` +
        (mv.avis ? " ; interface : " + mv.avis : "") + ")";
    }
    const after = (await boardState(A.page)).log;
    return after > before ? true : "le coup joué n'est pas inscrit au journal des coups";
  });

  await step("l'IA répond automatiquement à son tour", async () => {
    const replied = await until(A.page, () =>
      document.querySelectorAll("#move-log li").length >= 2, 15000);
    if (!replied) return "aucune réponse de l'IA inscrite au journal des coups";
    return (await textOf(A.page, "#turn-banner-name")) !== null ? true : "bandeau de tour illisible";
  });

  await step("abandon : confirmation puis écran de résultat affiché", async () => {
    await A.page.click("#btn-resign");
    await sleep(500);
    if (!(await visible(A.page, "#resign-ok"))) return "la confirmation d'abandon ne s'affiche pas";
    await A.page.click("#resign-ok");
    await sleep(1300);
    const m = await modalText(A.page);
    if (!/abandon|résultat|Défaite|Victoire|partie/i.test(m)) return "aucun résultat après abandon : « " + m.slice(0, 70) + " »";
    return true;
  });

  await step("après la partie : aucune partie fantôme encore active", async () => {
    await A.page.keyboard.press("Escape");
    await sleep(400);
    await goScreen(A.page, "home");
    const g = await boardState(A.page);
    if (g && !g.over) return "une partie est encore active alors qu'elle est terminée";
    return true;
  });
}

/* =========================================================================
   S4 — AMIS : recherche, demande, acceptation, liste
   ========================================================================= */
async function uiAddFriend(from, toPseudo) {
  await goScreen(from.page, "friends");
  const q = from.page.locator("#friend-q");
  if (!(await q.count())) return "champ de recherche d'ami absent";
  await q.first().fill(toPseudo);
  await q.first().press("Enter");
  const shown = await until(from.page, (p) => !!document.querySelector(`#friend-results [data-add="${p}"]`), toPseudo, 9000);
  if (!shown) return `le joueur ${toPseudo} n'apparaît pas dans les résultats de recherche`;
  await from.page.locator(`#friend-results [data-add="${toPseudo}"]`).first().click();
  await sleep(900);
  const sent = await from.page.evaluate((p) => {
    const el = document.querySelector(`#friend-results [data-add="${p}"]`);
    if (!el) return true;                          // la ligne a été remplacée : demande prise en compte
    return /envoyée|attente|ami/i.test(el.parentElement.innerText);
  }, toPseudo);
  return sent ? true : "la demande d'ami n'a pas été enregistrée par l'interface";
}

async function s4_friends(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B", { signup: false });

  await step("le second joueur s'inscrit (compte neuf, navigateur isolé)", async () => {
    const r = await uiSignup(B.page, B.pseudo);
    if (r === true) B.authed = true;
    return r;
  });

  await step("recherche d'un joueur par son pseudo et envoi de la demande d'ami", () => uiAddFriend(A, B.pseudo));

  await step("le destinataire voit la demande entrante dans son écran Amis", async () => {
    await goScreen(B.page, "friends");
    const seen = await until(B.page, () => {
      const p = document.getElementById("freq-panel");
      return !!p && !!p.querySelector("[data-accept]") && /ami/i.test(p.innerText);
    }, 9000);
    if (!seen) return "aucune demande entrante affichée dans le panneau des invitations";
    const txt = await textOf(B.page, "#freq-panel");
    return new RegExp(A.pseudo, "i").test(txt) ? true : "la demande affichée ne vient pas du bon joueur";
  });

  await step("acceptation de la demande : les deux joueurs deviennent amis", async () => {
    await B.page.locator("#freq-panel [data-accept]").first().click();
    await sleep(1400);
    await goScreen(B.page, "friends");
    const okB = await until(B.page, (p) => {
      const l = document.getElementById("friends-list");
      return !!l && l.innerText.includes(p);
    }, A.pseudo, 9000);
    if (!okB) return "l'ami accepté n'apparaît pas dans la liste côté destinataire";
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(1800);
    await goScreen(A.page, "friends");
    const okA = await until(A.page, (p) => {
      const l = document.getElementById("friends-list");
      return !!l && l.innerText.includes(p);
    }, B.pseudo, 9000);
    if (!okA) return "l'amitié n'est pas visible côté demandeur (liste des amis)";
    return true;
  });

  await step("l'API confirme l'amitié dans les deux sens", async () => {
    const d = await apiFromPage(A.page, "/api/friends");
    const list = (d.json && (d.json.friends || d.json)) || [];
    return JSON.stringify(list).includes(B.pseudo)
      ? true : "l'amitié est absente de l'API des amis : " + JSON.stringify(list).slice(0, 120);
  });
}

/* =========================================================================
   S5 — PARTIE CLASSÉE EN LIGNE (matchmaking et tirage au sort)
   ========================================================================= */
const waitVisible = (page, sel, ms = 25000) => until(page, (s) => {
  const e = document.querySelector(s);
  return !!e && e.offsetParent !== null;
}, sel, ms);

async function s5_online(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");
  const C = await ensure(browser, "C", { signup: false });

  await step("le troisième joueur s'inscrit et devient ami avec le premier (pour le spectacle)", async () => {
    const r = await uiSignup(C.page, C.pseudo);
    if (r !== true) return r;
    C.authed = true;
    const add = await uiAddFriend(C, A.pseudo);
    if (add !== true) return add;
    await goScreen(A.page, "friends");
    const seen = await until(A.page, () => {
      const p = document.getElementById("freq-panel");
      return !!p && !!p.querySelector("[data-accept]");
    }, 9000);
    if (!seen) return "la demande d'ami n'est pas arrivée chez le premier joueur";
    await A.page.locator("#freq-panel [data-accept]").first().click();
    await sleep(1400);
    return true;
  });

  await step("les deux joueurs lancent la recherche d'adversaire classée", async () => {
    for (const P of [A, B]) {
      const r = await wizard(P.page, { mode: "online", fmt: "blitz" });
      if (r !== true) return `assistant indisponible pour ${P.pseudo} : ${r}`;
      await P.page.click("#pg-cta");
    }
    await sleep(1400);
    const m = await modalText(A.page);
    if (!/recherche|adversaire/i.test(m)) return "aucun retour d'interface pendant la recherche : « " + m.slice(0, 70) + " »";
    return true;
  });

  await step("le serveur apparie les deux joueurs et propose la même partie des deux côtés", async () => {
    const okA = await waitVisible(A.page, "#mm-accept", 30000);
    const okB = await waitVisible(B.page, "#mm-accept", 30000);
    if (!okA || !okB) return `proposition de match absente (joueur 1 : ${okA}, joueur 2 : ${okB})`;
    const tA = await modalText(A.page);
    const tB = await modalText(B.page);
    if (!tA.includes(B.pseudo)) return `adversaire annoncé faux chez le premier joueur : « ${tA.slice(0, 60)} »`;
    if (!tB.includes(A.pseudo)) return `adversaire annoncé faux chez le second joueur : « ${tB.slice(0, 60)} »`;
    return true;
  });

  await step("les deux joueurs acceptent le match", async () => {
    await A.page.click("#mm-accept");
    await B.page.click("#mm-accept");
    const okA = await waitVisible(A.page, "#choose-pile", 25000);
    const okB = await waitVisible(B.page, "#choose-pile", 25000);
    if (!okA || !okB) return `modale de tirage au sort absente (joueur 1 : ${okA}, joueur 2 : ${okB})`;
    return true;
  });

  await step("tirage au sort : chaque joueur choisit une face différente", async () => {
    const pick = async (page, preferred) => {
      const id = await page.evaluate((pref) => {
        const other = pref === "choose-pile" ? "choose-face" : "choose-pile";
        const ids = pref ? [pref, other] : ["choose-pile", "choose-face"];
        for (const i of ids) {
          const e = document.getElementById(i);
          if (e && !e.disabled && e.offsetParent !== null) return i;
        }
        return null;
      }, preferred);
      if (!id) return null;
      await page.click("#" + id);
      await sleep(800);
      return id;
    };
    const a = await pick(A.page, "choose-pile");
    if (!a) return "le premier joueur ne peut choisir aucune face";
    const b = await pick(B.page, a === "choose-pile" ? "choose-face" : "choose-pile");
    if (!b) return "le second joueur ne peut choisir la face restante";
    if (a === b) return "les deux joueurs ont pu choisir la même face";
    return true;
  });

  await step("le plateau en ligne est prêt : 22 pions par camp et numéros distincts", async () => {
    const ready = (page) => until(page, () => {
      const g = window.Fanorona.state();
      return !!g && !g.over && !g.spectator && document.querySelectorAll(".piece.me").length > 0;
    }, 25000);
    if (!(await ready(A.page))) return "le plateau ne s'ouvre pas chez le premier joueur";
    if (!(await ready(B.page))) return "le plateau ne s'ouvre pas chez le second joueur";
    const ca = await pieceCounts(A.page), cb = await pieceCounts(B.page);
    for (const [n, c] of [["joueur 1", ca], ["joueur 2", cb]]) {
      if (c.me !== 22 || c.opp !== 22) return `${n} : ${c.me} pions contre ${c.opp} (22 / 22 attendus)`;
    }
    const sa = await boardState(A.page), sb = await boardState(B.page);
    if (sa.playerNum === sb.playerNum) return `les deux joueurs ont le même numéro (${sa.playerNum})`;
    if (sa.mode !== "online") return "le mode de la partie n'est pas « online » : " + sa.mode;
    return true;
  });
}

/* =========================================================================
   S6 — SUITE DE LA PARTIE EN LIGNE : coups diffusés, spectateur, abandon
   ========================================================================= */
async function s6_online_play(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");
  const C = await ensure(browser, "C");
  let mover = null, other = null;

  await step("le joueur qui a la main joue un coup au clic", async () => {
    const sa = await boardState(A.page), sb = await boardState(B.page);
    if (!sa || !sb) return "aucun plateau lisible";
    mover = sa.turn === sa.playerNum ? A : B;
    other = mover === A ? B : A;
    const before = await boardState(other.page);
    const mv = await playMove(mover.page);
    if (!mv) return "aucun coup légal cliquable côté joueur ayant la main";
    if (!mv.retenu) {
      return `le clic n'a pas été retenu par le plateau (coup ${mv.from} → ${mv.to}` +
        (mv.avis ? " ; interface : " + mv.avis : "") + ")";
    }
    await sleep(1500);
    const after = await boardState(other.page);
    const vu = after.log > before.log || after.moves > before.moves;
    return vu ? true
      : `le coup n'est pas parvenu à l'adversaire (journal ${before.log} → ${after.log}, ` +
        `coups officiels ${before.moves} → ${after.moves})`;
  });

  await step("le plateau de l'adversaire reflète exactement la même partie", async () => {
    const sa = await boardState(A.page), sb = await boardState(B.page);
    if (sa.moves !== sb.moves) return `coups désynchronisés : ${sa.moves} contre ${sb.moves}`;
    if (sa.log !== sb.log) return `journaux de coups désynchronisés : ${sa.log} contre ${sb.log}`;
    const ca = await pieceCounts(A.page), cb = await pieceCounts(B.page);
    if (ca.me !== cb.opp || ca.opp !== cb.me) {
      return `pions désynchronisés : ${ca.me}/${ca.opp} contre ${cb.me}/${cb.opp}`;
    }
    return (await visible(A.page, "#lastmove")) ? true : "la trace du dernier coup n'est pas affichée";
  });

  await step("le troisième joueur voit la partie en direct dans Matchs", async () => {
    await goScreen(C.page, "match");
    const listed = await until(C.page, () => {
      const r = document.getElementById("live-games-root");
      return !!r && /Regarder/.test(r.innerText);
    }, 15000);
    return listed ? true : "la partie en cours n'apparaît pas dans les matchs en direct";
  });

  await step("il peut regarder la partie : plateau en lecture seule affiché", async () => {
    await C.page.locator('#live-games-root button[onclick*="spectate"]').first().click();
    await sleep(1800);
    if (!(await visible(C.page, "#fanorona-board"))) return "le plateau du spectateur ne s'affiche pas";
    const st = await boardState(C.page);
    if (!st) return "aucun état de partie pour le spectateur";
    if (!st.spectator) return "le mode spectateur n'est pas activé sur le plateau";
    const c = await pieceCounts(C.page);
    return c.me + c.opp >= 1 ? true : "aucun pion affiché pour le spectateur";
  });

  await step("un spectateur ne peut pas jouer : un clic ne change pas le plateau", async () => {
    const before = await boardState(C.page);
    const cells = await C.page.evaluate(() => {
      const g = window.Fanorona.state();
      const out = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) if (g.grid[r][c]) out.push([r, c]);
      return out.slice(0, 4);
    });
    if (cells.length >= 2) {
      await C.page.click(`#cells .cell[data-r="${cells[0][0]}"][data-c="${cells[0][1]}"]`).catch(() => {});
      await sleep(250);
      await C.page.click(`#cells .cell[data-r="${cells[1][0]}"][data-c="${cells[1][1]}"]`).catch(() => {});
      await sleep(900);
    }
    const after = await boardState(C.page);
    if (after.moves !== before.moves || after.log !== before.log) {
      return "le spectateur a pu jouer un coup : lecture seule non respectée";
    }
    const meme = JSON.stringify(after.grid) === JSON.stringify(before.grid);
    return meme ? true : "le plateau du spectateur a changé après ses clics";
  });

  await step("abandon : la fin de partie est annoncée aux deux joueurs", async () => {
    await mover.page.click("#btn-resign");
    await sleep(600);
    if (!(await visible(mover.page, "#resign-ok"))) return "confirmation d'abandon non affichée";
    await mover.page.click("#resign-ok");
    await sleep(2800);
    const tMover = await modalText(mover.page);
    const tOther = await modalText(other.page);
    if (!/abandon|Défaite|Victoire|partie/i.test(tMover)) return "aucun résultat chez celui qui abandonne : « " + tMover.slice(0, 70) + " »";
    if (!/abandon|Défaite|Victoire|partie/i.test(tOther)) return "aucun résultat chez l'adversaire : « " + tOther.slice(0, 70) + " »";
    if (!/abandon/i.test(tOther + tMover)) return "le motif d'abandon n'est pas indiqué";
    return true;
  });

  await step("l'écran de résultat peut être refermé et le plateau libéré", async () => {
    const a = await dismissModals(mover.page);
    const b = await dismissModals(other.page);
    if (!a || !b) return `la fenêtre de résultat reste bloquée (joueur 1 : ${a}, joueur 2 : ${b})`;
    await goScreen(A.page, "home");
    return (await visible(A.page, "#home-root")) ? true : "l'accueil n'est pas accessible après la partie";
  });

  await step("la partie est archivée et l'Elo est enregistré", async () => {
    const d = await apiFromPage(other.page, "/api/user");
    const s = d.json && d.json.user ? d.json.user : d.json;
    if (!s || typeof s.elo !== "number") return "profil Elo illisible après la partie";
    const h = await apiFromPage(other.page, "/api/games/history");
    const list = (h.json && (h.json.games || h.json)) || [];
    return Array.isArray(list) && list.length >= 1 ? true : "l'historique des parties est vide après la partie";
  });
}

/* =========================================================================
   S7 — WALLET : KYC obligatoire, dépôt, retrait, historique
   ========================================================================= */
async function s7_wallet(browser) {
  const A = await ensure(browser, "A");
  let before = 0;

  await step("le bouton de la barre du haut ouvre le wallet", async () => {
    await goScreen(A.page, "home");
    await dismissModals(A.page);
    const b = A.page.locator("#tb-wallet");
    if (!(await b.count())) return "bouton wallet absent de la barre du haut";
    await b.first().click();
    await sleep(1000);
    return (await visible(A.page, "#wallet-root")) ? true : "l'écran wallet ne s'ouvre pas depuis la barre du haut";
  });

  await step("le dépôt exige d'abord la vérification d'identité (KYC)", async () => {
    const s = await stateOf(A.page);
    if (s.kyc) return "test invalide : ce compte est déjà vérifié";
    await A.page.locator("#wallet-root button", { hasText: "Déposer" }).first().click();
    await sleep(1100);
    const m = await modalText(A.page);
    if (!/vérification d'identité|KYC/i.test(m)) return "aucune demande de KYC avant dépôt : « " + m.slice(0, 70) + " »";
    return (await visible(A.page, "#kyc-upload")) ? true : "bouton de vérification de la CIN absent";
  });

  await step("la vérification d'identité simulée ouvre l'accès au dépôt", async () => {
    await A.page.click("#kyc-upload");
    await sleep(3200);
    const m = await modalText(A.page);
    if (!/déposer/i.test(m)) return "le formulaire de dépôt n'apparaît pas après vérification : « " + m.slice(0, 70) + " »";
    return true;
  });

  await step("le choix du montant met à jour le récapitulatif", async () => {
    const chip = A.page.locator('#modal .amt-chip[data-amt="10000"]');
    if (!(await chip.count())) return "aucun montant proposé dans le formulaire de dépôt";
    await chip.first().click();
    await sleep(450);
    const shown = (await textOf(A.page, "#dep-amt")) || "";
    return /10\s?000/.test(shown.replace(/[\u202f\u00a0]/g, " ")) ? true : "récapitulatif non mis à jour : " + shown;
  });

  await step("le dépôt crédite réellement le wallet et la barre du haut", async () => {
    before = (await stateOf(A.page)).balance;
    await A.page.click("#dep-ok");
    await sleep(3200);
    const s = await stateOf(A.page);
    if (s.balance !== before + 10000) return `solde ${before} -> ${s.balance} (attendu ${before + 10000})`;
    const top = (await textOf(A.page, "#tb-balance")) || "";
    const fmt = new Intl.NumberFormat("fr-FR").format(s.balance).replace(/[\u202f\u00a0]/g, " ");
    return top.replace(/[\u202f\u00a0]/g, " ").includes(fmt)
      ? true : "la barre du haut n'affiche pas le nouveau solde : " + top;
  });

  await step("le retrait est débloqué et débite le solde", async () => {
    await A.page.locator("#wallet-root button", { hasText: "Retirer" }).first().click();
    await sleep(1100);
    if (!(await visible(A.page, "#wd-amount"))) {
      const m = await modalText(A.page);
      return "le formulaire de retrait ne s'ouvre pas : « " + m.slice(0, 70) + " »";
    }
    await A.page.fill("#wd-amount", "2000");
    await sleep(250);
    await A.page.click("#wd-ok");
    await sleep(3200);
    const s = await stateOf(A.page);
    if (s.balance === before + 10000 - 2000) return true;
    const t = (await toasts(A.page)).join(" | ");
    return `solde ${before + 10000} -> ${s.balance} (attendu ${before + 8000})${t ? " — message : " + t : ""}`;
  });

  await step("l'historique des transactions contient le dépôt", async () => {
    const d = await apiFromPage(A.page, "/api/transactions");
    const list = (d.json && (d.json.transactions || d.json)) || [];
    const found = Array.isArray(list) && list.some((t) => /d[ée]p[oô]t|deposit/i.test(JSON.stringify(t)));
    return found ? true : "aucun dépôt dans l'historique : " + JSON.stringify(list).slice(0, 140);
  });
}

/* =========================================================================
   S8 — BOUTIQUE DE SKINS : achat, débit du wallet, équipement
   ========================================================================= */
async function s8_skins(browser) {
  const A = await ensure(browser, "A");

  await step("la boutique de skins est affichée sur le profil", async () => {
    await goScreen(A.page, "profile");
    const n = await A.page.locator("#profile-root .skin-card").count();
    return n >= 6 ? true : "boutique incomplète : " + n + " skins affichés (6 attendus)";
  });

  await step("l'achat d'un skin débite le wallet et l'enregistre comme possédé", async () => {
    const before = (await stateOf(A.page)).balance;
    const btn = A.page.locator('#profile-root button[onclick*="buySkin"]').first();
    if (!(await btn.count())) return "aucun bouton « Acheter » dans la boutique";
    const id = ((await btn.getAttribute("onclick")) || "").match(/buySkin\('([^']+)'\)/);
    if (!id) return "bouton d'achat sans identifiant de skin";
    await btn.first().click();
    await sleep(3200);
    const s = await stateOf(A.page);
    const owned = (s.skins && s.skins.owned) || [];
    if (!owned.includes(id[1])) return `le skin ${id[1]} n'est pas enregistré comme possédé : ${JSON.stringify(owned)}`;
    if (s.balance >= before) return `le wallet n'a pas été débité (${before} -> ${s.balance})`;
    return true;
  });

  await step("le skin acheté peut être équipé", async () => {
    const btn = A.page.locator('#profile-root button[onclick*="equipSkin"]').first();
    if (!(await btn.count())) return "aucun bouton « Équiper » après l'achat";
    const id = ((await btn.getAttribute("onclick")) || "").match(/equipSkin\('([^']+)'\)/);
    if (!id) return "bouton d'équipement sans identifiant de skin";
    await btn.first().click();
    await sleep(2200);
    const s = await stateOf(A.page);
    const eq = JSON.stringify((s.skins && s.skins.equipped) || {});
    return eq.includes(id[1]) ? true : "le skin n'est pas marqué équipé : " + eq;
  });
}

/* =========================================================================
   S9 — TOURNOIS : liste, détail (bracket), inscription et débit de la mise
   ========================================================================= */
async function s9_tournament(browser) {
  const A = await ensure(browser, "A");
  let tid = null;

  await step("l'écran Matchs liste les tournois disponibles", async () => {
    await goScreen(A.page, "match");
    const n = await A.page.locator("#match-root .tn-card").count();
    return n >= 1 ? true : "aucune carte de tournoi affichée";
  });

  await step("le détail d'un tournoi s'ouvre (écran Tournois : mise, places, bracket)", async () => {
    const b = A.page.locator('#match-root button[onclick*="openTournament"]').first();
    if (!(await b.count())) return "aucun bouton « Détail & bracket »";
    await b.click();
    const opened = await until(A.page, () => /^tournament/.test((location.hash || "").replace("#/", "")), 10000);
    if (!opened) return "l'écran de détail ne s'ouvre pas (route actuelle : " + (await routeOf(A.page)) + ")";
    await sleep(1300);
    const txt = (await textOf(A.page, "#tournament-root")) || "";
    if (txt.length < 40) return "écran de détail vide (contenu " + txt.length + " caractères)";
    if (!/bracket|mise|place|joueur|inscri|tournoi/i.test(txt)) return "contenu du détail inattendu : « " + txt.slice(0, 80) + " »";
    await goScreen(A.page, "match");
    return true;
  });

  await step("un tournoi déjà commencé ou terminé n'offre plus d'inscription", async () => {
    const bad = await A.page.evaluate(() => {
      const out = [];
      document.querySelectorAll("#match-root .tn-card").forEach((c) => {
        const pill = ((c.querySelector(".pill.amber") || {}).textContent || "").trim();
        const join = c.querySelector("button[onclick*='joinTournament']");
        if (/Terminé|En cours/.test(pill) && join) out.push(pill + " : " + (c.querySelector("h3") || {}).textContent);
      });
      return out;
    });
    if (bad.length) return "des inscriptions restent proposées — " + bad.join(" ; ");
    return true;
  });

  await step("inscription au tournoi ouvert : la mise est débitée du wallet", async () => {
    const btn = A.page.locator(`#match-root button[onclick*="joinTournament('${TID_UI}')"]`).first();
    if (!(await btn.count())) return "le tournoi ouvert de la campagne n'est pas proposé à l'inscription";
    tid = TID_UI;
    const d = await apiFromPage(A.page, "/api/tournaments");
    const list = (d.json && (d.json.tournaments || d.json)) || [];
    const t = Array.isArray(list) ? list.find((x) => Number(x.id) === tid) : null;
    const entry = t ? Number(t.entry || 0) : 0;
    const s0 = await stateOf(A.page);
    /* Le serveur crédite 1 000 Ar de bonus de bienvenue à la PREMIÈRE
       inscription payante (server.js) : le solde net ne baisse alors que de
       (mise - 1 000 Ar). */
    const expectBonus = (!s0.bonusUsed && entry > 0) ? 1000 : 0;
    const before = s0.balance;
    await btn.click();
    await sleep(3200);
    const after = (await stateOf(A.page)).balance;
    if (entry && after !== before - entry + expectBonus) {
      const txt = (await toasts(A.page)).join(" | ");
      const tx = await apiFromPage(A.page, "/api/transactions");
      const list = (tx.json && (tx.json.transactions || tx.json)) || [];
      const last = list.slice(0, 3).map((x) => `${x.dir} ${x.amount} ${x.label}`).join(" ; ");
      return `solde ${before} -> ${after} (attendu ${before - entry + expectBonus} = mise ${entry} - bonus ${expectBonus})` +
        (txt ? " — message : " + txt : "") + (last ? " — écritures : " + last : " — aucune écriture");
    }
    const my = await apiFromPage(A.page, "/api/tournaments/my");
    const mine = JSON.stringify(my.json || {});
    return tid !== null && mine.includes(String(tid)) ? true : "l'inscription n'est pas enregistrée : " + mine.slice(0, 130);
  });

  await step("l'inscription est confirmée à l'écran", async () => {
    await goScreen(A.page, "match");
    const shown = await until(A.page, () => /inscrit/i.test(document.getElementById("match-root").innerText), 10000);
    return shown ? true : "aucune mention « inscrit » affichée après l'inscription";
  });
}

/* =========================================================================
   S10 — NOTIFICATIONS : badge, liste, lecture unitaire, tout lire
   ========================================================================= */
async function s10_notifications(browser) {
  const A = await ensure(browser, "A");

  await step("la cloche de la barre du haut porte le compteur de non-lues", async () => {
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2400);
    const c = (await A.page.getAttribute("#btn-notif", "data-count")) || "";
    if (!c) return "aucun compteur affiché alors qu'une inscription au tournoi a eu lieu";
    return Number(c) >= 1 ? true : "compteur inattendu : " + c;
  });

  await step("l'écran Notifications s'ouvre depuis la cloche et liste les événements", async () => {
    await A.page.click("#btn-notif");
    await sleep(1500);
    if (!(await visible(A.page, "#notifications-root"))) return "l'écran Notifications ne s'ouvre pas depuis la cloche";
    const n = await A.page.locator("#notifications-root .feed-item").count();
    if (n < 1) return "aucune notification listée";
    const txt = await textOf(A.page, "#notifications-root");
    return /inscri/i.test(txt || "") ? true : "la notification d'inscription est absente : « " + (txt || "").slice(0, 90) + " »";
  });

  await step("marquer une notification comme lue décrémente le compteur", async () => {
    const before = Number((await A.page.getAttribute("#btn-notif", "data-count")) || 0);
    const btn = A.page.locator('#notifications-root button[onclick*="readNotification"]').first();
    if (!(await btn.count())) return "aucun bouton « Marquer lu » sur les notifications non lues";
    await btn.click();
    await sleep(2000);
    const after = Number((await A.page.getAttribute("#btn-notif", "data-count")) || 0);
    return after === before - 1 ? true : `compteur ${before} -> ${after} (attendu ${before - 1})`;
  });

  await step("« Tout marquer lu » vide le compteur", async () => {
    const btn = A.page.locator("#notifications-root button", { hasText: "Tout marquer lu" });
    if (!(await btn.count())) return "bouton « Tout marquer lu » absent";
    await btn.first().click();
    await sleep(2000);
    const c = (await A.page.getAttribute("#btn-notif", "data-count")) || "";
    if (c !== "") return "le compteur n'est pas vidé : " + c;
    const txt = await textOf(A.page, "#notifications-root");
    return /0 non lue/i.test(txt || "") ? true : "l'en-tête n'annonce pas 0 non lue : « " + (txt || "").slice(0, 60) + " »";
  });
}

/* =========================================================================
   S11 — MESSAGERIE : dock flottant, envoi et réception en temps réel
   ========================================================================= */
async function s11_chat(browser) {
  const A = await ensure(browser, "A");
  const C = await ensure(browser, "C");

  await step("le tiroir de messagerie s'ouvre et liste les joueurs connus", async () => {
    await goScreen(A.page, "home");
    await dismissModals(A.page);
    await A.page.click("#chat-fab");
    await sleep(1200);
    const txt = await textOf(A.page, "#chat-tray");
    if (!txt) return "le tiroir de messagerie ne s'ouvre pas (aucun contenu)";
    return new RegExp(C.pseudo, "i").test(txt) ? true : "aucun joueur connu listé : « " + txt.slice(0, 90) + " »";
  });

  await step("un message envoyé depuis la Messagerie apparaît dans la conversation", async () => {
    await goScreen(A.page, "chat");
    const ouvert = await openConversation(A.page, C.pseudo);
    if (ouvert !== true) return ouvert;
    await sleep(700);
    const txt = "Message de test " + Math.floor(Math.random() * 9000 + 1000);
    await A.page.fill("#chat-field", txt);
    await A.page.click("#chat-send");
    await sleep(1800);
    const msgs = (await textOf(A.page, "#chat-msgs")) || "";
    return msgs.includes(txt) ? true : "le message envoyé n'apparaît pas dans la conversation";
  });

  await step("le message arrive chez le destinataire en temps réel", async () => {
    const txt = await A.page.evaluate(() => {
      const m = document.querySelectorAll("#chat-msgs .msg");
      return m.length ? m[m.length - 1].innerText.trim() : null;
    });
    if (!txt) return "impossible de relire le message envoyé";
    /* Réception en temps réel : le destinataire ouvre la conversation avec
       l'expéditeur et doit y voir le message. */
    const fenetre = await uiOpenChatPopup(C.page, A.pseudo);
    if (fenetre !== true) return fenetre;
    const vu = await until(C.page, ([p, t]) => {
      const el = document.querySelector(`.cp-msgs[data-pop="${p}"]`);
      return !!el && el.innerText.includes(t);
    }, [A.pseudo, txt], 14000);
    return vu ? true : "le message n'est pas arrivé chez le destinataire";
  });
}

/* =========================================================================
   PILOTE DE LA CAMPAGNE
   ========================================================================= */
const SCENARIOS = [
  ["S1", "Authentification : inscription, session, déconnexion, reconnexion", () => s1_auth(BROWSER)],
  ["S2", "Navigation : chaque écran s'ouvre et se remplit", () => s2_nav(BROWSER)],
  ["S3", "Entraînement contre l'IA : assistant, plateau, tirage au sort, coups", () => s3_ai(BROWSER)],
  ["S4", "Amis : recherche, demande, acceptation, liste", () => s4_friends(BROWSER)],
  ["S5", "Partie classée en ligne : matchmaking et tirage au sort", () => s5_online(BROWSER)],
  ["S6", "Partie en ligne : coups diffusés, spectateur, abandon", () => s6_online_play(BROWSER)],
  ["S7", "Wallet : KYC, dépôt, retrait, historique", () => s7_wallet(BROWSER)],
  ["S8", "Boutique de skins : achat, débit, équipement", () => s8_skins(BROWSER)],
  ["S9", "Tournois : liste, détail, inscription", () => s9_tournament(BROWSER)],
  ["S10", "Notifications : badge, liste, lecture, tout lire", () => s10_notifications(BROWSER)],
  ["S11", "Messagerie : dock, envoi et réception temps réel", () => s11_chat(BROWSER)],
];
let BROWSER = null;

(async () => {
  console.log("D-aôna — CAMPAGNE DE TESTS D'INTERFACE (navigateur réel)");
  console.log("======================================================");
  const db = snapshotDb();
  prepareFixture(db);
  const child = startServer(db);
  try {
    await waitServer();
    console.log("Serveur de test prêt sur " + BASE + " — base jetable : " + db);
    BROWSER = await launchBrowser();

    /* Plusieurs scénarios d'un coup : node test_ui_scenarios.js S5,S6 */
    const WANTED = ONLY.split(",").map((s) => s.trim()).filter(Boolean);
    for (const [id, title, fn] of SCENARIOS) {
      if (WANTED.length && !WANTED.includes(id)) continue;
      scen(id, title);
      try {
        await fn();
      } catch (e) {
        const note = String((e && e.message) || e).split("\n")[0].slice(0, 180);
        results.push({ id, label: "exception de scénario", ok: false, ms: 0, note });
        console.log("  ECHEC  exception de scénario   <-- " + note);
      }
      await sleep(250);
    }

    scen("SX", "Hygiène : version servie et absence d'erreur JavaScript");
    await step("le serveur sert bien la version courante de l'interface (correctifs présents)", async () => {
      const html = await (await fetch(BASE + "/")).text();
      const missing = [];
      if (!/v === meVal\(\) \? "me"/.test(html)) missing.push("couleur des pions selon le joueur");
      if (!/setTxt\("dep-amt"/.test(html)) missing.push("récapitulatif du dépôt");
      if (!/Inscriptions closes/.test(html)) missing.push("tournoi fermé non inscriptible");
      if (!/if \(!API\.getToken\(\)\) return;/.test(html)) missing.push("pas de requête sans session");
      return missing.length === 0 ? true : "correctifs absents du fichier servi : " + missing.join(", ");
    });
    await step("le mot de passe erroné est bien refusé par le serveur (401 attendu, hors erreurs applicatives)",
      () => (WANTED.length && !WANTED.includes("S1")) ? true
        : authNoise.length > 0 ? true
        : "aucun 401 enregistré : le test négatif d'authentification n'a pas atteint le serveur");
    const uniqErr = [...new Set(jsErrors)];
    await step("aucune erreur JavaScript ni console.error dans les navigateurs de test",
      () => uniqErr.length === 0 ? true : uniqErr.slice(0, 3).join(" | ").slice(0, 320));
  } catch (e) {
    console.log("\nERREUR FATALE DE CAMPAGNE : " + ((e && e.message) || e));
  } finally {
    if (BROWSER) await BROWSER.close().catch(() => {});
    await stopServer(child);
    cleanup();
  }

  /* ---------------- RAPPORT ---------------- */
  const total = results.length;
  const ko = results.filter((r) => !r.ok);
  console.log("\n======================================================");
  console.log(`RÉSULTAT : ${total - ko.length}/${total} vérifications réussies`);
  if (ko.length) {
    console.log("\nÉCHECS DÉTAILLÉS :");
    for (const r of ko) console.log(`  [${r.id}] ${r.label}\n        -> ${r.note}`);
    const byId = {};
    for (const r of ko) byId[r.id] = (byId[r.id] || 0) + 1;
    console.log("\nRÉCAPITULATIF : " + Object.entries(byId).map(([k, v]) => `${k} (${v})`).join(" · "));
  }
  console.log(ko.length ? "\nDes éléments d'interface sont en défaut (voir ci-dessus)." : "\nTous les parcours d'interface passent.");
  process.exit(ko.length ? 1 : 0);
})();
