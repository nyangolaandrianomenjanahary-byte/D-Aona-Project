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
    env: {
      ...process.env,
      D_AONA_PORT: String(PORT),
      D_AONA_DB_PATH: dbPath,
      /* Le quota d'authentification n'est PAS ce que ces scénarios mesurent
         (test_auth.js s'en charge, sur le serveur réel). Une campagne qui inscrit
         une dizaine de comptes depuis la même IP finissait par se limiter
         elle-même en 429, et l'échec se propageait à tout le scénario suivant. */
      D_AONA_AUTH_RATE_MAX: process.env.D_AONA_AUTH_RATE_MAX || "400",
    },
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
   tournoi réellement ouvert (début dans 30 minutes, mise 1 000 ; la colonne
   `min_rank` garde une valeur historique mais ne conditionne plus rien). */
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
    skins: s.skins, pion: s.pion, notifUnread: s.notifUnread, bonusUsed: s.bonusUsed,
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

/* Écran Match : trois onglets seulement — « live » (En direct), « defis »
   (Défis), « tournois » (Tournois), présentés en tuiles de statistiques dans le
   héro. Chaque scénario déclare celui dont il a besoin : aucun état d'onglet
   implicite d'un scénario à l'autre. */
async function goMatchTab(page, tab) {
  await goScreen(page, "match");
  const sel = "#mt-tiles .mt-tile[data-mtab='" + tab + "']";
  const btn = page.locator(sel);
  if (await btn.count()) await btn.first().click();
  await sleep(950);
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && el.getAttribute("aria-selected") === "true";
  }, sel);
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
  ["wallet", "Wallet"], ["profile", "Profil"], ["skins", "Boutique de skins"],
  ["friends", "Amis"], ["chat", "Messagerie"],
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
  /* UN CHOIX VAUT « SUIVANT » : depuis le lot « onglet Jeux », la flèche « Suivant »
     n'existe plus et le CTA (lancement) n'apparaît qu'à l'étape 4. On clique donc la
     tuile du jeu, puis le mode, puis le format — le geste réel d'un joueur. */
  await goScreen(page, "play");
  const game = page.locator("#play-root .pg-opt[data-game]");
  if (!(await game.count())) return "aucune tuile de jeu à l'étape 1 de l'assistant";
  await game.first().click();          /* étape 1 → 2 */
  await sleep(400);
  const opt = page.locator(`#play-root .pg-opt[data-mode="${mode}"]`);
  if (!(await opt.count())) return `aucune option de mode « ${mode} » à l'étape 2`;
  await opt.first().click();           /* étape 2 → 3 (sauf « défi », voir ci-dessous) */
  await sleep(400);
  if (mode === "defi") {
    /* « Défi » réclame un adversaire ET une mise : il se contente d'afficher son
       formulaire. C'est la MISE qui valide et fait avancer. */
    const w = page.locator("#play-root [data-wager]");
    if (!(await w.count())) return "aucune mise proposée pour le mode défi";
    await w.first().click();           /* étape 2 → 3 */
    await sleep(400);
  }
  const f = page.locator(`#play-root .pg-fmt[data-fmt="${fmt}"]`);
  if (!(await f.count())) return `aucun format « ${fmt} » à l'étape 3`;
  const cls = (await f.first().getAttribute("class")) || "";
  if (/off/.test(cls)) return `format « ${fmt} » indisponible pour ce mode`;
  await f.first().click();             /* étape 3 → 4 */
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
    await goMatchTab(C.page, "live");
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
   S8 — BOUTIQUE DE SKINS : COULEUR × MOTIF, DEUX CAMPS (#/skins)
   -------------------------------------------------------------------------
   Deux axes INDÉPENDANTS (16 couleurs × 9 motifs : aucune combinaison n'existe en
   base ni en CSS) et DEUX CAMPS ÉTANCHES : les couleurs claires n'habillent que
   les pions du joueur, les sombres que ceux de l'adversaire. Ce scénario vérifie
   l'onglet par camp, le miroir des catalogues (couleurs, motifs, camps),
   l'indépendance des deux choix ET des deux camps, l'enregistrement séparé par
   camp, la persistance, le refus serveur d'une couleur du mauvais groupe et le
   nettoyage du Profil.
   ========================================================================= */
async function s8_skins(browser) {
  const A = await ensure(browser, "A");

  await step("le profil n'affiche plus ni boutique ni inventaire", async () => {
    await goScreen(A.page, "profile");
    const p = await A.page.evaluate(() => {
      const cta = document.getElementById("pf3-skin-cta");
      return {
        shop: !!document.getElementById("profile-shop"),
        cards: document.querySelectorAll("#profile-root .skin-card").length,
        inv: document.querySelectorAll("#profile-root [data-inv]").length,
        scope: document.querySelectorAll("#profile-root [data-skinscope]").length,
        cta: cta ? cta.getAttribute("href") : null,
      };
    });
    if (p.shop) return "le panneau « Boutique — Skins » est encore dans le profil";
    if (p.cards) return "des cartes de skin sont encore affichées dans le profil : " + p.cards;
    if (p.inv) return "l'inventaire est encore affiché dans le profil : " + p.inv + " ligne(s)";
    if (p.scope) return "les filtres de la boutique sont encore dans le profil";
    if (p.cta !== "#/skins") return "la carte CTA ne mène pas à la boutique : href=" + p.cta;
    return true;
  });

  await step("la carte CTA du profil ouvre la page « Boutique de skins »", async () => {
    await goScreen(A.page, "profile");
    await A.page.locator("#pf3-skin-cta").first().click();
    await sleep(1400);
    const r = await routeOf(A.page);
    if (r !== "skins") return "route atteinte : " + r;
    const txt = await textOf(A.page, "#skins-root");
    const flat = String(txt).replace(/\s+/g, " ");
    if (!/Aperçu du pion/i.test(flat)) return "section « Aperçu du pion » absente";
    if (!/Couleur/i.test(flat)) return "section « Couleur » absente";
    if (!/Motif/i.test(flat)) return "section « Motif » absente";
    if (!/Personnalisation actuelle/i.test(flat)) return "section « Personnalisation actuelle » absente";
    if (!/Appliquer ce skin/i.test(flat)) return "bouton « Appliquer ce skin » absent";
    /* Les DEUX camps sont présentés, et l'onglet dit À QUI l'apparence s'applique. */
    const onglets = await A.page.evaluate(() => [...document.querySelectorAll("#skins-root [data-pion-camp]")]
      .map((b) => ({ camp: b.dataset.pionCamp, txt: b.innerText.replace(/\s+/g, " ").trim(), sel: b.getAttribute("aria-selected") })));
    if (onglets.length !== 2) return "onglets de camp : " + JSON.stringify(onglets);
    if (!onglets.every((o) => /pions/i.test(o.txt))) return "un onglet ne nomme pas son camp : " + JSON.stringify(onglets);
    if (!onglets.some((o) => o.sel === "true")) return "aucun onglet sélectionné au départ";
    return onglets.find((o) => o.camp === "light").sel === "true"
      ? true : "la boutique n'ouvre pas sur les pions du joueur : " + JSON.stringify(onglets);
  });

  await step("chaque onglet ne propose que les 8 couleurs de son groupe (+ 9 motifs)", async () => {
    await goScreen(A.page, "skins");
    const lire = () => A.page.evaluate(() => ({
      camp: (document.querySelector("#skins-root [data-pion-camp][aria-selected='true']") || {}).dataset?.pionCamp,
      colors: [...document.querySelectorAll("#skins-root [data-pick-color]")].map((b) => b.dataset.pickColor),
      patterns: [...document.querySelectorAll("#skins-root [data-pick-pattern]")].map((b) => b.dataset.pickPattern),
      group: (document.querySelector("#skins-root .pion-sub") || {}).innerText?.trim(),
      labels: [...document.querySelectorAll("#skins-root .pion-color .pion-lbl")].map((e) => e.innerText.trim()),
      /* Le jeu de variables employé par chaque pastille : clair = `data-pion-color`,
         sombre = `data-pion-color-dark`. Un camp ne doit voir QUE le sien. */
      vars: [...document.querySelectorAll("#skins-root .pion-color")].map((b) =>
        b.hasAttribute("data-pion-color-dark") ? "dark" : (b.hasAttribute("data-pion-color") ? "light" : "aucun")),
    }));
    for (const camp of ["light", "dark"]) {
      if (camp === "dark") {
        await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
        await sleep(600);
      }
      const d = await lire();
      if (d.camp !== camp) return `onglet attendu ${camp}, obtenu ${d.camp}`;
      if (d.colors.length !== 8) return `${camp} : couleurs affichées ${d.colors.length} (8 attendues)`;
      if (new Set(d.colors).size !== 8) return `${camp} : couleurs en double ${JSON.stringify(d.colors)}`;
      if (d.patterns.length !== 9) return `${camp} : motifs affichés ${d.patterns.length} (9 attendus)`;
      const attendu = camp === "dark" ? "sombre" : "clair";
      if (!new RegExp(attendu, "i").test(d.group || "")) return `${camp} : groupe annoncé « ${d.group} » (${attendu} attendu)`;
      const bad = d.labels.filter((l) => !l || l.length < 3);
      if (bad.length) return `${camp} : libellés de couleur manquants ${JSON.stringify(bad)}`;
      const mixte = d.vars.filter((v) => v !== (camp === "dark" ? "dark" : "light"));
      if (mixte.length) return `${camp} : des pastilles empruntent le jeu de variables de l'autre camp (${JSON.stringify(mixte)})`;
    }
    /* Le CAMP affiché est aussi écrit en clair, pour que le bouton d'enregistrement
       ne laisse aucun doute sur ce qu'il modifie. */
    const t = String(await textOf(A.page, "#skins-root")).replace(/\s+/g, " ");
    return /Pions sombres/.test(t) ? true : "l'onglet actif ne nomme pas son camp : " + t.slice(0, 160);
  });

  await step("couleurs, motifs ET camps du client correspondent à ceux du serveur", async () => {
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    if (!api || !api.colors || !api.patterns) return "GET /api/skins n'expose pas colors/patterns";
    if (!api.camps) return "GET /api/skins n'expose pas camps";
    const dom = await A.page.evaluate(() => ({
      colors: PION_COLORS.map((c) => [c.id, c.name, c.group]),
      patterns: PION_PATTERNS.map((p) => [p.id, p.name]),
      camps: PION_CAMPS.map((c) => [c.id, c.label, c.group]),
    }));
    const srvC = api.colors.map((c) => [c.id, c.name, c.group]);
    const srvP = api.patterns.map((p) => [p.id, p.name]);
    const srvK = api.camps.map((c) => [c.id, c.label, c.group]);
    const same = (a, b) => a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    if (!same(srvC, dom.colors)) return "couleurs divergentes : " + JSON.stringify({ serveur: srvC.slice(0, 4), client: dom.colors.slice(0, 4) });
    if (!same(srvP, dom.patterns)) return "motifs divergents : " + JSON.stringify({ serveur: srvP, client: dom.patterns });
    if (!same(srvK, dom.camps)) return "camps divergents : " + JSON.stringify({ serveur: srvK, client: dom.camps });
    /* Les couleurs de chaque camp sont celles de son groupe, côté serveur comme
       côté client : c'est la définition même de l'étanchéité. */
    for (const k of api.camps) {
      const srvGroup = api.colors.filter((c) => c.group === k.group).map((c) => c.id).sort();
      const cliGroup = await A.page.evaluate((camp) => pionColorsOfCamp(camp).map((c) => c.id).sort(), k.id);
      if (JSON.stringify(srvGroup) !== JSON.stringify(cliGroup))
        return `${k.id} : couleurs du camp divergentes ${JSON.stringify({ serveur: srvGroup, client: cliGroup })}`;
      if (srvGroup.length !== 8) return `${k.id} : ${srvGroup.length} couleurs (8 attendues)`;
    }
    return true;
  });

  await step("changer la COULEUR garde le motif, changer le MOTIF garde la couleur (camp clair)", async () => {
    await goScreen(A.page, "skins");
    await A.page.locator('#skins-root [data-pion-camp="light"]').first().click();
    await sleep(400);
    /* 1) Un motif : « Lémurien ». */
    await A.page.locator('#skins-root [data-pick-pattern="lemurien"]').first().click();
    await sleep(500);
    const apresMotif = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const on = (sel) => { const e = document.querySelector(sel); return e ? e.dataset : null; };
      return {
        color: v.dataset.pionColor, motif: v.dataset.pionMotif,
        selColor: on("#skins-root [data-pick-color].on"), selPattern: on("#skins-root [data-pick-pattern].on"),
        sum: (document.getElementById("pion-sum-pattern") || {}).innerText,
      };
    });
    if (apresMotif.motif !== "lemurien") return "le motif choisi n'atteint pas l'aperçu : " + JSON.stringify(apresMotif);
    if (!apresMotif.selPattern || apresMotif.selPattern.pickPattern !== "lemurien") return "la carte « Lémurien » n'est pas marquée sélectionnée";
    if (!/Lémurien/i.test(apresMotif.sum || "")) return "le résumé n'annonce pas le motif : " + apresMotif.sum;

    /* 2) Puis une couleur CLAIRE : le motif doit RESTER actif. */
    const avant = apresMotif.color;
    await A.page.locator('#skins-root [data-pick-color="bleu_clair"]').first().click();
    await sleep(500);
    const apresCouleur = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const on = (sel) => { const e = document.querySelector(sel); return e ? e.dataset.pickColor || e.dataset.pickPattern : null; };
      return {
        color: v.dataset.pionColor, motif: v.dataset.pionMotif,
        selColor: on("#skins-root [data-pick-color].on"), selPattern: on("#skins-root [data-pick-pattern].on"),
        sum: (document.getElementById("pion-sum-color") || {}).innerText,
      };
    });
    if (apresCouleur.color !== "bleu_clair") return "l'aperçu n'a pas pris la nouvelle couleur : " + JSON.stringify(apresCouleur);
    if (apresCouleur.color === avant) return "la couleur n'a pas changé (test invalide)";
    if (apresCouleur.motif !== "lemurien") return "le motif a été PERDU en changeant la couleur : " + JSON.stringify(apresCouleur);
    if (apresCouleur.selPattern !== "lemurien") return "la carte du motif a perdu sa sélection : " + JSON.stringify(apresCouleur);
    return /Bleu clair/i.test(apresCouleur.sum || "") ? true : "le résumé n'annonce pas la couleur : " + apresCouleur.sum;
  });

  await step("les deux camps sont indépendants : changer l'un ne touche pas l'autre", async () => {
    /* Le camp SOMBRE reçoit une apparence à lui, puis on revient au camp clair :
       son brouillon (bleu clair + lémurien, non enregistré) doit être intact. */
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(500);
    await A.page.locator('#skins-root [data-pick-color="grenat"]').first().click();
    await sleep(350);
    await A.page.locator('#skins-root [data-pick-pattern="crocodile"]').first().click();
    await sleep(350);
    const sombre = await A.page.evaluate(() => ({
      color: document.querySelector("#skins-root [data-pion-preview]").dataset.pionColorDark,
      motif: document.querySelector("#skins-root [data-pion-preview]").dataset.pionMotifDark,
      sumC: (document.getElementById("pion-sum-color") || {}).innerText,
      sumP: (document.getElementById("pion-sum-pattern") || {}).innerText,
    }));
    if (sombre.color !== "grenat" || sombre.motif !== "crocodile") return "le camp sombre n'a pas pris son apparence : " + JSON.stringify(sombre);
    if (!/Grenat/i.test(sombre.sumC || "") || !/Crocodile/i.test(sombre.sumP || "")) return "résumé du camp sombre incomplet : " + JSON.stringify(sombre);

    await A.page.locator('#skins-root [data-pion-camp="light"]').first().click();
    await sleep(500);
    const clair = await A.page.evaluate(() => ({
      color: document.querySelector("#skins-root [data-pion-preview]").dataset.pionColor,
      motif: document.querySelector("#skins-root [data-pion-preview]").dataset.pionMotif,
      sombreSurApercu: !!document.querySelector("#skins-root [data-pion-preview]").dataset.pionColorDark,
    }));
    if (clair.color !== "bleu_clair" || clair.motif !== "lemurien")
      return "le brouillon du camp clair a été perdu en passant par le camp sombre : " + JSON.stringify(clair);
    if (clair.sombreSurApercu) return "l'aperçu du camp clair porte encore les attributs du camp sombre";
    /* Le plateau, lui, n'a pas bougé : rien n'a été ENREGISTRÉ. */
    const board = await A.page.evaluate(() => {
      const b = document.getElementById("fanorona-board");
      return { light: b.dataset.pionColor, lightM: b.dataset.pionMotif, dark: b.dataset.pionColorDark, darkM: b.dataset.pionMotifDark };
    });
    return board.light === "blanc" && board.dark === "noir"
      ? true : "un brouillon non enregistré a atteint le plateau : " + JSON.stringify(board);
  });

  await step("aperçu, vignettes de motif et plateau partagent le même rendu (les deux camps)", async () => {
    /* Les quatre motifs illustrés sont des IMAGES servies par `assets/pions/` —
       avec DEUX dessins : le lot initial pour les pions CLAIRS (`<id>.png`), le
       lot `Assets-noirs-contraste-initial` pour les SOMBRES (`<id>-sombre.png`).
       Les cinq autres motifs restent des silhouettes SVG. */
    const MOTIFS_IMAGE = ["zebu", "ravinala", "lemurien", "crocodile"];
    for (const camp of ["light", "dark"]) {
      await A.page.locator(`#skins-root [data-pion-camp="${camp}"]`).first().click();
      await sleep(450);
      const d = await A.page.evaluate(() => {
        const bg = (el) => (el ? getComputedStyle(el).backgroundImage : null);
        const coucheMotif = (el) => {
          if (!el) return null;
          const s = getComputedStyle(el, "::before");
          /* Le masque généré est une couche COMPOSITE : le navigateur la numérote,
             mais l'URL du SVG y figure toujours. Les motifs IMAGE (les quatre
             illustrations de `assets/pions/`) ne passent pas par le masque : ils
             arrivent par `backgroundImage`, et le masque doit valoir `none`. */
          return { mask: (s.webkitMaskImage || s.maskImage || "") + "", ink: s.backgroundColor, img: s.backgroundImage + "" };
        };
        const dark = (document.querySelector("#skins-root [data-pion-camp][aria-selected='true']") || {}).dataset?.pionCamp === "dark";
        const big = document.querySelector("#skins-root [data-pion-preview]");
        const mini = document.querySelector('#skins-root [data-pick-pattern="lemurien"] .pion-view');
        const miniMount = mini ? getComputedStyle(mini).backgroundColor : null;
        const board = document.getElementById("fanorona-board");
        return {
          dark, bigBg: bg(big), miniBg: bg(mini), miniMount, bigLayer: coucheMotif(big),
          bigMotif: dark ? big.dataset.pionMotifDark : big.dataset.pionMotif,
          miniMotif: mini && (dark ? mini.dataset.pionMotifDark : mini.dataset.pionMotif),
          board: !!board,
          boardColor: board && (dark ? board.dataset.pionColorDark : board.dataset.pionColor),
          boardMotif: board && (dark ? board.dataset.pionMotifDark : board.dataset.pionMotif),
          styles: document.querySelectorAll("#pion-styles").length,
        };
      });
      if (d.styles !== 1) return "la feuille #pion-styles n'est pas générée (ou en double)";
      if (!/radial-gradient/.test(d.bigBg || "")) return `${camp} : l'aperçu n'a pas de dégradé : ` + d.bigBg;
      /* La vignette de motif est une MONTURE BLANCHE depuis l'habillage
         « vitrine » : elle montre le DESSIN, découplé de la couleur (qui se
         juge sur le pion d'aperçu). Le contrat n'est donc plus « aperçu =
         vignette » mais « la vignette ne suit AUCUNE couleur de camp » : fond
         blanc nu, seule la peinture du motif (masque ou image) s'ajoute. */
      if (!/^rgb\(255,\s*255,\s*255\)$/.test(String(d.miniMount || "").trim()))
        return "la vignette de motif n'est plus une monture blanche : " + String(d.miniMount);
      if (/radial-gradient/.test(String(d.miniBg || "")))
        return "la vignette de motif suit encore la couleur du camp : " + String(d.miniBg).slice(0, 90);
      /* DEUX familles de motifs, deux peintures — et jamais les deux à la fois :
         — IMAGE (le lot de `assets/pions/`) : le fichier est peint par
           `background-image`, et le masque reste `none` (sinon il rognerait
           l'illustration sur le contour de la silhouette) ;
         — SILHOUETTE : le masque SVG est posé et aucune image ne se superpose. */
      const couche = d.bigLayer || {};
      if (MOTIFS_IMAGE.includes(d.bigMotif)) {
        /* Le FICHIER attendu suit le camp de l'onglet actif : `-sombre` au camp
           sombre (dont le motif en brouillon est « crocodile »). */
        const attendu = "assets/pions/" + d.bigMotif + (d.dark ? "-sombre" : "") + "\\.png";
        if (!new RegExp(attendu).test(couche.img || ""))
          return `${camp} : le motif image n'est pas peint (attendu ${attendu}) : ` + String(couche.img).slice(0, 140);
        if (!/^none$/i.test(String(couche.mask).trim()))
          return `${camp} : un masque rognerait l'image du motif : ` + String(couche.mask).slice(0, 120);
      } else if (d.bigMotif !== "aucun") {
        if (!/data:image\/svg\+xml/.test(decodeURIComponent(couche.mask || "")))
          return `${camp} : le motif n'est pas un masque SVG : ` + String(couche.mask).slice(0, 120);
        if (!/^none$/i.test(String(couche.img).trim()))
          return `${camp} : une image se superpose à la silhouette : ` + String(couche.img).slice(0, 120);
      }
      if (!d.board) return "plateau absent du DOM (#fanorona-board)";
      /* Le plateau porte le style ENREGISTRÉ (pas le brouillon, qui n'est pas encore
         appliqué) : c'est `S.pion.styles` que la page a lu au chargement. */
      const saved = await A.page.evaluate((c) => (window.App.state().pion.styles || {})[c] || {}, camp);
      if (d.boardColor !== saved.color || d.boardMotif !== saved.pattern)
        return `${camp} : le plateau ne porte pas le style enregistré : ` + JSON.stringify([d.boardColor, d.boardMotif, saved]);
    }
    return true;
  });

  await step("« Appliquer ce skin » enregistre la couleur et le motif SÉPARÉMENT, pour le camp affiché", async () => {
    /* Le camp sombre porte un brouillon (grenat + crocodile) non enregistré ; le
       camp clair aussi (bleu clair + lémurien) — seul le camp AFFICHÉ part. */
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(450);
    const btn = A.page.locator("#pion-apply");
    if (await btn.isDisabled()) return "le bouton est inactif alors que le choix a changé";
    await btn.click();
    await sleep(2000);
    const s = await stateOf(A.page);
    const st = (s.pion && s.pion.styles && s.pion.styles.dark) || null;
    if (!st) return "état du pion absent dans l'interface : " + JSON.stringify(s.pion);
    if (st.color !== "grenat" || st.pattern !== "crocodile") return "apparence enregistrée inattendue : " + JSON.stringify(st);
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    if (!api.pionStyles || api.pionStyles.dark.color !== "grenat" || api.pionStyles.dark.pattern !== "crocodile")
      return "le serveur ne renvoie pas l'apparence sombre en deux champs : " + JSON.stringify(api && api.pionStyles);
    if (api.pionStyles.light.color !== "blanc" || api.pionStyles.light.pattern !== "aucun")
      return "enregistrer le camp sombre a modifié le camp clair : " + JSON.stringify(api.pionStyles.light);
    return (await btn.isDisabled()) ? true : "le bouton reste actif alors que tout est appliqué";
  });

  await step("les DEUX apparences survivent à un rechargement (le brouillon, lui, ne part pas)", async () => {
    await A.page.reload();
    await sleep(3000);
    await goScreen(A.page, "skins");
    await sleep(1200);
    /* La boutique se rouvre sur les pions du joueur. Le camp clair n'a JAMAIS été
       enregistré (son brouillon valait bleu clair + lémurien) : l'aperçu doit être
       revenu au style ENREGISTRÉ (blanc, aucun motif) — un brouillon n'est pas une
       apparence, et un rechargement ne peut pas l'inventer. */
    const clair = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const board = document.getElementById("fanorona-board");
      return {
        camp: (document.querySelector("#skins-root [data-pion-camp][aria-selected='true']") || {}).dataset?.pionCamp,
        color: v && v.dataset.pionColor, motif: v && v.dataset.pionMotif,
        sumC: (document.getElementById("pion-sum-color") || {}).innerText,
        sumP: (document.getElementById("pion-sum-pattern") || {}).innerText,
        boardColor: board && board.dataset.pionColor, boardMotif: board && board.dataset.pionMotif,
        boardDark: board && board.dataset.pionColorDark, boardDarkMotif: board && board.dataset.pionMotifDark,
        disabled: (document.getElementById("pion-apply") || {}).disabled,
      };
    });
    if (clair.camp !== "light") return "onglet ouvert par défaut : " + clair.camp;
    if (clair.color !== "blanc" || clair.motif !== "aucun")
      return "le brouillon du camp clair a survécu au rechargement : " + JSON.stringify(clair);
    if (!/Blanc/i.test(clair.sumC || "")) return "résumé du camp clair non restauré : " + JSON.stringify(clair);
    if (clair.boardColor !== "blanc" || clair.boardDark !== "grenat" || clair.boardDarkMotif !== "crocodile")
      return "le plateau ne reprend pas les DEUX apparences enregistrées : " + JSON.stringify(clair);
    if (!clair.disabled) return "le bouton devrait être inactif (aucun changement en attente)";
    /* Camp sombre : son apparence ENREGISTRÉE (grenat + crocodile) est là, elle. */
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(600);
    const sombre = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      return {
        color: v && v.dataset.pionColorDark, motif: v && v.dataset.pionMotifDark,
        sumC: (document.getElementById("pion-sum-color") || {}).innerText,
        sumP: (document.getElementById("pion-sum-pattern") || {}).innerText,
      };
    });
    if (sombre.color !== "grenat" || sombre.motif !== "crocodile")
      return "aperçu du camp sombre non restauré : " + JSON.stringify(sombre);
    return /Grenat/i.test(sombre.sumC || "") && /Crocodile/i.test(sombre.sumP || "")
      ? true : "résumé du camp sombre non restauré : " + JSON.stringify(sombre);
  });

  await step("couleur, motif, camp : cinq refus (400) sans rien écrire", async () => {
    const couleur = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "light", color: "rose_fluo", pattern: "lemurien" });
    if (couleur.status !== 400) return "couleur inconnue : code " + couleur.status + " (400 attendu)";
    const motif = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "light", color: "blanc", pattern: "dragon_de_komodo" });
    if (motif.status !== 400) return "motif inconnu : code " + motif.status + " (400 attendu)";
    /* ÉTANCHÉITÉ, depuis un appel DIRECT (sans passer par l'interface) : une couleur
       sombre ne va pas aux pions clairs, une couleur claire ne va pas aux sombres. */
    const croise1 = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "light", color: "noir", pattern: "aucun" });
    if (croise1.status !== 400) return "couleur sombre pour les pions clairs : code " + croise1.status + " (400 attendu)";
    const croise2 = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "dark", color: "blanc", pattern: "aucun" });
    if (croise2.status !== 400) return "couleur claire pour les pions sombres : code " + croise2.status + " (400 attendu)";
    const campInconnu = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "gauche", color: "blanc", pattern: "aucun" });
    if (campInconnu.status !== 400) return "camp inconnu : code " + campInconnu.status + " (400 attendu)";
    /* Aucun de ces refus n'a modifié l'état enregistré des deux camps. */
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    return api.pionStyles && api.pionStyles.light.color === "blanc" && api.pionStyles.light.pattern === "aucun"
      && api.pionStyles.dark.color === "grenat" && api.pionStyles.dark.pattern === "crocodile"
      ? true : "un refus a tout de même modifié l'état : " + JSON.stringify(api && api.pionStyles);
  });

  await step("la couleur seule suffit : « Aucun motif » enregistre un pion sombre uni", async () => {
    await goScreen(A.page, "skins");
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(500);
    await A.page.locator('#skins-root [data-pick-color="noir"]').first().click();
    await sleep(400);
    await A.page.locator('#skins-root [data-pick-pattern="aucun"]').first().click();
    await sleep(400);
    await A.page.locator("#pion-apply").click();
    await sleep(1800);
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    if (!api.pionStyles || api.pionStyles.dark.color !== "noir" || api.pionStyles.dark.pattern !== "aucun")
      return "couleur seule non enregistrée : " + JSON.stringify(api && api.pionStyles);
    if (api.pionStyles.light.color !== "blanc")
      return "enregistrer le camp sombre a modifié le camp clair : " + JSON.stringify(api.pionStyles.light);
    /* Le masque, l'encre ET l'image doivent être neutralisés : un pseudo-élément
       non masqué peindrait un disque d'encre plein sur le pion, et une image
       oubliée y collerait une illustration fantôme. */
    const mask = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const s = getComputedStyle(v, "::before");
      return { mask: (s.webkitMaskImage || s.maskImage || ""), fond: s.backgroundColor, img: s.backgroundImage + "" };
    });
    if (!/^none$/i.test(mask.mask) && mask.mask !== "") return "un motif subsiste avec « Aucun motif » : " + mask.mask.slice(0, 90);
    if (!/^none$/i.test(mask.img.trim())) return "une image de motif subsiste avec « Aucun motif » : " + mask.img.slice(0, 90);
    return /rgba\(0, 0, 0, 0\)|transparent/.test(mask.fond) ? true
      : "« Aucun motif » peint quand même un disque d'encre : " + mask.fond;
  });

  await step("aucun skin du catalogue ne peint un camp de pions (un seul mécanisme par camp)", async () => {
    await goScreen(A.page, "skins");
    const d = await A.page.evaluate(() => {
      const board = document.getElementById("fanorona-board");
      const st = document.getElementById("skin-styles");
      const css = st ? st.textContent : "";
      const rules = css.split("\n").filter((l) => l.includes(".piece."));
      return {
        classes: board ? [...board.classList].filter((c) => c.startsWith("skin-")) : null,
        feuille: !!st,
        meRules: rules.filter((l) => /\.piece\.me\b/.test(l)).length,
        oppRules: rules.filter((l) => /\.piece\.opp\b/.test(l)).length,
        pionStyles: document.querySelectorAll("#pion-styles").length,
        boardLight: board && [board.dataset.pionColor, board.dataset.pionMotif],
        boardDark: board && [board.dataset.pionColorDark, board.dataset.pionMotifDark],
      };
    });
    if (d.pionStyles !== 1) return "feuille des styles de pion absente ou en double : " + d.pionStyles;
    if (d.feuille || d.meRules || d.oppRules)
      return "une feuille de skins de pions subsiste : " + JSON.stringify({ feuille: d.feuille, me: d.meRules, opp: d.oppRules });
    if (d.classes === null) return "plateau absent du DOM (#fanorona-board)";
    if (d.classes.some((c) => c.startsWith("skin-pions")))
      return "un skin de pions est encore appliqué au plateau : " + JSON.stringify(d.classes);
    return d.boardLight[0] && d.boardDark[0]
      ? true : "le plateau ne porte pas les DEUX apparences : " + JSON.stringify([d.boardLight, d.boardDark]);
  });

  await step("la page tient à 360 px sans débordement horizontal", async () => {
    await A.page.setViewportSize({ width: 360, height: 760 });
    await goScreen(A.page, "skins");
    await sleep(1100);
    const d = await A.page.evaluate(() => {
      const root = document.getElementById("skins-root");
      const trop = [...root.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > 361);
      const boutons = [...root.querySelectorAll(".pion-color, .pion-motif, .pion-tab, #pion-apply")]
        .map((b) => Math.round(b.getBoundingClientRect().height));
      return {
        scrollW: document.documentElement.scrollWidth,
        over: trop.slice(0, 3).map((e) => (e.className || e.tagName) + "@" + Math.round(e.getBoundingClientRect().right)),
        petit: boutons.filter((h) => h < 44).length,
      };
    });
    await A.page.setViewportSize({ width: 1280, height: 900 });
    if (d.scrollW > 361) return "la page déborde : scrollWidth=" + d.scrollW + " · " + JSON.stringify(d.over);
    return d.petit ? d.petit + " cible(s) tactile(s) sous 44 px" : true;
  });
}

/* =========================================================================
   S9 — TOURNOIS : liste, détail (bracket), inscription et débit de la mise
   ========================================================================= */
async function s9_tournament(browser) {
  const A = await ensure(browser, "A");
  let tid = null;

  await step("l'écran Matchs liste les tournois disponibles", async () => {
    await goMatchTab(A.page, "tournois");
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
    await goMatchTab(A.page, "tournois");
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
    /* L'entrée de tournoi est une transaction réelle : le serveur la refuse
       sans KYC, et l'application ouvre alors la fenêtre « Vérification
       d'identité » — qui recouvre le bouton et fait échouer le clic SUIVANT.
       Lancé seul, ce scénario partait d'un compte neuf (kyc = 0) et échouait
       donc pour une raison étrangère au tournoi (S7, exécuté avant dans la
       campagne complète, est ce qui vérifiait le KYC). On le vérifie ici :
       le scénario devient réellement autonome, comme annoncé plus haut. */
    if (!(await stateOf(A.page)).kyc) {
      const r = await apiFromPage(A.page, "/api/kyc/verify", "POST", {});
      if (!r.json || r.json.kyc !== true) return "impossible de vérifier le KYC du compte de test";
      await A.page.reload({ waitUntil: "domcontentloaded" });
      await sleep(2500);
      if (!(await stateOf(A.page)).kyc) return "le KYC vérifié n'est pas relu par l'application";
      /* Le rechargement repart sur l'onglet « En direct » : on revient sur les
         tournois, sinon le bouton cherché n'existe pas dans la page. */
      await goMatchTab(A.page, "tournois");
    }
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
    await goMatchTab(A.page, "tournois");
    const shown = await until(A.page, () => /inscrit/i.test(document.getElementById("match-root").innerText), 10000);
    return shown ? true : "aucune mention « inscrit » affichée après l'inscription";
  });

  await step("le tournoi rejoint « Je participe » dès l'inscription confirmée", async () => {
    await goMatchTab(A.page, "tournois");
    const seg = A.page.locator('#match-root [data-tfilter="participe"]');
    if (!(await seg.count())) return "le filtre « Je participe » n'existe pas dans l'onglet Tournois";
    await seg.first().click();
    await sleep(600);
    const info = await A.page.evaluate(() => {
      const root = document.getElementById("match-root");
      const on = root.querySelector(".mt-seg.on");
      const cards = [...root.querySelectorAll(".tn-card")];
      return {
        actif: on ? on.innerText.trim().split("\n")[0] : "",
        n: cards.length,
        noms: cards.map((c) => ((c.querySelector("h3") || {}).textContent || "").trim()),
        inscrit: cards.some((c) => /inscrit/i.test(c.innerText)),
      };
    });
    if (!/participe/i.test(info.actif)) return "le filtre actif n'est pas « Je participe » : « " + info.actif + " »";
    if (info.n < 1) return "« Je participe » est vide alors que l'inscription vient d'être confirmée";
    if (!info.inscrit) return "la carte ne porte pas la mention d'inscription : " + JSON.stringify(info.noms);
    return true;
  });

  await step("inscription retirée côté serveur : le tournoi sort de « Je participe » sans geste", async () => {
    /* La ligne d'inscription est supprimée dans la COPIE jetable — c'est ce que
       feront l'annulation et le retrait d'inscription — puis un second joueur
       s'inscrit : le serveur diffuse `tournament_update` et le panneau se
       redessine seul. Aucun clic, aucun rechargement dans la section. */
    const me = await stateOf(A.page);
    const db = new DatabaseSync(path.join(tmpDir, "d-aona.db"));
    const del = db.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ? AND user_id = ?").run(TID_UI, me.id);
    db.close();
    if (del.changes !== 1) return "aucune inscription à retirer pour l'utilisateur " + me.id;
    const B = await ensure(browser, "B");
    let bs = await stateOf(B.page);
    if (!bs.kyc) { await apiFromPage(B.page, "/api/kyc/verify", "POST", {}); bs = await stateOf(B.page); }
    if (bs.balance < 1000) await apiFromPage(B.page, "/api/deposit", "POST", { amount: 1000, operator: "MVola" });
    const joinB = await apiFromPage(B.page, "/api/tournaments/join", "POST", { tournamentId: TID_UI });
    if (joinB.status !== 200) return "impossible de déclencher la diffusion serveur : " + JSON.stringify(joinB.json);
    const sorti = await until(A.page, () => {
      const root = document.getElementById("match-root");
      return root.querySelectorAll(".tn-card").length === 0 && /aucune participation/i.test(root.innerText || "");
    }, 10000);
    if (sorti) return true;
    const txt = ((await textOf(A.page, "#match-root")) || "").replace(/\s+/g, " ");
    return "la carte reste dans « Je participe » : « " + txt.slice(0, 140) + " »";
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
       l'expéditeur et doit y voir le message. Le conteneur des messages est
       marqué `data-pop-msgs` (famille `data-pop-*` des fenêtres de discussion) :
       on vise cette marque-là, pas `data-pop`, qui est celle de la fenêtre. */
    const fenetre = await uiOpenChatPopup(C.page, A.pseudo);
    if (fenetre !== true) return fenetre;
    const vu = await until(C.page, ([p, t]) => {
      const el = document.querySelector(`.cp-msgs[data-pop-msgs="${p}"]`);
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
  ["S8", "Boutique de skins : couleur × motif, page dédiée, choix indépendants", () => s8_skins(BROWSER)],
  ["S9", "Tournois : liste, détail, inscription", () => s9_tournament(BROWSER)],
  ["S10", "Notifications : badge, liste, lecture, tout lire", () => s10_notifications(BROWSER)],
  ["S11", "Messagerie : dock, envoi et réception temps réel", () => s11_chat(BROWSER)],
  ["S12", "Écran Match : héro, tuiles de statistiques, deux colonnes, défis réels et annulation", () => s12_match(BROWSER)],
  ["S13", "Données : classement vivant, badge Amis, photo de profil, noms cliquables, Elo gagné/perdu", () => s13_datafix(BROWSER)],
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
      /* Correctifs de DONNÉES : une fabrique d'avatar, une lecture d'historique, et
         la règle CSS qui rend un nom cliquable reconnaissable. Leur disparition du
         fichier servi signalerait un retour en arrière silencieux. */
      if (!/function avatarInnerHtml/.test(html)) missing.push("fabrique d'avatar unique");
      if (!/function mapGameRows/.test(html)) missing.push("lecture unique de l'historique");
      if (!/\.link-pseudo \{/.test(html)) missing.push("styles des noms cliquables");
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

/* =========================================================================
   S12 — ÉCRAN MATCH : héro, tuiles de statistiques, deux colonnes, défis réels
   =========================================================================
   L'écran Match est une vue de CONSULTATION : suivre (En direct), défier
   (Défis), s'inscrire (Tournois). Il n'a pas d'onglet « À jouer » — mettre sa
   partie en file reste le travail de l'écran Jeux.
   Les trois entrées sont des TUILES DE STATISTIQUES (libellé, compteur vivant,
   sous-libellé) et chaque onglet se déploie en DEUX COLONNES : la liste à
   gauche, le contexte à droite. Ce scénario confronte ce que l'écran AFFICHE à
   ce que le serveur SAIT : compteurs des tuiles vs listes réelles, jauge de défi
   vs dates ISO du serveur, remboursement vs solde. Aucune donnée décorative
   n'est tolérée.
   ========================================================================= */
async function s12_match(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");

  /* Clic tolérant : un élément absent renvoie false au lieu de faire échouer la
     campagne entière (une régression d'interface doit produire un ÉCHEC lisible,
     pas interrompre les scénarios suivants). */
  const mtClick = async (page, sel, ms = 5000) => {
    try { await page.click(sel, { timeout: ms }); return true; } catch (e) { return false; }
  };

  /* Les trois tuiles du héro : libellé, compteur, sous-libellé, état actif. */
  const mtTiles = (page) => page.evaluate(() => [...document.querySelectorAll("#mt-tiles .mt-tile")].map((t) => ({
    mtab: t.dataset.mtab,
    label: ((t.querySelector(".l") || {}).innerText || "").trim(),
    n: ((t.querySelector(".v") || {}).innerText || "").trim(),
    sub: ((t.querySelector(".s") || {}).innerText || "").trim(),
    on: t.getAttribute("aria-selected") === "true",
    h: Math.round(t.getBoundingClientRect().height),
  })));

  /* Nombre de colonnes réellement rendues par une grille (1 = empilé). */
  const mtCols = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return -1;
    const tpl = getComputedStyle(el).gridTemplateColumns;
    return tpl && tpl !== "none" ? tpl.split(" ").filter(Boolean).length : 0;
  }, sel);

  /* Vérifie le KYC comme le fait l'application après la simulation de la CIN :
     le serveur persiste, puis la page recharge son état (S.kyc est lu au
     démarrage). Un défi AVEC MISE est refusé sans KYC — on ne court-circuite pas
     la règle, on la respecte. */
  const mtVerify = async (p) => {
    if ((await stateOf(p.page)).kyc) return true;
    const r = await apiFromPage(p.page, "/api/kyc/verify", "POST", {});
    if (!r.json || r.json.kyc !== true) return false;
    await p.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2800);
    return (await stateOf(p.page)).kyc === true;
  };

  /* Envoi d'un défi par le geste réel : l'adversaire est choisi dans la colonne
     « Joueurs en ligne », puis l'assistant de l'écran Jeux (déjà configuré en
     mode défi par ce clic) est mené jusqu'à la mise en jeu. */
  const mtSendChallenge = async (p, pseudo) => {
    await goMatchTab(p.page, "defis");
    const sel = '#mt-online-root [data-mtdefy="' + pseudo + '"]';
    if (!(await until(p.page, (s) => !!document.querySelector(s), sel, 9000))) {
      return "adversaire « " + pseudo + " » absent de la colonne Joueurs en ligne";
    }
    await mtClick(p.page, sel);
    /* Le défi ouvre l'assistant à l'ÉTAPE 2 (mode « Défi » déjà sélectionné, le
       formulaire affiché). Un choix vaut « suivant » : la MISE valide le défi, puis
       le FORMAT, et le CTA de l'étape 4 envoie le défi. */
    const wagerSel = "#play-root [data-wager]";
    if (!(await until(p.page, (s) => !!document.querySelector(s), wagerSel, 9000))) {
      return "l'assistant de mise en jeu ne s'ouvre pas sur le mode défi";
    }
    await mtClick(p.page, wagerSel);
    await sleep(600);
    const fmtSel = "#play-root .pg-fmt:not(.off)";
    if (!(await until(p.page, (s) => !!document.querySelector(s), fmtSel, 9000))) {
      return "aucun format disponible après la mise du défi";
    }
    await mtClick(p.page, fmtSel);
    await sleep(600);
    if (!(await until(p.page, () => !!document.getElementById("pg-cta"), 9000))) {
      return "l'étape de lancement du défi ne s'ouvre pas";
    }
    await mtClick(p.page, "#pg-cta");
    await sleep(1400);
    const m = (await modalText(p.page)) || "";
    await dismissModals(p.page);
    return /défi envoyé/i.test(m) ? true : "aucune confirmation d'envoi : « " + m.slice(0, 60) + " »";
  };

  /* Lecture de la jauge de la carte de défi : pourcentage RENDU, pourcentage
     ATTENDU calculé sur les dates ISO du serveur, et libellé. */
  const mtGauge = (page) => page.evaluate(() => {
    const el = document.querySelector("#defi-recu-root .mt-gauge");
    if (!el) return null;
    const fill = el.querySelector(".mt-gauge__fill");
    const track = fill && fill.parentElement;
    const exp = Date.parse(el.dataset.exp || "");
    const ret = Date.parse(el.dataset.ret || "");
    if (!fill || !track || !exp || !ret) return null;
    const now = Date.now();
    return {
      pct: Math.round((parseFloat(getComputedStyle(fill).width) / parseFloat(getComputedStyle(track).width)) * 1000) / 10,
      attendu: Math.round(((exp - now) / (exp - ret)) * 1000) / 10,
      label: ((el.querySelector("[data-exp-label]") || {}).textContent || "").trim(),
      minutes: Math.round((exp - ret) / 60000),
    };
  });
  await step("l'écran Match est un héro avec trois tuiles de statistiques, aucun « À jouer »", async () => {
    await goScreen(A.page, "match");
    const info = await A.page.evaluate(() => {
      const hero = document.querySelector(".mt-hero");
      return {
        hero: !!hero,
        titre: hero ? ((hero.querySelector("h1") || {}).innerText || "").trim() : "",
        chip: hero ? ((hero.querySelector(".mt-chip") || {}).innerText || "").trim() : "",
        pulse: hero ? !!hero.querySelector(".mt-pulse") : false,
        tiles: document.querySelectorAll("#mt-tiles .mt-tile").length,
        ecran: (document.getElementById("screen-match") || {}).innerText || "",
        racine: !!document.getElementById("match-root"),
      };
    });
    const out = [];
    if (!info.hero) out.push("héro .mt-hero absent");
    if (!/^match$/i.test(info.titre)) out.push("titre du héro inattendu : « " + info.titre + " »");
    if (!/temps réel/i.test(info.chip)) out.push("pastille « TEMPS RÉEL » absente");
    if (!info.pulse) out.push("point animé de la pastille absent");
    if (!info.racine) out.push("racine #match-root absente");
    if (info.tiles !== 3) out.push(info.tiles + " tuile(s) au lieu de 3");
    if (/à jouer/i.test(info.ecran)) out.push("un onglet « À jouer » est encore présent");
    if (out.length) return out.join(" ; ");
    const tiles = await mtTiles(A.page);
    const manquants = ["En direct", "Défis", "Tournois"].filter((v) => !tiles.some((t) => t.label.startsWith(v)));
    if (manquants.length) return "tuile(s) manquante(s) : " + manquants.join(", ");
    const vides = tiles.filter((t) => !t.sub || !t.n).map((t) => t.label);
    return vides.length ? "tuile(s) sans compteur ou sans sous-libellé : " + vides.join(", ") : true;
  });

  await step("une seule tuile active, et le panneau annonce l'onglet affiché", async () => {
    const live = await mtTiles(A.page);
    const actives = live.filter((t) => t.on);
    if (actives.length !== 1) return actives.length + " tuile(s) active(s)";
    if (!actives[0].mtab) return "tuile active sans data-mtab";
    const ok = await goMatchTab(A.page, "tournois");
    const apres = await mtTiles(A.page);
    const on = apres.filter((t) => t.on);
    if (!ok || on.length !== 1 || on[0].mtab !== "tournois") return "l'onglet Tournois n'est pas celui qui est actif après le clic";
    const lab = await A.page.evaluate(() => (document.getElementById("match-root") || {}).getAttribute("aria-labelledby"));
    return lab === "mt-tab-tournois" ? true : "le panneau n'annonce pas son onglet (aria-labelledby = " + lab + ")";
  });

  await step("le héro porte un statut rapide et les deux actions principales", async () => {
    await goScreen(A.page, "match");
    const info = await A.page.evaluate(() => ({
      statut: (document.getElementById("mt-status") || {}).innerText || "",
      find: (document.getElementById("mt-find") || {}).innerText || "",
      invite: (document.getElementById("mt-invite") || {}).innerText || "",
    }));
    const out = [];
    if (!info.statut.trim()) out.push("pastille de statut vide");
    if (!/adversaire/i.test(info.find)) out.push("action « trouver un adversaire » absente");
    if (!/inviter/i.test(info.invite)) out.push("action « inviter un ami » absente");
    return out.length ? out.join(" ; ") : true;
  });

  await step("« Trouver un adversaire » ouvre la mise en file de l'écran Jeux", async () => {
    if (!(await mtClick(A.page, "#mt-find"))) return "action « trouver un adversaire » introuvable dans le héro";
    const ok = await until(A.page, () => /^play/.test((location.hash || "").replace("#/", "")) &&
      !!document.getElementById("pg-cta"), 8000);
    if (!ok) return "l'écran Jeux ne s'ouvre pas (route : " + (await routeOf(A.page)) + ")";
    const txt = (await textOf(A.page, "#play-root")) || "";
    await goScreen(A.page, "match");
    /* L'étape 4 est le récapitulatif de lancement : « 04 / 04 — prêt à jouer ». */
    return /04\s*\/\s*04/.test(txt) ? true : "l'assistant ne s'ouvre pas sur le lancement : « " + txt.slice(0, 60) + " »";
  });

  await step("« Inviter un ami » propose un lien à copier et la recherche de joueur", async () => {
    if (!(await mtClick(A.page, "#mt-invite"))) return "action « inviter un ami » introuvable dans le héro";
    await sleep(600);
    const m = (await modalText(A.page)) || "";
    if (!/inviter un ami/i.test(m)) return "aucune fenêtre d'invitation : « " + m.slice(0, 60) + " »";
    const has = await A.page.evaluate(() => ({
      copy: !!document.getElementById("invite-copy"),
      search: !!document.getElementById("invite-search"),
      lien: /https?:\/\//.test(document.getElementById("modal").innerText || ""),
    }));
    await dismissModals(A.page);
    if (!has.copy || !has.search) return "actions d'invitation incomplètes";
    return has.lien ? true : "le lien à partager n'est pas affiché";
  });
  await step("la tuile « En direct » annonce le nombre réel de parties affichées", async () => {
    await goMatchTab(A.page, "live");
    const ok = await until(A.page, () => {
      const r = document.getElementById("live-games-root");
      return !!r && !/Recherche des parties/.test(r.innerText);
    }, 9000);
    if (!ok) return "le fil des parties ne se charge pas";
    const info = await A.page.evaluate(() => {
      const r = document.getElementById("live-games-root");
      const v = document.querySelector('#mt-tiles .mt-tile[data-mtab="live"] .v');
      return {
        n: v ? v.innerText.trim() : "",
        rows: r.querySelectorAll(".mt-row").length,
        vide: !!r.querySelector(".mt-state"),
      };
    });
    if (info.n === "—") return "la tuile « En direct » reste sur un tiret après le chargement";
    if (!info.vide && info.rows > 0 && info.n !== String(info.rows)) return "tuile « " + info.n + " » mais " + info.rows + " partie(s) affichée(s)";
    if (info.vide && info.n !== "0") return "fil vide mais tuile « " + info.n + " »";
    return true;
  });

  await step("élargir la portée interroge le SERVEUR, la liste suit", async () => {
    const req = A.page.waitForRequest((r) => r.url().includes("/api/games/live") && r.url().includes("scope=all"), { timeout: 9000 })
      .catch(() => null);                      /* jamais de rejet non capté */
    if (!(await mtClick(A.page, '#match-root [data-lscope="all"]'))) return "bouton d'élargissement (.mt-more) absent de l'onglet En direct";
    if (!(await req)) return "aucune requête ?scope=all envoyée au serveur";
    const ok = await until(A.page, () => {
      const r = document.getElementById("live-games-root");
      return !!r && !/Recherche des parties/.test(r.innerText);
    }, 9000);
    if (!ok) return "le fil reste bloqué sur le chargement après changement de portée";
    const libelle = await A.page.evaluate(() => {
      const b = document.querySelector('#match-root [data-lscope="contacts"]');
      return b ? b.innerText.trim() : "";
    });
    if (!/contacts/i.test(libelle)) return "aucun moyen de revenir aux parties des contacts";
    await mtClick(A.page, '#match-root [data-lscope="contacts"]');
    await sleep(800);
    return true;
  });

  await step("une partie en direct montre les pions restants, ou un état vide actionnable", async () => {
    const info = await A.page.evaluate(() => {
      const r = document.getElementById("live-games-root");
      if (!r) return { err: "fil absent de l'onglet En direct" };
      const lignes = [...r.querySelectorAll(".mt-row")];
      return {
        rows: lignes.length,
        watch: r.querySelectorAll('button[onclick*="spectate"]').length,
        scores: lignes.filter((l) => {
          const s = l.querySelector(".mt-score");
          return s && /^\d+\s*–\s*\d+$/.test(s.innerText.trim());
        }).length,
        live: lignes.filter((l) => (l.querySelector(".mt-badge") || {}).innerText && /live/i.test(l.querySelector(".mt-badge").innerText)).length,
        empty: !!r.querySelector(".mt-state"),
        actions: r.querySelectorAll(".mt-state button").length,
      };
    });
    if (info.err) return info.err;
    if (info.rows > 0) {
      if (info.watch !== info.rows) return info.rows + " ligne(s) mais " + info.watch + " bouton(s) « Regarder »";
      if (info.live !== info.rows) return "certaines lignes n'ont pas l'étiquette LIVE";
      if (info.scores !== info.rows) return "certaines lignes n'affichent pas les pions restants (score)";
      return true;
    }
    return info.empty && info.actions > 0 ? true : "ni partie à regarder ni état vide avec action (lignes " + info.rows + ")";
  });

  await step("la colonne des contacts donne l'état de présence, action désactivée si indisponible", async () => {
    const info = await A.page.evaluate(() => {
      const root = document.getElementById("mt-contacts-root");
      if (!root) return { err: "colonne des contacts absente de l'onglet En direct" };
      const lignes = [...root.querySelectorAll(".mt-contact")];
      return {
        root: true,
        n: lignes.length,
        dots: lignes.filter((l) => !!l.querySelector(".mt-sdot")).length,
        etats: lignes.map((l) => {
          const st = l.querySelector(".st");
          const b = l.querySelector("button");
          return { txt: st ? st.innerText.trim() : "", off: b ? !!b.disabled : null, act: b ? b.innerText.trim() : "" };
        }),
        empty: !!root.querySelector(".mt-state"),
        actions: root.querySelectorAll(".mt-state button").length,
        titre: (document.getElementById("mt-contacts-n") || {}).innerText || "",
      };
    });
    if (info.err) return info.err;
    if (!info.n) return info.empty && info.actions > 0 ? true : "ni contact ni état vide actionnable";
    if (info.dots !== info.n) return "certaines lignes n'ont pas de pastille d'état";
    const incoherent = info.etats.filter((e) => /en partie|hors ligne/i.test(e.txt) && e.off !== true);
    if (incoherent.length) return "contact indisponible avec une action active : « " + incoherent[0].txt + " » / « " + incoherent[0].act + " »";
    const enLigne = info.etats.filter((e) => /en ligne/i.test(e.txt) && !/en partie/i.test(e.txt));
    const active = enLigne.filter((e) => e.off === false);
    if (enLigne.length && active.length !== enLigne.length) return "contact en ligne mais bouton inactif : « " + enLigne[0].act + " »";
    return true;
  });
  await step("les onglets se déploient en deux colonnes (liste à gauche, contexte à droite)", async () => {
    const out = [];
    if ((await mtCols(A.page, "#match-root .mt-split")) !== 2) out.push("onglet En direct : " + (await mtCols(A.page, "#match-root .mt-split")) + " colonne(s)");
    await goMatchTab(A.page, "defis");
    if ((await mtCols(A.page, "#match-root .mt-split")) !== 2) out.push("onglet Défis : pas deux colonnes");
    await goMatchTab(A.page, "tournois");
    if ((await mtCols(A.page, "#match-root .mt-split")) !== 2) out.push("onglet Tournois : pas deux colonnes");
    return out.length ? out.join(" ; ") : true;
  });

  await step("l'onglet Défis sépare les défis reçus, les envoyés et les joueurs en ligne", async () => {
    await goMatchTab(A.page, "defis");
    const txt = (await textOf(A.page, "#match-root")) || "";
    const out = [];
    if (!/défis reçus/i.test(txt)) out.push("section « Défis reçus » absente");
    if (!/défis envoyés/i.test(txt)) out.push("section « Défis envoyés » absente");
    if (!/joueurs en ligne/i.test(txt)) out.push("colonne « Joueurs en ligne » absente");
    if (!/(aucun défi|accepter)/i.test(txt)) out.push("ni défi reçu ni état vide explicite");
    /* Les défis ENVOYÉS viennent d'un appel REST : le bloc doit sortir de l'état
       « chargement », sinon l'onglet reste à moitié vide. */
    const charged = await until(A.page, () => {
      const s = document.getElementById("defis-sent");
      return !!s && !/chargement/i.test(s.innerText);
    }, 10000);
    if (!charged) out.push("les défis envoyés ne se chargent pas");
    return out.length ? out.join(" ; ") : true;
  });

  await step("un défi reçu affiche une jauge calée sur les dates du serveur", async () => {
    if (!(await mtVerify(A))) return "impossible de vérifier le KYC du destinataire";
    if (!(await mtVerify(B))) return "impossible de vérifier le KYC de l'expéditeur";
    await goMatchTab(A.page, "defis");
    const envoi = await mtSendChallenge(B, A.pseudo);
    if (envoi !== true) return envoi;
    /* Le défi arrive par WebSocket : la carte doit apparaître sans rechargement. */
    const vu = await until(A.page, () => !!document.querySelector("#defi-recu-root .mt-defi"), 9000);
    if (!vu) return "la carte du défi reçu n'apparaît pas côté destinataire";
    const card = await A.page.evaluate(() => {
      const c = document.querySelector("#defi-recu-root .mt-defi");
      return {
        qui: (c.querySelector(".n") || {}).innerText || "",
        chips: [...c.querySelectorAll(".mt-defi__spec .pill")].map((p) => p.innerText.trim()),
        actions: [...c.querySelectorAll(".mt-defi__acts button")].map((b) => b.innerText.trim()),
        jauge: !!c.querySelector(".mt-gauge"),
      };
    });
    const out = [];
    if (!card.qui.includes(B.pseudo)) out.push("la carte n'identifie pas l'expéditeur (« " + card.qui.trim() + " »)");
    if (!card.chips.some((c) => /mise/i.test(c) && /500/.test(c))) out.push("mise réelle absente des informations du défi");
    if (!card.actions.some((a) => /accepter/i.test(a)) || !card.actions.some((a) => /refuser/i.test(a))) out.push("actions Accepter / Refuser incomplètes");
    if (!card.jauge) out.push("aucune jauge de temps de réponse");
    if (out.length) return out.join(" ; ");
    const g = await mtGauge(A.page);
    if (!g) return "jauge illisible (dates d'expiration absentes du DOM)";
    if (g.minutes !== 15) return "fenêtre de réponse inattendue : " + g.minutes + " min au lieu de 15";
    if (!/^reste \d+ \/ 15 min$/.test(g.label)) return "libellé de jauge inattendu : « " + g.label + " »";
    if (Math.abs(g.pct - g.attendu) > 2) return "jauge " + g.pct + " % alors que les dates du serveur donnent " + g.attendu + " %";
    return g.pct < 100 && g.pct > 0 ? true : "jauge à " + g.pct + " % (ni entamée ni pleine)";
  });

  await step("la jauge se vide avec le temps réel, et le refus libère la carte", async () => {
    const g1 = await mtGauge(A.page);
    if (!g1) return "jauge absente avant la mesure";
    await sleep(3000);
    const g2 = await mtGauge(A.page);
    if (!g2) return "jauge disparue pendant la mesure";
    if (g2.pct > g1.pct) return "la jauge remonte : " + g1.pct + " % -> " + g2.pct + " %";
    if (Math.abs(g2.pct - g2.attendu) > 2) return "après 3 s, jauge " + g2.pct + " % pour " + g2.attendu + " % attendus";
    /* Le remboursement se vérifie D'ABORD en base (le serveur fait foi), puis à
       l'écran : un solde juste mais non affiché resterait un défaut pour le
       joueur. */
    const bSolde = (await apiFromPage(B.page, "/api/user", "GET")).json.user.balance;
    if (!(await mtClick(A.page, "#defi-recu-root .mt-defi__acts button.danger"))) return "bouton « Refuser » introuvable";
    const parti = await until(A.page, () => !document.querySelector("#defi-recu-root .mt-defi"), 9000);
    if (!parti) return "la carte du défi reste affichée après le refus";
    const etat = await A.page.evaluate(() => !!document.querySelector("#defi-recu-root .mt-state"));
    if (!etat) return "aucun état vide après le refus";
    const rembourse = await until(B.page, async (attendu) => {
      const token = localStorage.getItem("daona_token");
      const r = await fetch("/api/user", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      return !!d.user && d.user.balance === attendu;
    }, bSolde + 500, 9000);
    if (!rembourse) return "la mise du défi refusé n'est pas revenue (solde serveur " + bSolde + ")";
    const affiche = await until(B.page, (a) => window.App.state().balance === a, bSolde + 500, 6000);
    return affiche ? true : "le solde affiché ne suit pas le remboursement";
  });
  await step("l'onglet Tournois filtre par statut et n'affiche que ce statut", async () => {
    await goMatchTab(A.page, "tournois");
    const out = [];
    for (const [f, attendu] of [["ouvert", "Ouvert"], ["encours", "En cours"], ["termine", "Terminé"]]) {
      if (!(await mtClick(A.page, '#match-root [data-tfilter="' + f + '"]'))) {
        out.push("filtre de statut « " + attendu + " » absent");
        continue;
      }
      await sleep(550);
      const bad = await A.page.evaluate((lab) => {
        const r = document.getElementById("match-root");
        const on = r.querySelector(".mt-seg.on");
        const res = [];
        if (!on || !(on.innerText || "").trim().startsWith(lab)) res.push("filtre actif inattendu : " + (on ? on.innerText.trim() : "aucun"));
        r.querySelectorAll(".tn-card").forEach((c) => {
          const pill = ((c.querySelector(".tn-head .pill") || {}).innerText || "").trim();
          if (pill !== lab) res.push("carte « " + pill + " » dans le filtre " + lab);
        });
        return res;
      }, attendu);
      if (bad.length) out.push(bad.slice(0, 2).join(", "));
    }
    await mtClick(A.page, '#match-root [data-tfilter="ouvert"]');
    await sleep(450);
    return out.length ? out.join(" ; ") : true;
  });

  await step("les tournois annoncent les prochains départs avec un vrai décompte", async () => {
    const info = await A.page.evaluate(() => {
      const root = document.getElementById("match-root");
      const bloc = [...root.querySelectorAll(".panel")]
        .find((p) => /prochains départs/i.test((p.querySelector(".panel-title") || {}).innerText || ""));
      if (!bloc) return { err: "bloc « Prochains départs » absent" };
      return {
        n: bloc.querySelectorAll(".mt-contact").length,
        cd: [...bloc.querySelectorAll(".countdown")].map((c) => c.innerText.trim()),
        vide: /aucun départ/i.test(bloc.innerText),
      };
    });
    if (info.err) return info.err;
    if (!info.n) return info.vide ? true : "aucun départ annoncé et aucun message d'état vide";
    const mauvais = info.cd.filter((t) => !/maintenant|\d/.test(t));
    return mauvais.length ? "décompte illisible : « " + mauvais[0] + " »" : true;
  });

  await step("les règles du format sont rappelées et détaillables", async () => {
    const txt = (await textOf(A.page, ".mt-rules")) || "";
    const out = [];
    if (!/rembours/i.test(txt)) out.push("mise remboursée non annoncée");
    if (!/50/.test(txt) || !/25/.test(txt)) out.push("répartition des gains absente");
    if (out.length) return out.join(" ; ");
    if (!(await mtClick(A.page, "#mt-prize"))) return "bouton du barème absent du bloc de règles";
    await sleep(600);
    const m = (await modalText(A.page)) || "";
    await dismissModals(A.page);
    return /50%/.test(m) && /25%/.test(m) ? true : "barème incomplet : « " + m.slice(0, 70) + " »";
  });
  await step("un défi envoyé se suit, s'annule, et la mise revient immédiatement", async () => {
    const avant = (await apiFromPage(A.page, "/api/user", "GET")).json.user.balance;
    const envoi = await mtSendChallenge(A, B.pseudo);
    if (envoi !== true) return envoi;
    await goMatchTab(A.page, "defis");
    if (!(await until(A.page, () => !!document.querySelector("#defis-sent [data-mtcancel]"), 10000)))
      return "le défi envoyé n'apparaît pas en attente avec son bouton d'annulation";
    const ligne = await A.page.evaluate(() => {
      const b = document.querySelector("#defis-sent [data-mtcancel]");
      const r = b.closest(".defi-row");
      return { txt: r ? r.innerText : "", id: b.dataset.mtcancel };
    });
    if (!ligne.txt.includes(B.pseudo)) return "la ligne annulable ne vise pas le bon joueur";
    const debite = (await apiFromPage(A.page, "/api/user", "GET")).json.user.balance;
    if (debite !== avant - 500) return "mise non débitée à l'envoi (" + avant + " -> " + debite + ")";
    if (!(await until(A.page, (a) => window.App.state().balance === a, debite, 7000)))
      return "le solde affiché ne suit pas la mise engagée (poussée wallet_update manquante)";
    /* Le destinataire voit la carte tant que le défi est en attente… */
    await goMatchTab(B.page, "defis");
    if (!(await until(B.page, () => !!document.querySelector("#defi-recu-root .mt-defi"), 9000)))
      return "le destinataire ne voit pas le défi en attente";
    /* … puis elle disparaît par un simple message du serveur (aucun rechargement). */
    if (!(await mtClick(A.page, "#defis-sent [data-mtcancel]"))) return "clic sur « Annuler » sans effet";
    if (!(await until(A.page, (a) => window.App.state().balance === a, avant, 9000)))
      return "la mise annulée n'est pas rendue à l'écran (" + (await stateOf(A.page)).balance + " au lieu de " + avant + ")";
    const rendu = (await apiFromPage(A.page, "/api/user", "GET")).json.user.balance;
    if (rendu !== avant) return "remboursement non persisté (" + rendu + " au lieu de " + avant + ")";
    if (!(await until(A.page, () => /annulé/i.test((document.getElementById("defis-sent") || {}).innerText || ""), 9000)))
      return "la ligne reste en attente après annulation";
    if (!(await until(B.page, () => !document.querySelector("#defi-recu-root .mt-defi"), 9000)))
      return "le défi annulé reste affiché chez le destinataire";
    const reste = await apiFromPage(B.page, "/api/challenges", "GET");
    const encore = ((reste.json || {}).received || []).some((c) => c.id === ligne.id);
    return encore ? "le défi annulé est toujours en attente côté serveur" : true;
  });

  await step("mobile 360 px : tuiles tapables, colonnes empilées, aucun débordement", async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, is_mobile: true, has_touch: true });
    const page = await ctx.newPage();
    try {
      const token = await A.page.evaluate(() => localStorage.getItem("daona_token"));
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate((t) => localStorage.setItem("daona_token", t), token);
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(2600);
      await goMatchTab(page, "live");
      const info = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll("#mt-tiles .mt-tile")];
        const w = (id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
        const split = document.querySelector("#match-root .mt-split");
        const tpl = split ? getComputedStyle(split).gridTemplateColumns : "";
        return {
          n: tiles.length,
          hauteurs: tiles.map((t) => Math.round(t.getBoundingClientRect().height)),
          cols: tpl && tpl !== "none" ? tpl.split(" ").filter(Boolean).length : 0,
          debord: document.documentElement.scrollWidth - window.innerWidth,
          find: w("mt-find"),
          invite: w("mt-invite"),
        };
      });
      if (info.n !== 3) return "tuiles perdues en mobile : " + info.n;
      if (info.hauteurs.some((h) => h < 40)) return "cibles tactiles trop basses : " + info.hauteurs.join(" px, ") + " px";
      if (info.cols !== 1) return "les deux colonnes ne se replient pas en mobile (" + info.cols + " colonne(s))";
      if (info.debord > 1) return "débordement horizontal de " + info.debord + " px";
      if (info.find < 100 || info.invite < 100) return "actions trop étroites au doigt (" + info.find + " / " + info.invite + " px)";
      return true;
    } finally { await ctx.close(); }
  });
}

/* =========================================================================
   S13 — DONNÉES : classement vivant, badge Amis, photo de profil, noms
   cliquables et Elo gagné/perdu
   =========================================================================
   Ces cinq points partagent une même cause : une donnée qui existait côté
   serveur mais n'arrivait pas — ou arrivait mal — jusqu'à l'écran. Le scénario
   confronte donc ce que l'interface AFFICHE à ce que l'API RÉPOND, sur des
   données réelles (aucune valeur décorative n'est tolérée), et vérifie que la
   page reste juste APRÈS un rechargement (le local ne peut pas faire foi).
   ========================================================================= */
async function s13_datafix(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");
  const E = await ensure(browser, "E");          // joueur neuf : aucune relation avec A
  const dataOf = (page) => page.evaluate(() => {
    const el = document.getElementById("btn-friends");
    return {
      badge: el ? el.getAttribute("data-count") : null,
      title: el ? el.title : "",
      tbAv: (() => { const i = document.querySelector("#tb-avatar img"); return i ? i.getAttribute("src") : null; })(),
      dashAv: (() => { const i = document.querySelector(".dash-avatar img"); return i ? i.getAttribute("src") : null; })(),
    };
  });

  /* ---- 0. Mise en état : la page doit être SAINE et le canal temps réel
     authentifié AVANT toute mesure. Un scénario précédent peut avoir rechargé la
     page (vérification KYC) : ce qu'on mesure ici, c'est l'apparition d'un joueur
     après sa création, pas la vitesse de reconnexion d'une page. */
  await step("après un rechargement, le canal temps réel se réauthentifie tout seul", async () => {
    await A.page.reload({ waitUntil: "domcontentloaded" });
    if (!(await until(A.page, () => window.API.isConnected(), 15000)))
      return "la socket n'est pas ouverte après un rechargement de page";
    const rep = await A.page.evaluate(async () => {
      const seen = [];
      const fn = (m) => seen.push(m.message || m.type);
      window.API.on("error", fn);
      window.API.send({ type: "spectate", sessionId: "sonde-inexistante" });
      await new Promise((r) => setTimeout(r, 900));
      window.API.off("error", fn);
      return seen;
    });
    /* Le serveur ne répond « Match introuvable » qu'à une socket dont le message
       `auth` a abouti : c'est la preuve d'authentification (un « Non authentifié »
       signalerait une page connectée mais muette). */
    return rep.some((m) => /Match introuvable/i.test(m)) ? true
      : `la socket n'est pas authentifiée après rechargement (réponses : ${JSON.stringify(rep)})`;
  });

  /* ---- 1. Le classement accueille un joueur créé APRÈS ma connexion ---- */
  let newPseudo = null, newId = null;
  await step("un joueur créé après ma connexion apparaît au classement, sans rechargement", async () => {
    await goScreen(A.page, "ranks");
    await sleep(900);
    /* Le classement se remet dans son état NEUTRE avant la mesure : une recherche
       ou un filtre de province laissé par un scénario précédent masquerait la
       ligne sans que le produit soit en cause. */
    await A.page.evaluate(() => {
      const s = document.getElementById("rank-search");
      if (s && s.value) { s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); }
      const nat = document.querySelector('#ranks-root .chip[data-scope="national"]');
      if (nat && !nat.classList.contains("on")) nat.click();
    });
    await sleep(700);
    /* Instrumentation de diagnostic : compte les poussées reçues par CETTE page.
       Sans cela, on ne peut pas distinguer « le serveur n'a rien diffusé » de
       « la page n'a pas suivi la diffusion ». */
    await A.page.evaluate(() => {
      window.__lbPushes = 0;
      window.API.on("leaderboard_update", () => { window.__lbPushes++; });
    });
    newPseudo = "ZzUiNew" + Math.floor(Math.random() * 900 + 100);
    const reg = await apiFromPage(A.page, "/api/auth/register", "POST",
      { pseudo: newPseudo, password: PWD, province: "Antananarivo" });
    if (reg.status !== 200) return `inscription du joueur de contrôle refusée (${reg.status}) : ${JSON.stringify(reg.json)}`;
    newId = reg.json.user.id;
    /* Aucun rechargement : c'est la poussée serveur (leaderboard_update) qui doit
       provoquer l'apparition. On cherche le joueur dans le classement affiché. */
    const seen = await until(A.page, (p) => {
      const rows = [...document.querySelectorAll("#ranks-root .rank-row .who-pseudo")];
      return rows.some((r) => r.innerText.trim() === p);
    }, newPseudo, 12000);
    if (seen) return true;
    /* Diagnostic : on rapporte l'état RÉEL plutôt qu'une supposition — la poussée
       est-elle arrivée, la liste l'a-t-elle reçue, un filtre la masque-t-il ? */
    const diag = await A.page.evaluate((p) => {
      const s = window.App.state();
      return {
        route: (location.hash || "").replace("#/", ""),
        liste: (s.leaderboard || []).length,
        dansListe: !!(s.leaderboard || []).some((x) => x.pseudo === p),
        lignes: document.querySelectorAll("#ranks-root .rank-row").length,
        recherche: (document.getElementById("rank-search") || {}).value || "",
        portee: ((document.querySelector("#ranks-root .chip.on") || {}).textContent || "").trim(),
        poussees: window.__lbPushes,
        socket: window.API.isConnected(),
      };
    }, newPseudo);
    const srv = (await apiFromPage(A.page, "/api/leaderboard", "GET")).json.leaderboard || [];
    /* Test d'authentification de la socket : le serveur ne répond « Non
       authentifié » qu'à une socket dont le message `auth` n'a pas abouti. */
    const sock = await A.page.evaluate(async () => {
      const seen = [];
      const fn = (m) => seen.push(m.message || m.type);
      window.API.on("error", fn);
      window.API.send({ type: "spectate", sessionId: "sonde-inexistante" });
      await new Promise((r) => setTimeout(r, 900));
      window.API.off("error", fn);
      return seen;
    });
    return `« ${newPseudo} » n'apparaît pas au classement sans recharger la page — client ${JSON.stringify(diag)} · ` +
      `serveur ${srv.length} joueur(s), présent côté serveur : ${srv.some((x) => x.pseudo === newPseudo)} · ` +
      `réponses socket : ${JSON.stringify(sock)}`;
  });

  await step("sa ligne porte le pseudo, l'Elo et le rang réels, et reste sans photo inventée", async () => {
    const html = await A.page.evaluate((p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      if (!row) return null;
      return {
        elo: (row.querySelector(".elo") || {}).innerText || "",
        rank: (row.querySelector(".mono") || {}).innerText || "",
        photo: !!row.querySelector(".who-line img"),
        link: !!row.querySelector(".who-pseudo[onclick]"),
        onclick: (row.querySelector(".who-pseudo") || {}).getAttribute("onclick") || "",
      };
    }, newPseudo);
    if (!html) return `ligne introuvable pour ${newPseudo}`;
    const src = (await apiFromPage(A.page, "/api/leaderboard", "GET")).json.leaderboard.find((p) => p.id === newId);
    if (!src) return "le joueur est absent de la réponse /api/leaderboard";
    if (html.elo.trim() !== String(src.elo)) return `Elo affiché « ${html.elo} » contre ${src.elo} côté API`;
    if (html.rank.trim() !== String(src.rank)) return `rang affiché « ${html.rank} » contre ${src.rank} côté API`;
    if (html.photo) return "une photo est affichée alors qu'aucune n'a été déposée";
    if (!html.link) return "le pseudo du classement n'ouvre pas de profil";
    if (!html.onclick.includes("openProfileById(" + newId + ")"))
      return `le lien n'utilise pas l'identifiant du joueur : « ${html.onclick} »`;
    return true;
  });

  await step("le lien du classement ouvre le profil du joueur visé (par identifiant)", async () => {
    await A.page.evaluate((p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      (row.querySelector(".who-pseudo") || {}).click();
    }, newPseudo);
    await sleep(1600);
    const hash = await A.page.evaluate(() => location.hash);
    if (!hash.includes("profile?id=" + newId)) return `route inattendue : « ${hash} »`;
    const shown = await until(A.page, (p) => {
      const r = document.getElementById("profile-root");
      return !!r && r.innerText.includes(p);
    }, newPseudo, 9000);
    return shown ? true : "le profil ouvert n'affiche pas le joueur visé";
  });
  /* ---- 2. Badge de l'icône Amis : allumé, éteint, et PERSISTANT ---- */
  await step("une demande d'ami allume le badge du destinataire (poussée serveur)", async () => {
    await goScreen(E.page, "home");
    const before = await dataOf(E.page);
    if (before.badge) return `le badge est déjà allumé avant toute demande (« ${before.badge} »)`;
    const r = await apiFromPage(A.page, "/api/friends/request", "POST", { pseudo: E.pseudo });
    if (r.status !== 200) return `demande d'ami refusée (${r.status}) : ${JSON.stringify(r.json)}`;
    const lit = await until(E.page, () => {
      const el = document.getElementById("btn-friends");
      return !!el && Number(el.getAttribute("data-count") || 0) >= 1;
    }, 12000);
    if (!lit) return "le badge ne s'allume pas chez le destinataire";
    const after = await dataOf(E.page);
    return /demande/i.test(after.title) ? true : `l'infobulle n'explique pas le badge (« ${after.title} »)`;
  });

  await step("ouvrir l'écran Amis éteint le badge, et la demande reste listée", async () => {
    await E.page.click("#btn-friends");
    await sleep(1500);
    const seen = await until(E.page, () => {
      const el = document.getElementById("btn-friends");
      return !!el && !el.getAttribute("data-count");
    }, 9000);
    if (!seen) return "le badge reste allumé après ouverture de l'écran Amis";
    return (await until(E.page, () => {
      const p = document.getElementById("freq-panel");
      return !!p && !!p.querySelector("[data-decline]");
    }, 9000)) ? true : "la demande reçue n'est plus visible dans l'écran Amis";
  });

  await step("APRÈS RECHARGEMENT le badge reste éteint (le repère est côté serveur)", async () => {
    await E.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(3000);
    const d = await dataOf(E.page);
    if (d.badge) return `le badge s'est rallumé après rechargement (« ${d.badge} »)`;
    const f = await apiFromPage(E.page, "/api/friends", "GET");
    if (f.json.newIncoming !== 0) return `l'API annonce ${f.json.newIncoming} demande(s) nouvelle(s) alors qu'elles ont été vues`;
    return (f.json.incoming || []).length === 1 ? true : "la demande en attente a disparu côté serveur";
  });

  await step("une relance après refus rallume le badge (nouvel identifiant)", async () => {
    await goScreen(E.page, "friends");
    await sleep(900);
    await E.page.locator("#freq-panel [data-decline]").first().click();
    await sleep(1400);
    /* On QUITTE l'écran Amis avant la relance : une demande qui arrive pendant
       qu'on regarde la liste est vue, donc elle n'a pas à allumer quoi que ce
       soit. Le badge se juge depuis un autre écran — là où il sert. */
    await goScreen(E.page, "home");
    await sleep(800);
    const r = await apiFromPage(A.page, "/api/friends/request", "POST", { pseudo: E.pseudo });
    if (r.status !== 200) return `relance refusée (${r.status}) : ${JSON.stringify(r.json)}`;
    const lit = await until(E.page, () => {
      const el = document.getElementById("btn-friends");
      return !!el && Number(el.getAttribute("data-count") || 0) >= 1;
    }, 12000);
    return lit ? true : "la relance n'allume pas le badge (demande comptée comme déjà vue)";
  });
  /* ---- 3. Photo de profil : une seule source, partout ---- */
  const Aid = (await apiFromPage(A.page, "/api/user", "GET")).json.user.id;
  await step("déposer une photo l'affiche AUSSITÔT dans la carte profil et le header", async () => {
    await goScreen(A.page, "profile");
    await sleep(900);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
    await A.page.setInputFiles("#avatar-input", { name: "photo.png", mimeType: "image/png", buffer: png });
    if (!(await until(A.page, () => !!document.querySelector("#profile-avatar img"), 15000)))
      return "la photo déposée n'apparaît pas dans la carte profil";
    const src = await A.page.evaluate(() => document.querySelector("#profile-avatar img").getAttribute("src"));
    const me = await apiFromPage(A.page, "/api/user", "GET");
    if (src !== me.json.user.avatar) return `photo du profil « ${src} » contre « ${me.json.user.avatar} » côté API`;
    const tb = (await dataOf(A.page)).tbAv;
    if (tb !== src) return `le header affiche « ${tb} » et la carte « ${src} » (sources divergentes)`;
    return true;
  });

  await step("l'accueil affiche la MÊME photo (aucune reconnexion nécessaire)", async () => {
    await goScreen(A.page, "home");
    await sleep(1300);
    const d = await dataOf(A.page);
    if (!d.dashAv) return "le cercle de l'accueil reste sur les initiales malgré la photo";
    if (d.dashAv !== d.tbAv) return `accueil « ${d.dashAv} » contre header « ${d.tbAv} »`;
    return true;
  });

  await step("un AUTRE joueur voit la même photo au classement et sur le profil public", async () => {
    await goScreen(B.page, "ranks");
    await sleep(1500);
    await B.page.evaluate((p) => {
      const el = document.getElementById("rank-search");
      el.value = p; el.dispatchEvent(new Event("input", { bubbles: true }));
    }, A.pseudo);
    const found = await until(B.page, (p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      return !!row && !!row.querySelector(".who-line img");
    }, A.pseudo, 10000);
    if (!found) return "le classement d'un autre joueur n'affiche pas la photo";
    const shown = await B.page.evaluate((p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      return (row.querySelector(".who-line img") || {}).getAttribute("src");
    }, A.pseudo);
    const pub = (await apiFromPage(B.page, "/api/users/" + Aid, "GET")).json.user.avatar;
    if (shown !== pub) return `le classement montre « ${shown} » contre « ${pub} » sur le profil public`;
    await B.page.evaluate((id) => window.App.openProfileById(id), Aid);
    await sleep(1700);
    const ppSrc = await B.page.evaluate(() => {
      const i = document.querySelector("#profile-root .big-avatar img");
      return i ? i.getAttribute("src") : null;
    });
    if (ppSrc !== pub) return `le profil public affiche « ${ppSrc} » contre « ${pub} » côté API`;
    return true;
  });
  /* ---- 4. Elo gagné/perdu : une partie classée, deux lectures ---- */
  let bid = null;
  await step("partie classée : les deux joueurs sont mis en file et acceptent", async () => {
    bid = (await apiFromPage(B.page, "/api/user", "GET")).json.user.id;
    /* L'assistant de partie MÉMORISE son étape : un scénario qui l'a utilisé (défi)
       le laisse à l'étape 4, et « Continuer » y lancerait une partie au lieu
       d'avancer. Passer par un autre écran le fait repartir de l'étape 1 — c'est
       le comportement de l'application, pas un contournement de test. */
    for (const P of [A, B]) {
      await dismissModals(P.page);
      /* L'assistant de partie REPREND l'étape laissée (S12 l'a mené à l'étape 4 du
         défi) : on revient à l'étape 1 par la pastille de navigation, le geste réel
         d'un joueur qui veut une nouvelle partie. Un simple changement d'écran ne
         suffit pas — l'étape est conservée volontairement par l'application. */
      await goScreen(P.page, "play");
      const dot = P.page.locator('#play-root .pg-dot[data-goto="1"]');
      if (await dot.count()) { await dot.first().click(); await sleep(450); }
    }
    for (const P of [A, B]) {
      const r = await wizard(P.page, { mode: "online", fmt: "blitz" });
      if (r !== true) {
        const diag = await P.page.evaluate(() => {
          const pr = document.getElementById("play-root");
          return {
            etape: (pr ? pr.innerText : "").slice(0, 120).replace(/\s+/g, " "),
            cta: (document.getElementById("pg-cta") || {}).innerText || "",
          };
        });
        return `assistant indisponible pour ${P.pseudo} : ${r} — écran « ${diag.etape} » (bouton « ${diag.cta} »)`;
      }
      await P.page.click("#pg-cta");
    }
    await sleep(1400);
    const okA = await waitVisible(A.page, "#mm-accept", 30000);
    const okB = await waitVisible(B.page, "#mm-accept", 30000);
    if (!okA || !okB) return `proposition de match absente (${okA} / ${okB})`;
    await A.page.click("#mm-accept");
    await B.page.click("#mm-accept");
    const pileA = await waitVisible(A.page, "#choose-pile", 25000);
    const pileB = await waitVisible(B.page, "#choose-pile", 25000);
    return pileA && pileB ? true : "tirage au sort non proposé après acceptation";
  });

  await step("abandon immédiat : la partie se termine et l'Elo est consigné", async () => {
    const pick = async (page, preferred) => {
      const id = await page.evaluate((pref) => {
        const other = pref === "choose-pile" ? "choose-face" : "choose-pile";
        for (const i of [pref, other]) {
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
    const ready = (page) => until(page, () => {
      const g = window.Fanorona.state();
      return !!g && !g.over && !g.spectator && document.querySelectorAll(".piece.me").length > 0;
    }, 25000);
    if (!(await ready(A.page))) return "le plateau ne s'ouvre pas chez le premier joueur";
    if (!(await ready(B.page))) return "le plateau ne s'ouvre pas chez le second joueur";
    await A.page.click("#btn-resign");
    await sleep(700);
    if (!(await visible(A.page, "#resign-ok"))) return "confirmation d'abandon non affichée";
    await A.page.click("#resign-ok");
    await sleep(3200);
    return true;
  });
  await step("le perdant lit un delta NÉGATIF avec son Elo avant → après (accueil)", async () => {
    await goScreen(A.page, "home");
    /* L'actualisation est asynchrone (la partie vient de se terminer) : on ATTEND
       la ligne, au lieu de lire une seule fois au risque de juger un état périmé. */
    await until(A.page, (p) => {
      const el = [...document.querySelectorAll("#home-root .feed-item")].find((f) => f.innerText.includes(p));
      return !!el && /Elo/.test(el.innerText);
    }, B.pseudo, 15000);
    const row = await A.page.evaluate((p) => {
      const el = [...document.querySelectorAll("#home-root .feed-item")]
        .find((f) => f.innerText.includes(p));
      return el ? el.innerText.replace(/\s+/g, " ") : null;
    }, B.pseudo);
    if (!row) return `aucune ligne de partie contre ${B.pseudo} à l'accueil`;
    if (/undefined|NaN|null/.test(row)) return `valeur invalide affichée : « ${row} »`;
    if (!/Défaite/i.test(row)) return `la ligne n'annonce pas la défaite : « ${row} »`;
    if (!/-\d+ Elo/.test(row)) return `aucun Elo perdu lisible : « ${row} »`;
    if (!/\d{3,4}\s*→\s*\d{3,4}/.test(row)) return `l'Elo avant → après est absent : « ${row} »`;
    return true;
  });

  await step("le nom cliquable ouvre le profil du vainqueur, qui lit un delta POSITIF", async () => {
    const linked = await A.page.evaluate((p) => {
      const el = [...document.querySelectorAll("#home-root .feed-item")]
        .find((f) => f.innerText.includes(p));
      const link = el && el.querySelector(".link-pseudo");
      if (!link) return false;
      link.click();
      return true;
    }, B.pseudo);
    if (!linked) return `le nom de ${B.pseudo} n'est pas un lien dans « Dernières parties »`;
    await sleep(1900);
    const hash = await A.page.evaluate(() => location.hash);
    if (!hash.includes("profile?id=" + bid)) return `le lien n'ouvre pas le profil visé : « ${hash} »`;
    const txt = await A.page.evaluate(() => document.getElementById("profile-root").innerText.replace(/\s+/g, " "));
    const bad = /(undefined|NaN)/.exec(txt);
    if (bad) return `valeur invalide sur le profil public : « ${txt.slice(Math.max(0, bad.index - 60), bad.index + 60)} »`;
    if (!/Victoire/i.test(txt)) return "le profil du vainqueur n'affiche pas sa victoire";
    if (!/\+\d+ Elo/.test(txt)) return "le vainqueur n'affiche pas un gain d'Elo positif";
    if (!/\d{3,4}\s*→\s*\d{3,4}/.test(txt)) return "l'Elo avant → après manque sur le profil du vainqueur";
    return true;
  });

  await step("les valeurs affichées correspondent à l'historique du SERVEUR (deux camps)", async () => {
    const hA = (await apiFromPage(A.page, "/api/games/history", "GET")).json.games
      .find((g) => g.winner_id !== null && g.elo1_before !== null);
    if (!hA) return "aucune partie classée avec instantané d'Elo dans l'historique";
    const sA = hA.player1_id === Aid ? 1 : 2;
    const beforeA = sA === 1 ? hA.elo1_before : hA.elo2_before;
    const afterA = sA === 1 ? hA.elo1_after : hA.elo2_after;
    const deltaA = sA === 1 ? hA.delta1 : hA.delta2;
    if (afterA !== beforeA + deltaA) return `incohérence serveur : ${beforeA} + ${deltaA} ≠ ${afterA}`;
    if (deltaA >= 0) return `le perdant devrait avoir un delta négatif (${deltaA})`;
    const hB = (await apiFromPage(B.page, "/api/games/history", "GET")).json.games.find((g) => g.id === hA.id);
    if (!hB) return "la partie n'apparaît pas dans l'historique du vainqueur";
    const sB = hB.player1_id === bid ? 1 : 2;
    const deltaB = sB === 1 ? hB.delta1 : hB.delta2;
    if (deltaB <= 0) return `le vainqueur devrait avoir un delta positif (${deltaB})`;
    const txt = await A.page.evaluate(() => document.getElementById("profile-root").innerText);
    const shown = /\+\s?(\d+) Elo/.exec(txt);
    return shown && Number(shown[1]) === deltaB ? true
      : `le profil annonce « ${shown ? shown[1] : "aucun"} Elo » et le serveur ${deltaB} Elo`;
  });

  /* ---- 5. Aucune valeur technique visible sur les écrans principaux ---- */
  await step("aucun « undefined », « NaN » ni « [object Object] » sur les écrans visités", async () => {
    const routes = ["home", "play", "match", "ranks", "tournament", "wallet", "skins", "profile", "friends", "settings"];
    const bad = [];
    for (const r of routes) {
      await goScreen(A.page, r);
      await sleep(800);
      const hit = await A.page.evaluate(() => {
        const txt = document.body.innerText || "";
        const m = /(undefined|NaN|\[object Object\])/.exec(txt);
        return m ? txt.slice(Math.max(0, m.index - 70), m.index + 70).replace(/\s+/g, " ") : null;
      });
      if (hit) bad.push(`${r} : « ${hit} »`);
    }
    return bad.length ? bad.slice(0, 3).join(" | ") : true;
  });
}
