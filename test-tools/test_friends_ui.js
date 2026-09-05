"use strict";
/* Test UI : écran Amis (recherche + ajout) + bouton d'aide au mouvement */
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8080";

(async () => {
  console.log(`=== TEST UI AMIS + AIDE : ${BASE} ===`);
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 414, height: 860 } });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#auth-id", { timeout: 8000 });
  await page.fill("#auth-id", "UiTest_" + Math.floor(Math.random() * 9000 + 1000));
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(800);

  // --- Écran Amis ---
  await page.click("#btn-friends");
  await page.waitForSelector("#friends-root", { timeout: 8000 });
  await page.waitForTimeout(600);
  const hasSearch = await page.isVisible("#friend-q");
  const hasList = await page.isVisible("#friends-list");
  console.log(hasSearch && hasList ? "✓ Écran Amis affiché (recherche + liste)" : "✗ Écran Amis incomplet");
  if (!hasSearch || !hasList) errors.push("Écran Amis incomplet");

  // Rechercher un joueur seedé
  await page.fill("#friend-q", "SolofoGM");
  await page.click("#friend-search-btn");
  await page.waitForTimeout(1000);
  const results = await page.evaluate(() => document.querySelectorAll("#friend-results [data-add]").length);
  console.log(results > 0 ? "✓ Recherche 'SolofoGM' → bouton Ajouter présent" : "✗ Recherche sans résultat");
  if (results > 0) {
    await page.click("#friend-results [data-add]");
    await page.waitForTimeout(1000);
    const inList = await page.evaluate(() => document.querySelector("#friends-list")?.textContent.includes("SolofoGM"));
    console.log(inList ? "✓ Ami ajouté et visible dans la liste" : "✗ Ami non ajouté");
    if (!inList) errors.push("Ami non ajouté");
  } else errors.push("Recherche sans résultat");

  // --- Bouton d'aide (entraînement IA) ---
  await page.evaluate(() => { location.hash = "#/play"; });
  await page.waitForTimeout(600);
  // Sélectionner le mode IA (carte mode ai)
  await page.click("#play-root .mode-card[data-mode='ai']");
  await page.waitForTimeout(400);
  await page.click("#btn-launch");
  await page.waitForSelector("#btn-help", { timeout: 8000 });
  await page.waitForTimeout(600);

  const helpOn = await page.textContent("#btn-help");
  const hintText = await page.textContent("#hint");
  console.log(`✓ Bouton aide présent: "${helpOn.trim()}" | hint: "${(hintText || "").trim()}"`);

  // Désactiver l'aide
  await page.click("#btn-help");
  await page.waitForTimeout(400);
  const helpOff = await page.textContent("#btn-help");
  const playableOff = await page.evaluate(() => document.querySelectorAll(".piece.playable").length);
  console.log(helpOff.includes("OFF") ? "✓ Aide désactivée (bouton OFF)" : "✗ Toggle aide KO");
  console.log(playableOff === 0 ? "✓ Plus aucune pièce surlignée (aide off)" : "⚠ Encore " + playableOff + " pièce(s) surlignée(s)");

  // Réactiver
  await page.click("#btn-help");
  await page.waitForTimeout(400);
  const playableOn = await page.evaluate(() => document.querySelectorAll(".piece.playable").length);
  console.log(playableOn > 0 ? "✓ Aide réactivée (" + playableOn + " pièces jouables surlignées)" : "✗ Aide non réactivée");

  await browser.close();
  console.log("\n--- Erreurs page ---");
  if (errors.length) { errors.forEach((e) => console.log("  ⚠", e)); console.log("=== TEST UI ÉCHOUÉ ==="); process.exit(1); }
  console.log("  (aucune)");
  console.log("\n=== TEST UI AMIS + AIDE RÉUSSI ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
