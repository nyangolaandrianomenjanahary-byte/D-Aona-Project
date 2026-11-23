/* =========================================================================
   D-aôna — CAPTURES D'ÉCRAN DU SUPPORT DE FORMATION (docs/formation-admin)
   -------------------------------------------------------------------------
   Produit les 15 images du support « Administration — prise en main » à
   partir d'une instance JETABLE du serveur :

     · base NEUVE dans un dossier temporaire (migrations appliquées au
       démarrage par db.js) — la base réelle n'est jamais ouverte ;
     · un compte d'ancrage « GuideAdmin » inscrit par le VRAI formulaire,
       puis `demo_seed.js` (8 joueurs Demo*, tournois, transactions) et
       `admin_grant.js grant … super_admin` : les écrans ont du contenu ;
     · six dossiers d'identité SYNTHÉTIQUES (les deux PNG de
       test/kyc_fixtures.js) → file de revue crédible : trois en attente,
       deux validés, un refusé avec motif ;
     · aucune donnée personnelle : ni les 18 comptes réels, ni les pièces
       de `private/kyc/` (gitignoré) n'apparaissent sur les images.

   Usage :  node test/ui/capture_admin.js
   Sortie : ../docs/formation-admin/captures/NN-nom.jpg  (+ récapitulatif)
   Port   : 8097 (D_AONA_CAPTURE_PORT pour changer) — jamais 8080.
   ========================================================================= */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const KYCX = require("../kyc_fixtures");

const SERVER_DIR = path.join(__dirname, "..", "..");
const REPO = path.join(SERVER_DIR, "..");
const OUT = path.join(REPO, "docs", "formation-admin", "captures");
const PORT = Number(process.env.D_AONA_CAPTURE_PORT || 8097);
const BASE = "http://127.0.0.1:" + PORT;

/* Compte d'ancrage du support. Mot de passe conforme à la politique du
   serveur (12 caractères minimum, majuscule, minuscule, chiffre, symbole). */
const ADMIN = { pseudo: "GuideAdmin", pwd: "Scenario!2026Zz" };
/* Mot de passe PUBLIC des comptes de démonstration (demo_seed.js). */
const DEMO_PWD = "Demo!2026Zz9";
/* Les six dossiers d'identité fabriqués : trois en attente, deux validés, un
   refusé — une file de revue crédible. Comptes NEUFS, aux pseudos neutres :
   ceux de demo_seed.js arrivent déjà vérifiés (DEJA_VERIFIE) et l'on ne veut
   aucune pièce réelle sur les images. */
const KYC_PLAN = [
  { pseudo: "AinaRakoto", decision: "pending" },
  { pseudo: "TojoRabe", decision: "pending" },
  { pseudo: "MioraBao", decision: "pending" },
  { pseudo: "FaraNirina", decision: "approve" },
  { pseudo: "HeryTiana", decision: "approve" },
  { pseudo: "NainaSoa", decision: "reject" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const shots = [];

/* ---------- Utilitaires ---------- */
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

function startServer(dbPath) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      D_AONA_PORT: String(PORT),
      D_AONA_DB_PATH: dbPath,
      /* Une campagne qui inscrit plusieurs comptes depuis la même adresse ne
         doit pas se limiter elle-même (même raison que la campagne UI). */
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
    try { const r = await fetch(BASE + "/api/user"); if (r.status) return; } catch (e) { /* pas encore */ }
    await sleep(250);
  }
  throw new Error("le serveur jetable n'a pas démarré sur le port " + PORT);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill(); } catch (e) { clearTimeout(t); resolve(); }
  });
}

async function until(page, fn, arg, ms) {
  if (typeof arg === "number" && ms === undefined) { ms = arg; arg = null; }
  ms = ms || 15000;
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

async function gotoApp(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#auth-form", { timeout: 20000 });
}

/* Inscription par le formulaire réel (mêmes sélecteurs que la campagne UI). */
async function uiSignup(page, pseudo) {
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
  if (!step2) throw new Error("étape 2 de l'inscription non affichée");
  await page.selectOption("#su-province", "Antananarivo");
  await page.fill("#su-pass", ADMIN.pwd);
  await page.fill("#su-pass2", ADMIN.pwd);
  await page.click("#su-enter");
  const ok = await until(page, () => document.getElementById("auth").classList.contains("hidden"), 20000);
  if (!ok) throw new Error("le compte d'ancrage n'est pas connecté après inscription");
  await sleep(800);
}

async function uiLogin(page, pseudo, pwd) {
  await gotoApp(page);
  await page.fill("#auth-id", pseudo);
  await page.fill("#auth-pass", pwd);
  await page.click("#auth-enter");
  const ok = await until(page, () => document.getElementById("auth").classList.contains("hidden"), 20000);
  if (!ok) throw new Error("connexion impossible pour " + pseudo);
  await sleep(900);
}

/* ---------- Appels HTTP directs (préparation des données, pas des captures) ---------- */
async function api(p, method, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* corps non JSON */ }
  return { status: r.status, json };
}

async function apiLogin(pseudo, password) {
  const r = await api("/api/auth/login", "POST", { pseudo, password });
  if (r.status !== 200 || !r.json || !r.json.token)
    throw new Error(`connexion ${pseudo} : ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.token;
}

/* ---------- Captures ---------- */
async function shot(page, name) {
  const file = path.join(OUT, name + ".jpg");
  await page.screenshot({ path: file, type: "jpeg", quality: 84 });
  const ko = Math.round(fs.statSync(file).size / 1024);
  shots.push({ name: name + ".jpg", ko });
  log(`  [ok] ${name}.jpg  (${ko} Ko)`);
}

async function admView(page, view) {
  await page.evaluate((v) => window.App.adminShow(v), view);
  await sleep(300);
}

async function capture(page) {
  /* 01 — le bouton d'entrée, dans le bloc « liens wallet » du Profil. */
  await gotoApp(page);
  await page.evaluate(() => window.App.go("profile"));
  const profileOk = await until(page, () => {
    const s = document.getElementById("screen-profile");
    return !!s && s.classList.contains("active");
  }, 10000);
  if (!profileOk) throw new Error("l'écran Profil ne s'est pas affiché");
  /* Le profil se re-rend après chaque appel réseau (solde, pubs, amis) :
     jamais de handle d'élément, on interroge le DOM à chaque fois. */
  const admPresent = () => Array.from(document.querySelectorAll(".pf3-wallet-links button"))
    .some((b) => /Administration/.test(b.textContent || ""));
  let found = await until(page, admPresent, 20000);
  if (!found) {
    /* Le premier rendu peut précéder la réponse /api/admin/me : on recharge
       une fois, comme le ferait un joueur devant un bouton absent. */
    log("     bouton absent — rechargement de la page");
    await page.reload({ waitUntil: "domcontentloaded" });
    await until(page, () => document.getElementById("auth").classList.contains("hidden"), 20000);
    await page.evaluate(() => window.App.go("profile"));
    found = await until(page, admPresent, 20000);
  }
  if (!found) {
    const diag = await page.evaluate(async () => {
      const t = localStorage.getItem("daona_token") || "";
      let status = 0, body = null;
      try {
        const r = await fetch("/api/admin/me", { headers: { Authorization: "Bearer " + t } });
        status = r.status;
        body = await r.json();
      } catch (e) { body = String(e && e.message); }
      const s = window.App.state();
      return {
        hash: location.hash,
        ecran: (document.querySelector(".screen.active") || {}).id || "(aucun)",
        token: t ? t.slice(0, 8) + "…" : "(vide)",
        adminMe: s.admin && s.admin.me ? (s.admin.me.roles || s.admin.me) : null,
        apiStatus: status,
        apiBody: body,
      };
    });
    throw new Error("bouton « Administration » absent du Profil — diag " + JSON.stringify(diag).slice(0, 500));
  }
  await sleep(1500);   // laisse les rendus asynchrones se poser
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".pf3-wallet-links button"))
      .find((x) => /Administration/.test(x.textContent || ""));
    const card = document.getElementById("pf3-bank") || b;
    if (card) card.scrollIntoView({ block: "center" });
  });
  await sleep(600);
  await shot(page, "01-profil-bouton");

  /* 02 — le hub des modules. */
  await page.evaluate(() => window.App.go("admin"));
  await until(page, () => document.querySelectorAll(".adm-card").length >= 9, 20000);
  await sleep(600);
  await shot(page, "02-modules");

  /* 03 — tableau de bord. */
  await admView(page, "dashboard");
  await until(page, () => document.querySelectorAll(".adm-kpi").length > 0, 20000);
  await sleep(500);
  await shot(page, "03-tableau-de-bord");

  /* 04 — file de revue des identités. */
  await admView(page, "kyc");
  await until(page, () => !!document.querySelector("table.adm-table tbody tr"), 20000);
  await sleep(500);
  await shot(page, "04-kyc-file");

  /* 05 (agrandi du tableau KYC) n'est PAS pris ici : c'est un recadrage de
     04 produit par build_pptx.py — l'ouverture d'une pièce occupe tout
     l'écran (aplat de test illisible) et le motif de refus passe par le
     `prompt()` natif du navigateur, invisible sur une capture. */

  /* 06 — onglet « Refusés » : la décision et son motif sont conservés. */
  await admView(page, "kyc");
  await until(page, () => !!document.querySelector('[data-kyc-tab="rejected"]'), 15000);
  await page.evaluate(() => document.querySelector('[data-kyc-tab="rejected"]').click());
  await until(page, () => !!document.querySelector("table.adm-table tbody tr"), 20000);
  await sleep(500);
  await shot(page, "06-kyc-refuses");

  /* 07 — joueurs. */
  await admView(page, "users");
  await until(page, () => document.querySelectorAll("table.adm-table tbody tr").length > 3, 20000);
  await sleep(500);
  await shot(page, "07-joueurs");

  /* 08 — publicités, formulaire de création ouvert. */
  await admView(page, "ads");
  await until(page, () => document.querySelectorAll(".adm-card").length >= 2, 20000);
  const newAd = await until(page, () => !!document.querySelector("#adm-ad-new"), 10000);
  if (newAd) { await page.evaluate(() => document.querySelector("#adm-ad-new").click()); await sleep(700); }
  await shot(page, "08-publicites");

  /* 09 — tournois. */
  await admView(page, "tournaments");
  await until(page, () => document.querySelectorAll("table.adm-table tbody tr").length > 0, 20000);
  await sleep(500);
  await shot(page, "09-tournois");

  /* 10 — comptabilité. */
  await admView(page, "accounting");
  await until(page, () => document.querySelectorAll(".adm-kpi").length >= 4, 20000);
  await sleep(500);
  await shot(page, "10-comptabilite");

  /* 11 — classement Elo. */
  await admView(page, "elo");
  await until(page, () => {
    const b = document.getElementById("adm-body");
    return !!b && b.querySelectorAll("table.adm-table tbody tr").length > 2;
  }, 20000);
  await sleep(500);
  await shot(page, "11-elo");

  /* 12 — badges. */
  await admView(page, "badges");
  await until(page, () => {
    const b = document.getElementById("adm-body");
    return !!b && b.querySelectorAll("table.adm-table tbody tr").length > 2;
  }, 20000);
  await sleep(500);
  await shot(page, "12-badges");

  /* 13 — rôles et permissions (un rôle non protégé, pour montrer la matrice). */
  await admView(page, "roles");
  await until(page, () => !!document.querySelector('[data-role-tab="moderation"]'), 20000);
  await page.evaluate(() => document.querySelector('[data-role-tab="moderation"]').click());
  await until(page, () => document.querySelectorAll("table.adm-table tbody tr").length > 5, 20000);
  await sleep(500);
  await shot(page, "13-roles");

  /* 14 — journal d'audit. */
  await admView(page, "audit");
  await until(page, () => document.querySelectorAll("table.adm-table tbody tr").length > 0, 20000);
  await sleep(500);
  await shot(page, "14-journal");
}

/* Sur téléphone : le hub doit rester lisible (une colonne). */
async function captureMobile(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR", isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await uiLogin(page, ADMIN.pseudo, ADMIN.pwd);
  await page.evaluate(() => window.App.go("admin"));
  await until(page, () => document.querySelectorAll(".adm-card").length >= 9, 20000);
  /* Les messages de bienvenue recouvrent l'en-tête : on attend qu'ils
     s'effacent (ils disparaissent seuls) avant de déclencher. */
  await until(page, () => document.querySelectorAll("#toasts > *").length === 0, 20000);
  await sleep(900);
  await shot(page, "15-modules-mobile");
  await ctx.close();
}

/* ---------- Programme ---------- */
(async () => {
  log("=== Captures du support de formation — Administration ===");
  if (!(await portFree(PORT))) throw new Error(`le port ${PORT} est déjà occupé : libérez-le ou changez D_AONA_CAPTURE_PORT`);
  if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
  else fs.mkdirSync(OUT, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daona-formation-"));
  const dbPath = path.join(tmpDir, "formation.db");
  let server = null;
  let browser = null;
  let failed = false;

  try {
    /* 1. Instance jetable sur une base neuve. */
    log("\n1/6  base neuve + serveur jetable sur le port " + PORT);
    server = startServer(dbPath);
    await waitServer();
    log("     serveur prêt — base : " + dbPath);

    /* 2. Compte d'ancrage, inscrit par le vrai formulaire. */
    log("\n2/6  inscription du compte d'ancrage « " + ADMIN.pseudo + " »");
    browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
    const page = await ctx.newPage();
    await uiSignup(page, ADMIN.pseudo);

    /* 3. Jeu de démonstration + rôle (serveur arrêté : un seul écrivain). */
    log("\n3/6  données de démonstration + rôle super_admin");
    await stopServer(server); server = null;
    const env = { ...process.env, D_AONA_DB_PATH: dbPath };
    const seed = spawnSync(process.execPath, ["demo_seed.js", "--user", ADMIN.pseudo, "--yes"],
      { cwd: SERVER_DIR, env, encoding: "utf8" });
    if (seed.status !== 0) throw new Error("demo_seed.js a échoué : " + (seed.stderr || seed.stdout || "").slice(0, 400));
    log("     demo_seed.js : " + (seed.stdout || "").trim().split("\n").slice(-1)[0]);
    const grant = spawnSync(process.execPath, ["admin_grant.js", "grant", ADMIN.pseudo, "super_admin"],
      { cwd: SERVER_DIR, env, encoding: "utf8" });
    if (grant.status !== 0) throw new Error("admin_grant.js a échoué : " + (grant.stderr || grant.stdout || "").slice(0, 400));
    log("     " + (grant.stdout || "").trim());

    /* 4. Dossiers d'identité synthétiques (aucune pièce réelle). */
    log("\n4/6  dossiers d'identité synthétiques (fixtures PNG)");
    server = startServer(dbPath);
    await waitServer();
    const cases = [];
    for (const p of KYC_PLAN) {
      /* Compte neuf par l'API : même chemin que le formulaire, mais sans
         interface à piloter — ces comptes ne servent qu'à remplir la file. */
      const reg = await api("/api/auth/register", "POST", {
        pseudo: p.pseudo, password: DEMO_PWD, province: "Antananarivo",
        phone: "034" + String(Math.floor(Math.random() * 9000000 + 1000000)),
        email: p.pseudo.toLowerCase() + "@exemple.mg",
      });
      if (reg.status !== 200) throw new Error(`inscription ${p.pseudo} : ${reg.status} ${JSON.stringify(reg.json)}`);
      const t = reg.json.token;
      const s = await api("/api/kyc/submit", "POST", { recto: KYCX.recto(), verso: KYCX.verso() }, t);
      if (s.status !== 200) throw new Error(`dossier ${p.pseudo} : ${s.status} ${JSON.stringify(s.json)}`);
      cases.push({ ...p, id: s.json.caseId });
      log(`     ${p.pseudo} → dossier #${s.json.caseId}`);
    }
    const admToken = await apiLogin(ADMIN.pseudo, ADMIN.pwd);
    for (const c of cases.filter((x) => x.decision !== "pending")) {
      const r = c.decision === "approve"
        ? await api(`/api/admin/kyc/${c.id}/approve`, "POST", {}, admToken)
        : await api(`/api/admin/kyc/${c.id}/reject`, "POST",
            { reason: "Recto illisible (photo floue) : merci de renvoyer une photo nette de la carte." }, admToken);
      if (r.status !== 200) throw new Error(`décision ${c.pseudo} : ${r.status} ${JSON.stringify(r.json)}`);
      log(`     #${c.id} → ${c.decision === "approve" ? "validé" : "refusé"}`);
    }

    /* 5. Captures. */
    log("\n5/6  captures d'écran (1440x900, JPEG)");
    await capture(page);
    await captureMobile(browser);

    /* 6. Récapitulatif. */
    const total = shots.reduce((n, s) => n + s.ko, 0);
    log(`\n6/6  ${shots.length} images, ${Math.round(total / 1024 * 10) / 10} Mo → ${OUT}`);
  } catch (e) {
    failed = true;
    console.error("\nECHEC : " + (e && e.message ? e.message : e));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    await stopServer(server);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    log("     nettoyage : serveur arrêté, base temporaire supprimée");
  }
  process.exit(failed ? 1 : 0);
})();
