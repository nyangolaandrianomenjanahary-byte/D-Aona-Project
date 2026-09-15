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