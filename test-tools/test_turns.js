"use strict";
/* Test cycle de tours : 2 joueurs jouent en alternance (avec gestion des doubles captures). */
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

const playableCount = (page) => page.evaluate(() => document.querySelectorAll(".piece.playable").length);
const dotsCount = (page) => page.evaluate(() => document.querySelectorAll("#dots .dot").length);
const choiceVisible = (page) => page.evaluate(() => document.getElementById("capture-choice") && !document.getElementById("capture-choice").hidden);
const clickChoice = async (page) => { await page.evaluate(() => document.querySelector("#capture-choice .choice-btn")?.click()); };

// Attendre que le client soit effectivement à son tour (état reçu) avant de cliquer.
async function waitReady(page) {
  for (let i = 0; i < 40; i++) {
    const r = await page.evaluate(() => {
      const g = window.Fanorona && Fanorona.state();
      return !!(g && !g.over && g.turn === g.playerNum);
    });
    if (r) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

const turnOf = (page) => page.evaluate(() => {
  const g = window.Fanorona && Fanorona.state();
  return g ? { turn: g.turn, pn: g.playerNum, over: g.over } : null;
});

async function tryMove(page, who) {
  if (await choiceVisible(page)) { await clickChoice(page); await page.waitForTimeout(900); return "OK_CLICK"; }
  // L'aide (.playable) est coupée en ligne : on clique tour à tour ses pions
  // (dataset.v === playerNum) jusqu'à ce que des destinations (dots) apparaissent.
  const myCells = await page.evaluate(() => {
    const g = window.Fanorona && Fanorona.state();
    if (!g) return [];
    return [...document.querySelectorAll("#pieces .piece")]
      .filter((p) => +p.dataset.v === g.playerNum)
      .map((p) => ({ r: p.dataset.r, c: p.dataset.c }));
  });
  let done = false;
  for (const cell of myCells) {
    await page.click(`.cell[data-r="${cell.r}"][data-c="${cell.c}"]`);
    await page.waitForTimeout(130);
    if ((await dotsCount(page)) > 0) { done = true; break; }
  }
  if (!done) {
    // Chaîne sans continuation possible : le joueur est censé la terminer.
    const endBtn = page.locator("#btn-chain-end");
    if (await endBtn.isVisible().catch(() => false)) { await endBtn.click(); await page.waitForTimeout(700); return "OK_CHAINEND"; }
    return "NO_DOTS";
  }
  if (await choiceVisible(page)) { await clickChoice(page); await page.waitForTimeout(900); return "OK_CLICK"; }
  const dots = await dotsCount(page);
  if (dots === 0) {
    const endBtn = page.locator("#btn-chain-end");
    if (await endBtn.isVisible().catch(() => false)) { await endBtn.click(); await page.waitForTimeout(700); return "OK_CHAINEND"; }
    return "NO_DOTS";
  }
  await page.click("#dots .dot");
  await page.waitForTimeout(250);
  if (await choiceVisible(page)) { await clickChoice(page); await page.waitForTimeout(900); return "OK_CLICK"; }
  await page.waitForTimeout(700);
  return "OK";
}

(async () => {
  console.log(`=== TEST CYCLE DE TOURS : ${BASE} ===`);
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const browser = await chromium.launch({ headless: true });
  const c1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const c2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();

  await loginAndMatch(p1, "TurnA_" + tag);
  await loginAndMatch(p2, "TurnB_" + tag);
  await p1.waitForSelector("#mm-accept", { timeout: 20000 });
  await p2.waitForSelector("#mm-accept", { timeout: 20000 });
  await p1.click("#mm-accept");
  await p2.click("#mm-accept");
  await p1.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p2.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p1.waitForTimeout(700);
  await p2.waitForTimeout(700);

  // CHOIX DES FACES (tirage au sort) : chaque joueur choisit une face, l'autre
  // reçoit automatiquement l'autre face, puis la pièce est lancée.
  await p1.waitForSelector("#choose-pile", { timeout: 10000 }).catch(() => {});
  await p2.waitForSelector("#choose-pile", { timeout: 10000 }).catch(() => {});
  if (await p1.$("#choose-pile")) await p1.click("#choose-face");
  if (await p2.$("#choose-pile")) await p2.click("#choose-pile");
  // Attendre la résolution (phase play) + fermeture du modal de tirage (auto ~2.5s).
  for (let k = 0; k < 50; k++) {
    const ready = await p1.evaluate(() => {
      const g = window.Fanorona && Fanorona.state();
      const ov = document.getElementById("modal-overlay");
      return !!(g && g.turn && !g.over && !(ov && ov.classList.contains("show")));
    });
    if (ready) break;
    await p1.waitForTimeout(200);
  }
  await p1.waitForTimeout(600);
  await p2.waitForTimeout(600);

  const moves = { A: 0, B: 0 };
  let failed = null;
  let invalide = 0;
  p1.on("console", (m) => { if (/Coup invalide|Message invalide/.test(m.text())) invalide++; });
  p2.on("console", (m) => { if (/Coup invalide|Message invalide/.test(m.text())) invalide++; });

  for (let i = 0; i < 36; i++) {
    await p1.waitForTimeout(350);
    await p2.waitForTimeout(350);
    const overA = await p1.evaluate(() => (Fanorona.state() || {}).over);
    if (overA) { console.log(`  partie terminée au coup ${i}`); break; }

    // Attendre que les DEUX clients aient le même turn (état propagé), puis prendre
    // le joueur actif = celui dont playerNum === turn. Évite de lire un client en retard.
    let st1 = null, st2 = null, common = null;
    for (let k = 0; k < 40; k++) {
      st1 = await turnOf(p1); st2 = await turnOf(p2);
      if (st1 && st2 && !st1.over && st1.turn === st2.turn) { common = st1.turn; break; }
      await p1.waitForTimeout(150);
    }
    if (common === null) { failed = `coup ${i}: états des 2 clients jamais synchronisés`; break; }
    const mover = st1.pn === common ? p1 : p2;
    const who = mover === p1 ? "A" : "B";
    const res = await tryMove(mover, who);
    if (res === "NO_DOTS") { failed = `coup ${i}: ${who} (tour=${sA.turn}) ne peut produire aucune destination au clic`; break; }
    moves[who]++;
    console.log(`  coup ${i + 1}: ${who} a joué (A=${moves.A}, B=${moves.B})`);
    await p1.waitForTimeout(450);
    await p2.waitForTimeout(450);
  }

  await browser.close();
  console.log(`\nNombre de coups: A=${moves.A}, B=${moves.B} | erreurs serveur='Coup invalide'=${invalide}`);
  if (failed) { console.log("✗ " + failed); console.log("\n=== TEST CYCLE ÉCHOUÉ ==="); process.exit(1); }
  if (invalide > 0) { console.log("✗ Des coups 'invalide' ont été rejetés par le serveur"); console.log("\n=== TEST CYCLE ÉCHOUÉ ==="); process.exit(1); }
  console.log("\n=== TEST CYCLE DE TOURS RÉUSSI (tours alternés continus, aucune erreur) ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
