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
/* Refus ATTENDUS : réponses du serveur que les scénarios provoquent exprès.
   401 du test de mot de passe erroné, 403 de `/api/admin/me` pour un joueur
   sans rôle (le serveur refuse, l'interface masque l'espace : c'est la
   conception, pas un défaut). Un scénario peut en déclarer d'autres le temps
   d'une vérification précise (`allowFailure`). */
const authNoise = [];
const expectedFailures = ["/api/auth/login", "/api/admin/me"];
const allowFailure = (frag) => { if (!expectedFailures.includes(frag)) expectedFailures.push(frag); };
const dropFailure = (frag) => {
  const i = expectedFailures.indexOf(frag);
  if (i >= 0) expectedFailures.splice(i, 1);
};
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
       négatif d'authentification (mot de passe erroné) ; un 403 de
       /api/admin/me est le refus normal d'un joueur sans rôle. Le navigateur
       journalise ces réponses comme des ressources en échec : on les compte à
       part au lieu d'en faire des défauts applicatifs. */
    const where = (m.location && m.location().url) || "";
    const txt = m.text().slice(0, 160);
    if (expectedFailures.some((f) => where.includes(f))) { authNoise.push(txt); return; }
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
    kyc: s.kyc, kycStatus: s.kycStatus, kycReason: s.kycReason,
    currentSession: s.currentSession, playerNum: s.playerNum,
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

/* ---------- Administration : compte + revue d'identité ----------
   La vérification KYC est MANUELLE : un dossier déposé reste « en attente »
   jusqu'à la décision d'un administrateur. Ce compte d'administration est un
   VRAI compte de la campagne (inscrit par l'interface, comme un joueur) ; son
   rôle lui est donné par le script hôte `admin_grant.js` — il n'existe aucun
   lien d'invitation, et c'est voulu : un tel lien, s'il fuyait, offrirait les
   pleins pouvoirs. */
let ADMIN = null;
async function ensureAdmin(browser) {
  if (ADMIN) return ADMIN;
  const p = await ensure(browser, "AD");
  const g = KYCX.grantAdmin(path.join(tmpDir, "d-aona.db"), p.pseudo);
  if (!g.ok) throw new Error("attribution du rôle super_admin impossible : " + g.out);
  ADMIN = p;
  return ADMIN;
}

/* Dépose un dossier recto + verso puis le fait approuver par l'administrateur.
   Renvoie le corps de l'approbation (`{ status: "verified" }`) ou null.

   IDEMPOTENT : le statut d'identité est une donnée du SERVEUR, pas de la page.
   Plusieurs comptes sont PARTAGÉS par les scénarios d'une même campagne ; un
   scénario antérieur (S9) avait fait approuver le compte sans que sa page ait
   rechargé, donc `S.kyc` était périmé. Un second envoi se heurtait alors à
   `409 DEJA_VERIFIE` — la campagne complète échouait là où le scénario isolé
   passait. On demande donc d'abord le statut réel, et s'il est déjà vérifié, on
   recharge la page : c'est exactement ce que fait l'application au démarrage. */
async function verifyKycViaApi(page, browser) {
  const st = await apiFromPage(page, "/api/user");
  const u = (st.json && st.json.user) || {};
  if (u.kyc_status === "verified" || u.kyc === true) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2400);
    return { status: "verified", kyc: true, already: true };
  }
  const sub = await apiFromPage(page, "/api/kyc/submit", "POST", { recto: KYCX.recto(), verso: KYCX.verso() });
  if (sub.status !== 200) return null;
  const adm = await ensureAdmin(browser);
  const r = await apiFromPage(adm.page, `/api/admin/kyc/${sub.json.caseId}/approve`, "POST", {});
  return r.status === 200 ? r.json : null;
}