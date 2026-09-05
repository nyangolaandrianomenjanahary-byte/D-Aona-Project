"use strict";
/* Test du bouton de thème : 2 modes (jour ⇄ nuit) + persistance — défaut = JOUR */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.argv[2] || "http://localhost:8080";
const SHOT_DIR = "d:\\Project\\D-Aona\\Root\\test-tools\\shots";

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  console.log(`=== TEST THÈME : ${BASE} ===`);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#btn-theme", { timeout: 8000 });
  console.log("✓ Bouton #btn-theme présent dans la topbar");

  // Connexion (l'overlay auth masque la topbar)
  await page.fill("#auth-id", "Theme_" + Math.floor(Math.random() * 9000 + 1000));
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(800);
  console.log("✓ Connecté (topbar accessible)");

  // Thème initial = light (pas d'attribut data-theme)
  let theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "light");
  console.log("✓ Thème initial:", theme);
  if (theme !== "light") errors.push("Thème initial inattendu: " + theme);

  // Clic 1 → nuit
  await page.click("#btn-theme");
  await page.waitForTimeout(500);
  theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log(theme === "night" ? "✓ Clic 1 → mode NUIT" : "✗ attendu night, obtenu " + theme);
  if (theme !== "night") errors.push("Cycle light→night KO");
  await page.screenshot({ path: SHOT_DIR + "\\theme_nuit.png" });

  // Clic 2 → retour jour
  await page.click("#btn-theme");
  await page.waitForTimeout(500);
  theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "light");
  console.log(theme === "light" ? "✓ Clic 2 → retour mode JOUR" : "✗ attendu light, obtenu " + theme);
  if (theme !== "light") errors.push("Cycle night→light KO");
  await page.screenshot({ path: SHOT_DIR + "\\theme_jour.png" });

  // Persistance : repasser en nuit, recharger, vérifier
  await page.click("#btn-theme");
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const saved = await page.evaluate(() => localStorage.getItem("daona_theme"));
  console.log(theme === "night" && saved === "night"
    ? "✓ Persistance OK après rechargement (localStorage=night, sans flash)"
    : "✗ Persistance KO: attr=" + theme + " ls=" + saved);
  if (theme !== "night" || saved !== "night") errors.push("Persistance KO");
  // Si l'overlay auth est revenu (session non restaurée), se reconnecter
  const authVisible = await page.evaluate(() => !document.getElementById("auth").classList.contains("hidden"));
  if (authVisible) {
    await page.fill("#auth-id", "Theme_" + Math.floor(Math.random() * 9000 + 1000));
    await page.click("#auth-enter");
    await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);
  }

  // Vérifier que les variables CSS changent réellement (fond clair vs sombre)
  await page.click("#btn-theme"); await page.waitForTimeout(450); // → jour
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click("#btn-theme"); await page.waitForTimeout(450); // → nuit
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log(`✓ Fond jour: ${bgLight} | Fond nuit: ${bgDark}`);
  if (bgLight === bgDark) errors.push("Le fond ne change pas entre les thèmes !");
  else console.log("✓ Les couleurs de fond changent réellement");

  await browser.close();
  console.log("\n--- Erreurs page ---");
  if (errors.length) { errors.forEach((e) => console.log("  ⚠", e)); console.log("=== TEST THÈME ÉCHOUÉ ==="); process.exit(1); }
  console.log("  (aucune)");
  console.log("\n=== TEST THÈME RÉUSSI ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
