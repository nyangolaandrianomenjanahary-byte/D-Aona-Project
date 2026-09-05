"use strict";
/* Repro ciblé : « à mon tour je clique et rien ne se passe ».
   Clique VRAI à l'écran sur un pion "me", puis vérifie :
    - elementFromPoint -> y a-t-il un overlay qui intercepte le clic ?
    - Fanorona.state() -> turn / busy / playerNum / chain
    - apparition de .dot et .piece.sel après le clic
   Usage : node test_click_repro.js [BASE_URL] */
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

async function dumpState(page, label) {
  const doc = await page.evaluate((lbl) => {
    const g = window.Fanorona && Fanorona.state();
    const cells = document.querySelectorAll("#cells .cell").length;
    const dots = document.querySelectorAll("#dots .dot").length;
    const sel = document.querySelectorAll("#pieces .piece.sel").length;
    const playable = document.querySelectorAll("#pieces .piece.playable").length;
    const cc = document.getElementById("capture-choice");
    const cb = document.getElementById("chain-bar");
    const hint = document.getElementById("hint") && document.getElementById("hint").textContent;
    // overlay le plus haut au centre du plateau
    const board = document.getElementById("fanorona-board");
    const r = board.getBoundingClientRect();
    let topEl = null;
    const probe = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.className && e.className.toString ? e.className.toString() : e.tagName) : null; };
    const mid = probe(r.left + r.width / 2, r.top + r.height / 2);
    let mePiece = null, topAtPiece = null;
    const p = document.querySelector("#pieces .piece.me");
    if (p) {
      const pr = p.getBoundingClientRect();
      mePiece = { x: Math.round(pr.left + pr.width / 2), y: Math.round(pr.top + pr.height / 2) };
      topAtPiece = probe(mePiece.x, mePiece.y);
    }
    return { lbl, state: g ? { mode: g.mode, turn: g.turn, playerNum: g.playerNum, busy: g.busy, over: g.over, chain: !!g.chain, meVal: g && g.playerNum } : null,
      cells, dots, sel, playable, ccHidden: cc ? cc.hidden : null, cbHidden: cb ? cb.hidden : null, hint,
      topAtMid: mid, mePiece, topAtPiece };
  }, label);
  console.log(JSON.stringify(doc));
  return doc;
}

(async () => {
  console.log(`=== TEST CLICK REPRO : ${BASE} ===`);
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const browser = await chromium.launch({ headless: true });
  const c1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const c2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  const errors = [];
  p1.on("console", (m) => { if (m.type() === "error") errors.push("P1 " + m.text()); });
  p1.on("pageerror", (e) => errors.push("P1 pageerror " + e.message));

  await loginAndMatch(p1, "ClickA_" + tag);
  await loginAndMatch(p2, "ClickB_" + tag);
  await p1.waitForSelector("#mm-accept", { timeout: 20000 });
  await p2.waitForSelector("#mm-accept", { timeout: 20000 });
  await p1.click("#mm-accept");
  await p2.click("#mm-accept");
  await p1.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p2.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p1.waitForTimeout(800);
  await p2.waitForTimeout(800);

  // Qui a le premier tour ? (celui avec des pions jouables)
  // Joueur actif = client dont playerNum === turn (l'aide .playable est coupée en ligne).
  const sA = await p1.evaluate(() => { const g = Fanorona.state(); return { turn: g.turn, pn: g.playerNum }; });
  const mover = sA.turn === sA.pn ? p1 : p2;
  console.log("Premier joueur (turn=" + sA.turn + ") =", (mover === p1 ? "P1" : "P2"));

  // Clic vrai sur les pions du joueur jusqu'à trouver une destination (dots).
  await mover.waitForTimeout(300);
  await dumpState(mover, "avant-clic");
  const myCells = await mover.evaluate(() => {
    const g = window.Fanorona && Fanorona.state();
    return [...document.querySelectorAll("#pieces .piece")]
      .filter((p) => +p.dataset.v === g.playerNum)
      .map((p) => ({ r: p.dataset.r, c: p.dataset.c }));
  });
  let clicked = null;
  for (const cell of myCells) {
    await mover.click(`.cell[data-r="${cell.r}"][data-c="${cell.c}"]`);
    await mover.waitForTimeout(130);
    if (await mover.evaluate(() => document.querySelectorAll("#dots .dot").length > 0)) { clicked = cell; break; }
  }
  if (!clicked) {
    console.log("=> AUCUN DOT sur aucun de mes pions (RGRESSION)");
  } else {
    const box = await mover.locator(`.cell[data-r="${clicked.r}"][data-c="${clicked.c}"]`).boundingBox();
    const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
    const top = await mover.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return { at: e ? (e.className && e.className.toString ? e.className.toString() : e.tagName) : null, id: e && e.id };
    }, { x: cx, y: cy });
    console.log("elementFromPoint au pion du joueur:", JSON.stringify(top));
    await dumpState(mover, "apres-clic-pion");

    const dotLoc = mover.locator("#dots .dot");
    if (await dotLoc.count() > 0) {
      const dbox = await dotLoc.first().boundingBox();
      await mover.mouse.click(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2);
      await mover.waitForTimeout(600);
      await dumpState(mover, "apres-clic-dest");
    }
  }

  // (Flux "pion non jouable" couvert via test_turns en boucle ; non testé ici
  //  car après le coup joué il n'est plus au tour du joueur local.)

  await p1.screenshot({ path: "shots/repro_p1.png" });
  await p2.screenshot({ path: "shots/repro_p2.png" });
  await browser.close();

  console.log("--- erreurs console ---");
  if (errors.length) errors.forEach((e) => console.log("  ⚠", e));
  else console.log("  (aucune)");
  console.log("=== FIN TEST CLICK REPRO (0 = OK) ===");
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
