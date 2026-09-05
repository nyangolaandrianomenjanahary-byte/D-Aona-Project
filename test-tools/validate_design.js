"use strict";
/* Valide le design prototype standalone (index.html) :
   charge le fichier, se connecte, navigue, vérifie absence d'erreurs JS. */
const { chromium } = require("playwright");
const path = require("path");
const url = "file:///" + path.resolve("..", "Design prototype", "index.html").replace(/\\/g, "/");
console.log("Chargement :", url);

(async () => {
  const errors = [];
  const ok = (cond, label) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) errors.push(label); };
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 120)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 140)));

  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(500);
  ok(await page.locator("#auth-enter").count() === 1, "Écran d'auth visible");

  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const homeText = await page.textContent("#home-root");
  ok(homeText && homeText.length > 40, "Accueil rempli de contenu");

  await page.evaluate(() => { location.hash = "#/ranks"; });
  await page.waitForTimeout(1500);
  const lb = await page.evaluate(async () => {
    try { const d = await API.request("/api/leaderboard"); return { ok: true, n: (d.leaderboard || []).length, first: (d.leaderboard||[])[0] ? d.leaderboard[0].pseudo : null }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  const lb2 = await page.evaluate(async () => {
    try { const d = await API.request("/api/auth", "POST", { pseudo: "Tsiry_RN" }); return { t: !!d.token, pseudo: d.user && d.user.pseudo }; }
    catch (e) { return { err: e.message }; }
  });
  console.log("LB direct:", JSON.stringify(lb), "| AUTH direct:", JSON.stringify(lb2));
  await page.waitForTimeout(1600);
  const diag = await page.evaluate(() => {
    const el = document.getElementById("ranks-root");
    const h = el ? el.innerHTML : "";
    return { hasSolofo: h.includes("SolofoGM"), hasNone: h.includes("Aucun joueur"), len: h.length, snippet: h.slice(h.indexOf("rank-row") >= 0 ? h.indexOf("rank-row") : 0, 300) };
  });
  console.log("DIAG:", JSON.stringify({ hasSolofo: diag.hasSolofo, hasNone: diag.hasNone, len: diag.len }));
  console.log("   extract:", diag.snippet.replace(/\s+/g, " ").slice(0, 160));
  const ranksText = await page.textContent("#ranks-root");
  ok(ranksText && ranksText.includes("SolofoGM"), "Classement : joueurs affichés");
  ok((await page.locator("#ranks-root .badge-chip").count()) >= 3, "Classement : badges visibles");
  // Le dropdown n'apparaît que dans l'onglet Province
  await page.click('#ranks-root [data-scope="province"]');
  await page.waitForTimeout(500);
  ok((await page.locator(".province-select option").count()) === 6, "Dropdown province : 6 options");
  await page.selectOption(".province-select", "Toamasina");
  await page.waitForTimeout(500);
  const provFirst = await page.evaluate(() => document.querySelector("#ranks-root .rank-row:not(.head) .mono").textContent);
  ok(provFirst === "1", "Classement provincial recalculé à partir de 1");
  // Retour au national pour le test de recherche
  await page.click('#ranks-root [data-scope="national"]');
  await page.waitForTimeout(400);
  await page.fill("#rank-search", "RadoTheKing");
  await page.waitForTimeout(400);
  ok((await page.locator("#ranks-root .rank-row:not(.head)").count()) === 1, "Recherche classement fonctionne");

  await page.evaluate(() => { location.hash = "#/play"; });
  await page.waitForTimeout(800);
  ok((await page.textContent("#play-root")).includes("Étape 1"), "Jeux : wizard étape 1");

  await page.evaluate(() => { location.hash = "#/profile"; });
  await page.waitForTimeout(1500);
  ok((await page.textContent("#profile-root")).includes("Tsiry_RN"), "Profil : pseudo affiché");

  await page.evaluate(() => { location.hash = "#/friends"; });
  await page.waitForTimeout(1000);
  ok((await page.textContent("#friends-root")).length > 20, "Amis : écran rendu");

  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "night"); });
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === "rgb(0, 0, 0)", `Thème nuit : fond noir (${bg})`);

  await browser.close();
  console.log("\n--- Erreurs JS ---");
  if (errors.length) { errors.forEach((e) => console.log("  ⚠", e)); console.log("=== VALIDATION ÉCHOUÉE ==="); process.exit(1); }
  console.log("  (aucune)");
  console.log("\n=== DESIGN PROTOTYPE VALIDÉ ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });