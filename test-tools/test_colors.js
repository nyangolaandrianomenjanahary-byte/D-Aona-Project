"use strict";
/* Vérifie que la couleur des pions est ABSOLUE et identique des deux côtés :
   joueur 1 (valeur 1) = classe .me, joueur 2 (valeur 2) = classe .opp,
   sur les DEUX clients en même temps. */
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

(async () => {
  console.log(`=== TEST COULEURS (cohérence 2 clients) : ${BASE} ===`);
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const browser = await chromium.launch({ headless: true });
  const c1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const c2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  await loginAndMatch(p1, "ColA_" + tag);
  await loginAndMatch(p2, "ColB_" + tag);
  await p1.waitForSelector("#mm-accept", { timeout: 20000 });
  await p2.waitForSelector("#mm-accept", { timeout: 20000 });
  await p1.click("#mm-accept");
  await p2.click("#mm-accept");
  await p1.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p2.waitForSelector("#fanorona-board .piece", { timeout: 15000 });
  await p1.waitForTimeout(800);
  await p2.waitForTimeout(800);

  const read = () => (page) => page.evaluate(() => {
    const map = {};
    document.querySelectorAll("#pieces .piece").forEach((p) => {
      const key = p.dataset.v;
      const isMe = p.classList.contains("me");
      map[key] = (map[key] === undefined ? "" : map[key]) + (isMe ? "me" : "opp") + ",";
    });
    return map;
  });
  const m1 = await read()(p1);
  const m2 = await read()(p2);

  console.log("Client A (par valeur):", JSON.stringify(m1));
  console.log("Client B (par valeur):", JSON.stringify(m2));

  // Cohérence : pour chaque valeur de pion, la classe doit être identique sur A et B.
  let ok = true;
  const only = (s, cls) => (s || "").split(",").filter((x) => x.length).every((x) => x === cls);
  const vals = new Set([...Object.keys(m1), ...Object.keys(m2)]);
  vals.forEach((k) => {
    const a = (m1[k] || "").trim();
    const b = (m2[k] || "").trim();
    if (a !== b || !a) { ok = false; console.log(`✗ valeur ${k}: A="${a}" vs B="${b}"`); }
  });
  // Le joueur 1 (val 1) doit être .me et le joueur 2 (val 2) .opp, les deux côtés.
  if (!only(m1["1"], "me")) { ok = false; console.log(`✗ val 1 n'est pas tout .me: ${m1["1"]}`); }
  if (!only(m1["2"], "opp")) { ok = false; console.log(`✗ val 2 n'est pas tout .opp: ${m1["2"]}`); }

  await browser.close();
  console.log(ok ? "=== COULEURS COHÉRENTES (chacun sa couleur, identique des 2 côtés) ===" : "=== COULEURS INCOHÉRENTES ===");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
