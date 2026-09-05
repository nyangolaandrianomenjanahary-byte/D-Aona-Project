"use strict";
/* Test POV + aide au déplacement :
   - En ligne : aide coupée (0 .piece.playable, hint vide) ; plateau retourné
     pour le joueur 2 (sa ligne 0 en bas).
   - En entraînement IA : aide active (.playable>0, hint "À vous de jouer"). */
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8080";

async function loginAndMatch(page, pseudo) {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#auth-id", { timeout: 8000 });
  await page.fill("#auth-id", pseudo);
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = "#/play"; });
  await page.waitForTimeout(600);
  await page.click("#btn-launch");
}

async function boardStats(page) {
  return page.evaluate(() => {
    const host = document.getElementById("fanorona-board");
    const g = window.Fanorona && Fanorona.state();
    const y0 = document.querySelector('.piece[data-r="0"]') ? document.querySelector('.piece[data-r="0"]').getBoundingClientRect().top : -1;
    const y4 = document.querySelector('.piece[data-r="4"]') ? document.querySelector('.piece[data-r="4"]').getBoundingClientRect().top : -1;
    const hint = document.getElementById("hint") ? document.getElementById("hint").textContent : null;
    return {
      flip: host ? host.classList.contains("pov-flip") : null,
      playable: document.querySelectorAll("#pieces .piece.playable").length,
      hint: hint || "",
      row0BelowRow4: y0 > y4 && y0 > 0,
      playerNum: g ? g.playerNum : null,
    };
  });
}

(async () => {
  console.log(`=== TEST POV / AIDE : ${BASE} ===`);
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const browser = await chromium.launch({ headless: true });
  const c1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const c2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  await loginAndMatch(p1, "PovA_" + tag);
  await loginAndMatch(p2, "PovB_" + tag);
  await p1.waitForSelector("#mm-accept", { timeout: 20000 });
  await p2.waitForSelector("#mm-accept", { timeout: 20000 });
  await p1.click("#mm-accept");
  await p2.click("#mm-accept");
  await p1.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p2.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p1.waitForTimeout(800);
  await p2.waitForTimeout(800);

  const s1 = await boardStats(p1);
  const s2 = await boardStats(p2);
  console.log("En ligne  client1:", JSON.stringify(s1));
  console.log("En ligne  client2:", JSON.stringify(s2));

  let ok = true;
  // Aide coupée en ligne (aucun surlignage, hint vide) chez les deux.
  [s1, s2].forEach((s, i) => {
    if (s.playable !== 0) { ok = false; console.log(`✗ ligne client${i + 1}: aide encore active (playable=${s.playable})`); }
    if (s.hint.trim() !== "") { ok = false; console.log(`✗ ligne client${i + 1}: hint non vide ("${s.hint}")`); }
  });
  // Retournement POV : exactement un client retourné, et le retournement
  // correspond à "sa ligne 0 en bas".
  const flipCount = [s1, s2].filter((s) => s.flip).length;
  if (flipCount !== 1) { ok = false; console.log(`✗ retournement: attendu 1 client retourné, obtenu ${flipCount}`); }
  [s1, s2].forEach((s, i) => {
    if (s.flip !== s.row0BelowRow4) { ok = false; console.log(`✗ client${i + 1}: flip=${s.flip} mais row0 en bas=${s.row0BelowRow4}`); }
  });
  // Le joueur 2 est retourné.
  const flipped = (s1.flip ? s1 : s2);
  if (flipped.playerNum !== 2) { ok = false; console.log(`✗ le client retourné devrait être joueur 2 (got ${flipped.playerNum})`); }

  // Partie 2 : entraînement IA → aide active.
  const cai = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const pai = await cai.newPage();
  await pai.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await pai.waitForSelector("#auth-id", { timeout: 8000 });
  const pseudo2 = "PovAI_" + tag;
  await pai.fill("#auth-id", pseudo2);
  await pai.click("#auth-enter");
  await pai.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await pai.waitForTimeout(600);
  await pai.evaluate(() => { location.hash = "#/board"; });
  await pai.waitForTimeout(500);
  await pai.evaluate(() => {
    window.Fanorona.start({ mode: "ai", formatId: "blitz", opponent: { pseudo: "IA — Antso", elo: 1050, region: "Madagascar" }, wager: 0 });
    // Le joueur humain choisit PILE → l'IA reçoit automatiquement FACE.
    window.Fanorona.chooseSide("pile");
  });
  // Attendre le tour du joueur humain (playerNum=1) : si le tirage au sort
  // désigne l'IA, elle jouera d'abord — l'aide n'apparaît qu'à notre tour.
  let humanTurn = false;
  for (let i = 0; i < 60 && !humanTurn; i++) {
    await pai.waitForTimeout(200);
    humanTurn = await pai.evaluate(() => {
      const g = window.Fanorona && Fanorona.state();
      return !!(g && !g.over && g.turn === g.playerNum && g.playerNum === 1);
    });
  }
  if (!humanTurn) { ok = false; console.log("✗ IA: le tour humain n'est jamais arrivé après le tirage au sort"); }
  const sai = await boardStats(pai);
  console.log("Entraînement IA:", JSON.stringify(sai));
  if (sai.playable < 1) { ok = false; console.log("✗ IA: aide non active (playable=" + sai.playable + ")"); }
  if (!/À vous de jouer/i.test(sai.hint)) { ok = false; console.log(`✗ IA: hint inattendu "${sai.hint}"`); }

  await p1.screenshot({ path: "shots/pov_p1.png" });
  await p2.screenshot({ path: "shots/pov_p2.png" });
  await pai.screenshot({ path: "shots/pov_ai.png" });
  await browser.close();
  console.log(ok ? "=== POV / AIDE OK (POV par joueur + aide uniquement IA) ===" : "=== POV / AIDE ÉCHEC ===");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
