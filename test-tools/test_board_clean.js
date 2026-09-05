"use strict";
/* Test visuel : plateau_clean.png (fond transparent), panneau Actions sans débordement,
   aperçu du plateau dans l'onglet Jeux. */
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8080";

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#auth-id", "TestClean" + (Date.now() % 10000));
  await p.click("#auth-enter");
  await p.waitForTimeout(1200);

  // 1) Onglet Jeux : aperçu du plateau
  await p.evaluate(() => { location.hash = "#/play"; });
  await p.waitForTimeout(800);
  const prev = await p.evaluate(() => {
    const i = document.querySelector("#play-preview .board-img");
    return i ? { loaded: i.complete && i.naturalWidth > 0, src: i.src.split("/").pop() } : null;
  });
  console.log("aperçu jeux:", JSON.stringify(prev));
  await (await p.$("#play-preview")).screenshot({ path: "shots/play_preview.png" });
  await p.screenshot({ path: "shots/play_tab.png" });

  // 2) Lancer une partie IA
  await p.click("#play-root .mode-card[data-mode='ai']");
  await p.waitForTimeout(400);
  await p.click("#btn-launch");
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const b1 = [...document.querySelectorAll("#modal button")].find((x) => /PILE/i.test(x.textContent));
    if (b1) b1.click();
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll("#modal button")].find((x) => /parti/i.test(x.textContent));
    if (b2) b2.click();
  });
  await p.waitForTimeout(1200);

  // 3) Image plateau chargée + alignement inchangé
  const img = await p.evaluate(() => {
    const i = document.querySelector("#board-stage .board-img");
    return { loaded: i.complete && i.naturalWidth > 0, src: i.src.split("/").pop(), w: i.naturalWidth };
  });
  console.log("board-img:", JSON.stringify(img));
  const align = await p.evaluate(() => {
    const st = document.getElementById("board-stage").getBoundingClientRect();
    const pc = document.querySelector('.piece[data-r="0"][data-c="0"]').getBoundingClientRect();
    return {
      fx: +(((pc.left + pc.width / 2 - st.left) / st.width)).toFixed(4),
      fy: +(((pc.top + pc.height / 2 - st.top) / st.height)).toFixed(4),
    };
  });
  console.log("pièce (0,0):", JSON.stringify(align), "(attendu fx≈0.1196 fy≈0.1508)");

  // 4) Débordement du panneau Actions ?
  const overflow = await p.evaluate(() => {
    const panel = document.querySelector("#screen-board .board-actions").closest(".panel");
    const pr = panel.getBoundingClientRect();
    const out = [];
    panel.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(el.id || el.className || el.tagName);
    });
    return { panelW: Math.round(pr.width), debordements: out };
  });
  console.log("panneau Actions:", JSON.stringify(overflow));

  await p.screenshot({ path: "shots/board_clean_full.png" });
  await (await p.$("#board-stage")).screenshot({ path: "shots/board_clean.png" });
  await (await p.$("#screen-board .side-stack")).screenshot({ path: "shots/actions_panel.png" });

  console.log("erreurs page:", errs.length ? errs : "aucune");
  await b.close();
})();
