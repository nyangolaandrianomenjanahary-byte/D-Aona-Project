"use strict";
/* Test badges + classement régional + contraste nav inversé */
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

  console.log(`=== TEST BADGES / NAV / RÉGIONS : ${BASE} ===`);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#auth-id", "BadgeTest_" + Math.floor(Math.random() * 9000 + 1000));
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(1000);
  console.log("✓ Connecté");

  /* ---- 1. Classement national : badges visibles ---- */
  await page.evaluate(() => { location.hash = "#/ranks"; });
  await page.waitForTimeout(900);
  const ranksText = await page.textContent("#screen-ranks");
  for (const b of ["Remenabila", "Malaso", "Dahalo", "Totakely"]) {
    const ok = ranksText.includes(b);
    console.log((ok ? "✓" : "✗") + " Badge national visible: " + b);
    if (!ok) errors.push("Badge manquant: " + b);
  }
  const firstRow = await page.evaluate(() => {
    const row = document.querySelector("#screen-ranks .rank-row:not(.head)");
    return row ? row.textContent : "";
  });
  console.log("  1ère ligne:", JSON.stringify(firstRow.trim().slice(0, 90)));
  const badgeCount = await page.locator("#screen-ranks .badge-chip").count();
  console.log(`✓ ${badgeCount} badge-chip dans le classement national`);
  if (badgeCount < 4) errors.push("Trop peu de badges visibles: " + badgeCount);
  const hasRegionLine = await page.locator("#screen-ranks .who-province").count();
  console.log(`✓ ${hasRegionLine} lignes avec province sous le pseudo`);
  if (!hasRegionLine) errors.push("Province absente sous le pseudo");
  const ruleOk = ranksText.includes("−30 Elo / mois");
  console.log((ruleOk ? "✓" : "✗") + " Règle inactivité: −30 Elo / mois affichée");
  if (!ruleOk) errors.push("Règle inactivité non mise à jour");
  await page.screenshot({ path: SHOT_DIR + "\\badges_national.png" });

  /* ---- 2. Classement provincial : 6 provinces (dropdown) + rang recalculé ---- */
  await page.click('[data-scope="province"]');
  await page.waitForTimeout(400);
  const provinceOptions = await page.locator("#screen-ranks .province-select option").count();
  console.log((provinceOptions === 6 ? "✓" : "✗") + ` ${provinceOptions} provinces dans le dropdown (attendu 6)`);
  if (provinceOptions !== 6) errors.push("Nb provinces KO: " + provinceOptions);
  await page.selectOption("#province-select", "Toamasina");
  await page.waitForTimeout(400);
  const provincialRanks = await page.evaluate(() =>
    [...document.querySelectorAll("#screen-ranks .rank-row:not(.head) .mono.muted")].map((e) => e.textContent.trim())
  );
  console.log("  Rang provincial Toamasina:", provincialRanks.join(","));
  const startsAt1 = provincialRanks[0] === "1";
  const sequential = provincialRanks.every((v, i) => parseInt(v) === i + 1);
  console.log((startsAt1 && sequential ? "✓" : "✗") + " Rang provincial recalculé à partir de 1 (indépendant du national)");
  if (!startsAt1 || !sequential) errors.push("Rang provincial non recalculé");
  const regBadges = await page.locator("#screen-ranks .rank-row .badge-chip").count();
  console.log(`✓ Vue provinciale: ${regBadges} badge national affiché dans les lignes`);
  await page.screenshot({ path: SHOT_DIR + "\\badges_province.png" });

  /* ---- 3. Contraste nav inversé ---- */
  const lum = (rgb) => {
    const m = rgb.match(/\d+(\.\d+)?/g).map(Number);
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  };
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "night"); });
  await page.waitForTimeout(450);
  const navDarkTheme = await page.evaluate(() => getComputedStyle(document.querySelector(".nav")).backgroundColor);
  const bodyDarkTheme = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const navLumD = lum(navDarkTheme), bodyLumD = lum(bodyDarkTheme);
  console.log(`  Nuit: body L=${bodyLumD.toFixed(0)} | nav L=${navLumD.toFixed(0)}`);
  const navLightWhenDark = navLumD > bodyLumD + 60;
  console.log((navLightWhenDark ? "✓" : "✗") + " Mode nuit → barre de nav CLAIRE");
  if (!navLightWhenDark) errors.push("Nav pas claire en mode nuit");

  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); });
  await page.waitForTimeout(450);
  const navLightTheme = await page.evaluate(() => getComputedStyle(document.querySelector(".nav")).backgroundColor);
  const bodyLightTheme = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const navLumL = lum(navLightTheme), bodyLumL = lum(bodyLightTheme);
  console.log(`  Clair: body L=${bodyLumL.toFixed(0)} | nav L=${navLumL.toFixed(0)}`);
  const navDarkWhenLight = navLumL < bodyLumL - 60;
  console.log((navDarkWhenLight ? "✓" : "✗") + " Mode jour → barre de nav SOMBRE");
  if (!navDarkWhenLight) errors.push("Nav pas sombre en mode jour");
  await page.screenshot({ path: SHOT_DIR + "\\nav_contrast_light.png" });
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "night"); });

  /* ---- 4. Profil : badge visible ---- */
  await page.evaluate(() => { location.hash = "#/profile"; });
  await page.waitForTimeout(900);
  const profBadge = await page.locator("#profile-root .badge-chip").count();
  const profText = await page.textContent("#profile-root");
  console.log((profBadge >= 1 ? "✓" : "✗") + ` Badge visible sur mon profil (${profBadge})`);
  if (profBadge < 1) errors.push("Badge absent du profil perso");
  const profRegion = /📍/.test(profText);
  console.log((profRegion ? "✓" : "✗") + " Région affichée sur mon profil");
  if (!profRegion) errors.push("Région absente du profil");
  await page.screenshot({ path: SHOT_DIR + "\\profil_badge.png" });

  await browser.close();
  console.log("\n--- Erreurs ---");
  if (errors.length) { errors.forEach((e) => console.log("  ⚠", e)); console.log("=== TEST BADGES/NAV ÉCHOUÉ ==="); process.exit(1); }
  console.log("  (aucune)");
  console.log("\n=== TEST BADGES / NAV / RÉGIONS RÉUSSI ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
