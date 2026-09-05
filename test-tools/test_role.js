"use strict";
/* Test du bug de rôle/couleur : 2 clients réels, couleurs différentes + tour après coup */
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8080";

async function loginAndMatch(page, pseudo) {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#auth-id", { timeout: 8000 });
  await page.fill("#auth-id", pseudo);
  await page.click("#auth-enter");
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(800);
  // Aller sur l'écran jeux et lancer le matchmaking
  await page.evaluate(() => { location.hash = "#/play"; });
  await page.waitForTimeout(600);
  await page.click("#btn-launch"); // mode par défaut = online
  await page.waitForTimeout(800);
}

(async () => {
  console.log(`=== TEST RÔLE/COULEUR (2 joueurs) : ${BASE} ===`);
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const browser = await chromium.launch({ headless: true });
  const ctx1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  await loginAndMatch(p1, "RoleA_" + tag);
  await loginAndMatch(p2, "RoleB_" + tag);

  // Attendre le modal "match trouvé" et accepter des deux côtés
  await p1.waitForSelector("#mm-accept", { timeout: 20000 });
  await p2.waitForSelector("#mm-accept", { timeout: 20000 });
  await p1.click("#mm-accept");
  await p2.click("#mm-accept");

  // Attendre le plateau
  await p1.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p2.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p1.waitForTimeout(800);
  await p2.waitForTimeout(800);

  // Vérifier les couleurs : la pièce en haut-gauche (r=0,c=0) vaut 2
  const colorAt = (page, r, c) => page.evaluate(([rr, cc]) => {
    const el = document.querySelector(`.piece[data-r="${rr}"][data-c="${cc}"]`);
    return el ? el.className : "none";
  }, [r, c]);

  const p1_top = await colorAt(p1, 0, 0);   // valeur 2
  const p2_top = await colorAt(p2, 0, 0);   // valeur 2
  const p1_bot = await colorAt(p1, 4, 0);   // valeur 1
  const p2_bot = await colorAt(p2, 4, 0);   // valeur 1

  console.log(`  Page A: haut=${p1_top} | bas=${p1_bot}`);
  console.log(`  Page B: haut=${p2_top} | bas=${p2_bot}`);

  // Les deux clients doivent voir des couleurs OPPOSÉES sur la même case
  const okColor = (p1_top.includes("me") !== p2_top.includes("me")) &&
                  (p1_bot.includes("me") !== p2_bot.includes("me"));
  console.log(okColor ? "✓ Couleurs DIFFÉRENTES entre les 2 clients (bug corrigé)" : "✗ Couleurs identiques (bug présent)");

  // Déterminer qui est le joueur au trait (celui qui a des pièces jouables)
  const playableCount = (page) => page.evaluate(() => document.querySelectorAll(".piece.playable").length);
  const aPlay = await playableCount(p1);
  const bPlay = await playableCount(p2);
  console.log(`  Tour initial — A jouable=${aPlay}, B jouable=${bPlay}`);
  const mover = aPlay > 0 ? p1 : p2;
  const waiter = aPlay > 0 ? p2 : p1;
  const okTurn = (aPlay > 0) !== (bPlay > 0); // exactement un joueur au trait
  console.log(okTurn ? "✓ Un seul joueur au trait au départ" : "✗ Tour initial incohérent");

  // Le joueur au trait joue un coup (cliquer la CELLULE de la pièce jouable)
  const cell = await mover.evaluate(() => {
    const p = document.querySelector(".piece.playable");
    return p ? { r: p.dataset.r, c: p.dataset.c } : null;
  });
  if (cell) await mover.click(`.cell[data-r="${cell.r}"][data-c="${cell.c}"]`);
  await mover.waitForTimeout(300);
  const dots = await mover.evaluate(() => document.querySelectorAll("#dots .dot").length);
  console.log(`  Joueur au trait voit ${dots} destination(s)`);
  let okAfter = false;
  if (dots > 0) {
    await mover.click("#dots .dot");
    await mover.waitForTimeout(1200);
    await waiter.waitForTimeout(1200);
    const waiterPlay = await playableCount(waiter);
    const moverPlay = await playableCount(mover);
    console.log(`  Après coup — joueur initial jouable=${moverPlay}, autre jouable=${waiterPlay}`);
    okAfter = waiterPlay > 0;
    console.log(okAfter ? "✓ L'autre joueur peut maintenant jouer (bug corrigé)" : "✗ L'autre joueur ne peut toujours pas jouer");
  }

  await browser.close();
  const allOk = okColor && okTurn && okAfter;
  console.log("\n=== TEST RÔLE/COULEUR " + (allOk ? "RÉUSSI" : "ÉCHOUÉ") + " ===");
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
