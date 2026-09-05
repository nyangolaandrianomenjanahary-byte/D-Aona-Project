"use strict";
/* Test : wizard Jeux (4 étapes) + photo de profil + screenshot accueil mode jour */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.argv[2] || "http://localhost:8080";
const SHOT_DIR = "d:\\Project\\D-Aona\\Root\\test-tools\\shots";

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  console.log(`=== TEST WIZARD / PHOTO / JOUR : ${BASE} ===`);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#auth-id", "Wiz_" + Math.floor(Math.random() * 9000 + 1000));
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(900);
  console.log("✓ Connecté");

  /* ---- 1. Wizard Jeux : 4 étapes ---- */
  await page.evaluate(() => { location.hash = "#/play"; });
  await page.waitForTimeout(700);
  let steps = await page.locator("#play-root .wstep").count();
  console.log((steps === 4 ? "✓" : "✗") + ` Barre wizard: ${steps} étapes`);
  if (steps !== 4) errors.push("Barre wizard KO");
  let body = await page.textContent("#play-root");
  console.log(body.includes("Étape 1") ? "✓ Étape 1 (jeu) affichée" : "✗ Étape 1 absente");
  if (!body.includes("Étape 1")) errors.push("Étape 1 absente");
  await page.screenshot({ path: SHOT_DIR + "\\wizard_step1.png" });

  await page.click("#wz-next"); await page.waitForTimeout(400);
  body = await page.textContent("#play-root");
  console.log(body.includes("Étape 2") ? "✓ Étape 2 (mode) affichée" : "✗ Étape 2 absente");
  await page.click("#play-root .mode-card[data-mode='ai']"); await page.waitForTimeout(300);

  await page.click("#wz-next"); await page.waitForTimeout(400);
  body = await page.textContent("#play-root");
  console.log(body.includes("Étape 3") ? "✓ Étape 3 (format) affichée" : "✗ Étape 3 absente");
  await page.click("#play-root .fmt-card[data-fmt='blitz']"); await page.waitForTimeout(300);

  await page.click("#wz-next"); await page.waitForTimeout(400);
  body = await page.textContent("#play-root");
  const hasRecap = body.includes("Étape 4") && body.includes("Fanorona") && body.includes("Blitz");
  console.log(hasRecap ? "✓ Étape 4 (récap) affichée avec jeu + format" : "✗ Étape 4 KO");
  if (!hasRecap) errors.push("Étape 4 récap KO");
  const launchBtn = await page.locator("#btn-launch").count();
  console.log(launchBtn === 1 ? "✓ Bouton Lancer présent à l'étape 4" : "✗ Bouton Lancer absent");
  if (launchBtn !== 1) errors.push("Bouton lancer absent");
  await page.screenshot({ path: SHOT_DIR + "\\wizard_step4.png" });

  await page.click("#wz-prev"); await page.waitForTimeout(300);
  body = await page.textContent("#play-root");
  console.log(body.includes("Étape 3") ? "✓ Retour arrière fonctionne" : "✗ Retour KO");
  if (!body.includes("Étape 3")) errors.push("Retour wizard KO");

  /* ---- 2. Photo de profil : upload (petit PNG) ---- */
  await page.evaluate(() => { location.hash = "#/profile"; });
  await page.waitForTimeout(800);
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const up = await page.evaluate(async (b64) => {
    const r = await fetch("/api/user/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + localStorage.getItem("daona_token") },
      body: JSON.stringify({ avatar: "data:image/png;base64," + b64 }),
    });
    return r.json();
  }, pngB64);
  console.log(up.ok ? "✓ Upload avatar OK: " + up.avatar : "✗ Upload avatar KO: " + JSON.stringify(up));
  if (!up.ok) errors.push("Upload avatar KO");
  await page.waitForTimeout(600);
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#/profile"; });
  await page.waitForTimeout(900);
  const hasImg = await page.locator("#profile-avatar img").count();
  console.log(hasImg >= 1 ? "✓ Photo affichée sur le profil" : "✗ Photo absente du profil");
  if (hasImg < 1) errors.push("Photo absente du profil");
  await page.screenshot({ path: SHOT_DIR + "\\profil_photo.png" });

  // Taille de la photo (S/M/L)
  const sizeChips = await page.locator("#profile-root [data-avsize]").count();
  console.log(sizeChips === 3 ? "✓ 3 choix de taille de photo" : "✗ Choix taille KO: " + sizeChips);
  if (sizeChips !== 3) errors.push("Choix taille photo KO");
  await page.click('#profile-root [data-avsize="110"]');
  await page.waitForTimeout(400);
  const w = await page.evaluate(() => document.getElementById("profile-avatar").style.width);
  console.log(w === "110px" ? "✓ Taille photo modifiable (110px)" : "✗ Taille KO: " + w);
  if (w !== "110px") errors.push("Taille photo KO");

  /* ---- 3. Classement : avatar présent dans la liste ---- */
  await page.evaluate(() => { location.hash = "#/ranks"; });
  await page.waitForTimeout(900);
  const rankAvatars = await page.locator("#screen-ranks .rank-row .avatar").count();
  console.log(rankAvatars >= 3 ? `✓ ${rankAvatars} avatars dans le classement` : "✗ Avatars absents du classement");
  if (rankAvatars < 3) errors.push("Avatars absents du classement");

  /* ---- 4. Accueil en mode JOUR : screenshot pour examen contraste ---- */
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); location.hash = "#/home"; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOT_DIR + "\\accueil_jour.png", fullPage: false });
  console.log("✓ Screenshot accueil jour pris");

  await browser.close();
  console.log("\n--- Erreurs ---");
  if (errors.length) { errors.forEach((e) => console.log("  ⚠", e)); console.log("=== TEST ÉCHOUÉ ==="); process.exit(1); }
  console.log("  (aucune)");
  console.log("\n=== TEST WIZARD / PHOTO / JOUR RÉUSSI ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });

