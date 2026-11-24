/* =========================================================================
   D-aôna — EXPORT HTML STATIQUE DE L'ESPACE D'ADMINISTRATION (maquette)
   -------------------------------------------------------------------------
   Produit UN fichier HTML autonome sur le Bureau :

       %USERPROFILE%\Desktop\D-aona - Administration (démo).html

   À quoi ça sert : retoucher le back-office à la main (hiérarchie, densité
   des tableaux, espacements, libellés) dans un navigateur, sans serveur,
   sans base et sans compte — puis reporter les retenues dans
   `d-aona-web/index.html`, dont le fichier exporté reprend le CSS À
   L'IDENTIQUE.

   Comment le fichier est fabriqué (rien n'est redessiné à la main) :
     · instance JETABLE (port 8098, base temporaire, jamais la vraie base) :
       même préparation que test/ui/capture_admin.js — seed de démonstration,
       six dossiers d'identité synthétiques, rôle super_admin. Le bootstrap
       est repris ici plutôt qu'importé : capture_admin.js est le script du
       support de formation, on ne le refactore pas pour un export ;
     · pour CHAQUE vue (11), le DOM RÉEL rendu par l'application est cloné
       (#screen-admin) : mêmes classes, mêmes libellés, mêmes tableaux, mêmes
       états (module coupé, dossier refusé, bannière masquée…) ;
     · le CSS est extrait tel quel du bloc <style> de index.html ;
     · les attributs on* sont retirés (aucun appel réseau possible), les
       images sont inlinées en data URI, les formulaires neutralisés ;
     · une barre « démo » (hors application) permet de passer d'une vue à
       l'autre et de basculer jour/nuit.

   Aucune donnée personnelle : les comptes réels et les pièces de
   private/kyc/ (gitignoré) n'apparaissent jamais — seuls les comptes Demo*
   et les fixtures PNG du dépôt sont utilisés.

   Usage  : node test/ui/export_admin_html.js
   Sortie : <Bureau>/D-aona - Administration (démo).html
            (D_AONA_EXPORT_OUT pour écrire ailleurs)
   Port   : 8098 (D_AONA_EXPORT_PORT) — jamais 8080.
   ========================================================================= */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const KYCX = require("../kyc_fixtures");

const SERVER_DIR = path.join(__dirname, "..", "..");
const PORT = Number(process.env.D_AONA_EXPORT_PORT || 8098);
const BASE = "http://127.0.0.1:" + PORT;
const OUT = process.env.D_AONA_EXPORT_OUT
  || path.join(os.homedir(), "Desktop", "D-aona - Administration (démo).html");
const PREVIEW = path.join(os.tmpdir(), "daona_html_preview");

/* Compte d'ancrage (même politique de mot de passe que le serveur). */
const ADMIN = { pseudo: "GuideAdmin", pwd: "Scenario!2026Zz" };
/* Mot de passe public des comptes de démonstration (demo_seed.js). */
const DEMO_PWD = "Demo!2026Zz9";
/* Six dossiers fabriqués : trois en attente, deux validés, un refusé. */
const KYC_PLAN = [
  { pseudo: "AinaRakoto", decision: "pending" },
  { pseudo: "TojoRabe", decision: "pending" },
  { pseudo: "MioraBao", decision: "pending" },
  { pseudo: "FaraNirina", decision: "approve" },
  { pseudo: "HeryTiana", decision: "approve" },
  { pseudo: "NainaSoa", decision: "reject" },
];
/* Les vues de l'administration (ADM_VIEWS de index.html) : id, libellé,
   pastille de la barre de navigation de la maquette. */
const VIEWS = [
  ["modules", "Modules", "⚙"],
  ["dashboard", "Tableau de bord", "▤"],
  ["kyc", "Vérification d'identité", "◫"],
  ["users", "Joueurs", "☺"],
  ["tournaments", "Tournois", "♛"],
  ["accounting", "Comptabilité", "∑"],
  ["elo", "Classement Elo", "▲"],
  ["badges", "Badges", "★"],
  ["roles", "Rôles et permissions", "⚿"],
  ["audit", "Journal", "≡"],
  ["ads", "Publicités", "▭"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ---------- Utilitaires (repris de capture_admin.js) ---------- */
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
      /* Plusieurs comptes créés depuis la même adresse : le limiteur de débit
         ne doit pas se retourner contre la préparation elle-même. */
      D_AONA_RATE_LIMIT: "5000",
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
  await page.fill("#su-phone", "034" + Math.floor(Math.random() * 9000000 + 1000000));
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

/* ---------- Appels HTTP directs (préparation des données) ---------- */
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

/* ---------- Instantané d'une vue ---------- */
/* Ouvre la vue dans la vraie application, attend la fin de son chargement,
   puis rapporte une copie du DOM dans laquelle plus rien ne peut s'exécuter. */
async function snapshot(page, view) {
  await page.evaluate((v) => window.App.adminShow(v), view);
  const ready = await until(page, () => {
    const r = document.getElementById("admin-root");
    return !!r && !r.querySelector(".adm-loading");
  }, 25000);
  if (!ready) throw new Error("vue « " + view + " » : le chargement n'a pas abouti");
  await sleep(250);
  return page.evaluate(async (v) => {
    const sec = document.getElementById("screen-admin");
    if (!sec) throw new Error("écran d'administration introuvable");

    /* Bannières et vignettes : `assets/` n'existe pas à côté du fichier
       exporté. Chaque image devient donc un data URI (une image déjà en
       data: est laissée telle quelle) ; une image illisible est retirée. */
    for (const img of sec.querySelectorAll("img")) {
      const raw = img.getAttribute("src") || "";
      if (!raw || /^data:/i.test(raw)) continue;
      try {
        const res = await fetch(img.src);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const url = await new Promise((ok, no) => {
          const fr = new FileReader();
          fr.onload = () => ok(String(fr.result));
          fr.onerror = () => no(new Error("lecture impossible"));
          fr.readAsDataURL(blob);
        });
        img.setAttribute("src", url);
        img.removeAttribute("onerror");
      } catch (e) { img.removeAttribute("src"); }
    }

    const clone = sec.cloneNode(true);
    clone.id = "demo-" + v;
    clone.classList.remove("active");
    clone.setAttribute("data-demo-view", v);

    /* 1. Aucun gestionnaire inline : la maquette ne peut rien déclencher
          (ni fetch, ni prompt, ni navigation). */
    for (const el of clone.querySelectorAll("*")) {
      for (const at of Array.from(el.attributes)) {
        if (/^on/i.test(at.name)) el.removeAttribute(at.name);
      }
    }
    /* 2. Liens internes de l'application neutralisés. */
    for (const a of clone.querySelectorAll("a[href]")) a.setAttribute("href", "#");
    /* 3. Identifiants préfixés : onze copies d'un même écran cohabitent dans
          un seul document, et un id n'y apparaît qu'une fois. Les références
          (for=, aria-*) suivent le renommage. */
    const P = v + "--";
    for (const el of clone.querySelectorAll("[id]")) el.id = P + el.id;
    for (const at of ["for", "aria-controls", "aria-labelledby", "aria-describedby", "list", "form"]) {
      for (const el of clone.querySelectorAll("[" + at + "]")) {
        const val = el.getAttribute(at) || "";
        if (val && !val.includes(" ")) el.setAttribute(at, P + val);
      }
    }
    return clone.outerHTML;
  }, view);
}

/* ---------- CSS réel de l'application ---------- */
async function collectCss(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent).join("\n"));
}

/* ---------- Chrome de l'application (barre du haut) ---------- */
async function collectChrome(page) {
  return page.evaluate(() => {
    const t = document.querySelector(".topbar");
    if (!t) return "";
    const c = t.cloneNode(true);
    for (const el of c.querySelectorAll("*")) {
      for (const at of Array.from(el.attributes)) {
        if (/^on/i.test(at.name)) el.removeAttribute(at.name);
      }
    }
    c.querySelectorAll("a[href]").forEach((a) => a.setAttribute("href", "#"));
    c.querySelectorAll("button").forEach((b) => b.setAttribute("type", "button"));
    c.classList.add("demo-static");
    return c.outerHTML;
  });
}

/* ---------- État du document au moment de l'export ---------- */
async function collectEnv(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme") || "",
    bodyClass: document.body.className || "",
  }));
}

/* ---------- Coque de la maquette (hors application) ---------- */
const SHELL_CSS = `
/* ===== COQUE DE LA MAQUETTE — règles ABSENTES de index.html ==============
   Elles n'habillent que la barre de navigation de la maquette : aucune
   n'est à reporter dans l'application. */
.demo-bar {
  position: sticky; top: 0; z-index: 2147483000;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 14px;
  background: #14141F; color: #F2EDE3;
  font: 600 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  border-bottom: 1px solid rgba(255, 255, 255, .14);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .22);
}
.demo-badge {
  background: #E5A83B; color: #14141F; font-weight: 800; letter-spacing: .08em;
  font-size: 11px; padding: 3px 9px; border-radius: 999px;
}
.demo-note { font-weight: 500; color: rgba(242, 237, 227, .66); font-size: 12px; }
.demo-nav {
  display: flex; gap: 6px; overflow-x: auto; max-width: 100%;
  padding: 2px 0; scrollbar-width: thin;
}
.demo-tab {
  flex: 0 0 auto; font: inherit; font-size: 12.5px; cursor: pointer;
  color: rgba(242, 237, 227, .78); background: rgba(255, 255, 255, .07);
  border: 1px solid rgba(255, 255, 255, .16); border-radius: 999px; padding: 5px 11px;
}
.demo-tab:hover { background: rgba(255, 255, 255, .14); color: #ffffff; }
.demo-tab[aria-selected="true"] { background: #F2EDE3; color: #14141F; border-color: #F2EDE3; }
.demo-spacer { flex: 1 1 auto; }
#demo-theme {
  font: inherit; font-size: 12.5px; cursor: pointer; color: #F2EDE3;
  background: transparent; border: 1px solid rgba(255, 255, 255, .28);
  border-radius: 999px; padding: 5px 11px;
}
/* La barre du haut de l'application est « sticky » : dans la maquette elle
   défile avec le contenu, sinon elle se collerait SOUS la barre démo. */
.topbar.demo-static { position: static; }
/* #screens réserve 110 px pour la barre d'onglets du bas, absente ici. */
#screens { padding-bottom: 28px; }
`;

/* ---------- Navigation de la maquette + bascule jour/nuit ---------- */
const DEMO_JS = `
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".demo-tab"));
  var screens = Array.prototype.slice.call(document.querySelectorAll(".screen"));
  function show(v, push) {
    var found = false;
    screens.forEach(function (s) {
      var on = s.getAttribute("data-demo-view") === v;
      s.classList.toggle("active", on);
      if (on) found = true;
    });
    if (!found) return;
    tabs.forEach(function (t) {
      t.setAttribute("aria-selected", t.getAttribute("data-demo-view") === v ? "true" : "false");
    });
    window.scrollTo(0, 0);
    if (push) { try { history.replaceState(null, "", "#" + v); } catch (e) {} }
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { show(t.getAttribute("data-demo-view"), true); });
  });
  var h = (location.hash || "").replace(/^#/, "");
  var known = tabs.some(function (t) { return t.getAttribute("data-demo-view") === h; });
  show(known ? h : "modules", false);

  /* L'application n'écrit l'attribut que pour la nuit ; son absence vaut jour. */
  var th = document.getElementById("demo-theme");
  function paint() {
    var night = document.documentElement.getAttribute("data-theme") === "night";
    th.textContent = night ? "\\u2600 Jour" : "\\u263e Nuit";
    th.setAttribute("aria-pressed", night ? "true" : "false");
  }
  if (th) {
    th.addEventListener("click", function () {
      if (document.documentElement.getAttribute("data-theme") === "night")
        document.documentElement.removeAttribute("data-theme");
      else
        document.documentElement.setAttribute("data-theme", "night");
      paint();
    });
    paint();
  }
  /* Aucun formulaire de la maquette ne doit soumettre. */
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);
})();
`;

/* ---------- Mode d'emploi inséré en tête du fichier exporté ---------- */
const GUIDE_HTML = `<!-- ==========================================================================
     MAQUETTE STATIQUE — AUCUN SERVEUR, AUCUNE DONNÉE RÉELLE.

     Instantané de l'espace d'administration de D-aôna, produit par
     d-aona-server/test/ui/export_admin_html.js à partir d'une base JETABLE
     (comptes Demo*, dossiers d'identité synthétiques).

     COMMENT S'EN SERVIR
     ───────────────────
     · Ouvrir ce fichier dans un navigateur (double-clic). La barre noire en
       haut fait passer d'une vue à l'autre et bascule jour/nuit.
       Les boutons de l'application ne font rien : c'est une image fidèle,
       pas une application connectée.
     · Pour corriger un rendu, éditer le balisage de la vue concernée (chaque
       vue est une <section class="screen" data-demo-view="…">) ou le bloc
       <style id="daona-design-system"> — c'est le CSS RÉEL de l'application,
       copié tel quel.
     · Le bloc <style id="maquette-coque"> ne concerne QUE la barre de
       navigation de la maquette : rien à y reporter.

     CE QU'IL FAUT REPORTER ENSUITE
     ──────────────────────────────
     · Le CSS de l'espace d'administration vit dans d-aona-web/index.html,
       bloc <style>, section « ADMINISTRATION (gestionnaire de modules) »
       (classes .adm · .adm-bar · .adm-card · .adm-table · .adm-form…).
     · Le balisage est produit par les fonctions admXxxView() du même fichier
       (admModulesView, admDashboardView, admKycView, admUsersView,
       admTournamentsView, admAccountingView, admEloView, admBadgesView,
       admRolesView, admAuditView, admAdsView).
     · Toute retouche retenue ici doit être reportée aux DEUX endroits : une
       classe modifiée seulement dans ce fichier serait perdue au prochain
       export.
     ========================================================================== -->`;

/* ---------- Assemblage du document ---------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildHtml({ css, chrome, env, sections, stamp }) {
  const nav = VIEWS.map(([id, label, ico]) =>
    `<button type="button" class="demo-tab" data-demo-view="${id}" aria-selected="false">${ico} ${esc(label)}</button>`
  ).join("\n          ");
  const themeAttr = env.theme ? ` data-theme="${esc(env.theme)}"` : "";
  return `<!DOCTYPE html>
<html lang="fr"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>D-aôna — Administration (démo)</title>
${GUIDE_HTML}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800&family=Roboto+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style id="daona-design-system">
${css}
</style>
<style id="maquette-coque">
${SHELL_CSS}
</style>
</head>
<body${env.bodyClass ? ` class="${esc(env.bodyClass)}"` : ""}>

<div class="demo-bar">
  <span class="demo-badge">MAQUETTE</span>
  <span class="demo-note">Données fictives · aucun serveur · ${esc(stamp)}</span>
  <span class="demo-spacer"></span>
  <nav class="demo-nav" aria-label="Vues de l'administration">
          ${nav}
  </nav>
  <button type="button" id="demo-theme" aria-pressed="false">☾ Nuit</button>
</div>
${chrome ? "\n" + chrome + "\n" : ""}
<main id="screens">
${sections.join("\n")}
</main>

<script>${DEMO_JS}</script>
</body>
</html>
`;
}

/* ---------- Programme ---------- */
(async () => {
  let server = null;
  let browser = null;
  let failed = false;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daona-export-"));
  const dbPath = path.join(tmpDir, "d-aona.db");

  try {
    if (!(await portFree(PORT)))
      throw new Error("le port " + PORT + " est déjà occupé (D_AONA_EXPORT_PORT pour en changer)");

    log("1/6  serveur jetable (port " + PORT + ", base temporaire)");
    server = startServer(dbPath);
    await waitServer();

    log("\n2/6  compte d'ancrage inscrit par le formulaire réel");
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
    const page = await ctx.newPage();
    await uiSignup(page, ADMIN.pseudo);

    /* 3. Jeu de démonstration + rôle (serveur arrêté : un seul écrivain). */
    log("\n3/6  données de démonstration + rôle super_admin");
    await stopServer(server); server = null;
    const env = { ...process.env, D_AONA_DB_PATH: dbPath };
    const seed = spawnSync(process.execPath, ["demo_seed.js", "--user", ADMIN.pseudo, "--yes"],
      { cwd: SERVER_DIR, env, encoding: "utf8" });
    if (seed.status !== 0)
      throw new Error("demo_seed.js a échoué : " + (seed.stderr || seed.stdout || "").slice(0, 400));
    log("     demo_seed.js : " + (seed.stdout || "").trim().split("\n").slice(-1)[0]);
    const grant = spawnSync(process.execPath, ["admin_grant.js", "grant", ADMIN.pseudo, "super_admin"],
      { cwd: SERVER_DIR, env, encoding: "utf8" });
    if (grant.status !== 0)
      throw new Error("admin_grant.js a échoué : " + (grant.stderr || grant.stdout || "").slice(0, 400));
    log("     " + (grant.stdout || "").trim());

    /* 4. Dossiers d'identité synthétiques (aucune pièce réelle). */
    log("\n4/6  dossiers d'identité synthétiques (fixtures PNG)");
    server = startServer(dbPath);
    await waitServer();
    const cases = [];
    for (const p of KYC_PLAN) {
      const reg = await api("/api/auth/register", "POST", {
        pseudo: p.pseudo, password: DEMO_PWD, province: "Antananarivo",
        phone: "034" + Math.floor(Math.random() * 9000000 + 1000000),
        email: p.pseudo.toLowerCase() + "@exemple.mg",
      });
      if (reg.status !== 200) throw new Error(`inscription ${p.pseudo} : ${reg.status} ${JSON.stringify(reg.json)}`);
      const s = await api("/api/kyc/submit", "POST", { recto: KYCX.recto(), verso: KYCX.verso() }, reg.json.token);
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

    /* 5. Instantané des vues. */
    log("\n5/6  instantané des " + VIEWS.length + " vues");
    /* Rechargement (et non `gotoApp`) : le jeton est déjà en localStorage,
       l'écran d'accueil est donc masqué d'emblée — attendre #auth-form
       visible serait une course. */
    await page.reload({ waitUntil: "domcontentloaded" });
    const logged = await until(page, () => document.getElementById("auth").classList.contains("hidden"), 20000);
    if (!logged) throw new Error("session perdue après rechargement");
    await page.evaluate(() => window.App.go("admin"));
    const hub = await until(page, () => document.querySelectorAll(".adm-card").length >= 9, 20000);
    if (!hub) throw new Error("le hub des modules ne s'est pas affiché");
    const docEnv = await collectEnv(page);
    const css = await collectCss(page);
    const chrome = await collectChrome(page);
    const sections = [];
    for (const [id, label] of VIEWS) {
      const one = await snapshot(page, id);
      sections.push(one);
      log("     " + id.padEnd(12) + " " + label.padEnd(24) + Math.round(one.length / 1024) + " Ko");
    }

    /* 6. Assemblage, écriture, contrôle. */
    log("\n6/6  écriture + contrôle du fichier");
    const html = buildHtml({
      css, chrome, env: docEnv, sections,
      stamp: new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }),
    });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, html, "utf8");

    /* Le fichier est rouvert tel qu'un humain l'ouvrirait (file://). */
    const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const vp = await cctx.newPage();
    const errors = [];
    vp.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    vp.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
    await vp.goto(pathToFileURL(OUT).href, { waitUntil: "load" });
    await sleep(700);
    const diag = await vp.evaluate(() => ({
      onglets: document.querySelectorAll(".demo-tab").length,
      vues: document.querySelectorAll(".screen").length,
      active: (document.querySelector(".screen.active") || {}).dataset
        ? document.querySelector(".screen.active").dataset.demoView : "",
      cartes: document.querySelectorAll(".screen.active .adm-card").length,
      theme: document.documentElement.getAttribute("data-theme") || "light",
    }));
    fs.mkdirSync(PREVIEW, { recursive: true });
    /* Contrôle visuel : une capture par vue, puis la même en thème nuit. */
    for (const v of ["modules", "dashboard", "kyc", "users", "ads", "roles"]) {
      await vp.evaluate((x) => document.querySelector('.demo-tab[data-demo-view="' + x + '"]').click(), v);
      await sleep(220);
      await vp.screenshot({ path: path.join(PREVIEW, v + "-jour.png") });
    }
    await vp.evaluate(() => document.getElementById("demo-theme").click());
    await sleep(220);
    await vp.screenshot({ path: path.join(PREVIEW, "roles-nuit.png") });
    const ko = Math.round(fs.statSync(OUT).size / 1024);
    log("     fichier : " + OUT);
    log(`     taille  : ${ko} Ko · ${diag.onglets} onglets · ${diag.vues} vues · ` +
        `vue active « ${diag.active} » · ${diag.cartes} cartes · thème ${diag.theme}`);
    log("     aperçu  : " + PREVIEW);
    if (diag.onglets !== VIEWS.length || diag.vues !== VIEWS.length) {
      log("     INCOHÉRENCE : onglets/vues ne correspondent pas aux " + VIEWS.length + " vues attendues");
      failed = true;
    }
    if (errors.length) { log("     ERREURS CONSOLE : " + errors.slice(0, 5).join(" | ")); failed = true; }
    else log("     console  : aucune erreur");
  } catch (e) {
    failed = true;
    console.error("\nECHEC : " + ((e && e.message) || e));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    await stopServer(server);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    log("     nettoyage : serveur arrêté, base temporaire supprimée");
  }
  process.exit(failed ? 1 : 0);
})();
