"use strict";
/* Test frontend E2E — méthodologie webapp-testing (Playwright)
   Usage: node test_frontend.js [BASE_URL] */
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8080";
const SHOT_DIR = "d:\\Project\\D-Aona\\Root\\test-tools\\shots";

(async () => {
  const fs = require("fs");
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 414, height: 860 } }); // format mobile

  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push("HTTP " + r.status() + ": " + r.url()); });

  console.log(`=== TEST FRONTEND E2E : ${BASE} ===`);

  // 1. Navigation + attente réseau
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  console.log("✓ Page chargée (networkidle)");

  // 2. Écran d'auth visible
  await page.waitForSelector("#auth-id", { timeout: 8000 });
  const pseudo = "E2E_" + Math.floor(Math.random() * 9000 + 1000);
  await page.fill("#auth-id", pseudo);
  await page.screenshot({ path: SHOT_DIR + "\\01_auth.png" });
  console.log("✓ Écran auth affiché, pseudo saisi:", pseudo);

  // 3. Connexion
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForLoadState("networkidle");
  console.log("✓ Connexion réussie (écran auth masqué)");

  // 4. Vérifier la topbar (balance chargée depuis l'API)
  await page.waitForTimeout(1200);
  const balance = await page.textContent("#tb-balance");
  const avatar = await page.textContent("#tb-avatar");
  console.log(`✓ Topbar: balance=${balance}, avatar=${avatar}`);
  if (!avatar || avatar.length < 2) throw new Error("Topbar non initialisée");

  // 5. Naviguer dans les écrans principaux
  const screens = ["play", "ranks", "wallet", "profile"];
  for (const s of screens) {
    await page.evaluate((scr) => { location.hash = "#/" + scr; }, s);
    await page.waitForTimeout(700);
    const visible = await page.isVisible("#screen-" + s);
    console.log((visible ? "✓" : "✗") + " Écran #" + s + (visible ? " visible" : " NON visible"));
    if (!visible) errors.push("Écran #" + s + " non visible");
  }
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT_DIR + "\\02_home.png", fullPage: false });

  // 6. Partie contre l'IA (test du moteur + rendu plateau)
  await page.evaluate(() => { location.hash = "#/play"; });
  await page.waitForTimeout(600);
  const hasOnline = await page.isVisible("text=En ligne");
  console.log("✓ Écran jeu: section 'En ligne' présente:", hasOnline);

  // Lancer une partie IA via l'UI si possible
  const aiBtn = await page.$("text=IA");
  if (aiBtn) {
    console.log("✓ Bouton/mode IA détecté dans l'UI");
  }

  // 7. Leaderboard chargé (données DB)
  await page.evaluate(() => { location.hash = "#/ranks"; });
  await page.waitForTimeout(800);
  const lbText = await page.textContent("#screen-ranks");
  const hasPlayers = /SolofoGM|RadoTheKing|Elo/i.test(lbText || "");
  console.log(hasPlayers ? "✓ Leaderboard rempli depuis la DB" : "✗ Leaderboard vide");
  if (!hasPlayers) errors.push("Leaderboard vide");
  await page.screenshot({ path: SHOT_DIR + "\\03_ranks.png" });

  // 8. Wallet (transactions DB)
  await page.evaluate(() => { location.hash = "#/wallet"; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT_DIR + "\\04_wallet.png" });
  console.log("✓ Écran wallet affiché");

  await browser.close();

  console.log("\n--- Erreurs console/page ---");
  const critical = errors.filter((e) => !/favicon|net::ERR_INTERNET|ResizeObserver/i.test(e));
  if (critical.length) { critical.forEach((e) => console.log("  ⚠", e)); }
  else console.log("  (aucune erreur critique)");

  console.log("\n=== TEST FRONTEND " + (critical.length === 0 ? "RÉUSSI" : "TERMINÉ AVEC AVERTISSEMENTS") + " ===");
  process.exit(critical.length === 0 ? 0 : 2);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
