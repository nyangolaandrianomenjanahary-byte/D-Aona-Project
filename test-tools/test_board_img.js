"use strict";
/* Test visuel : nouveau plateau plateau_exact.svg — alignement pions/grille. */
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8080";

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#auth-id", "TestPlateau" + (Date.now() % 10000));
  await p.click("#auth-enter");
  await p.waitForTimeout(1200);
  await p.evaluate(() => { location.hash = "#/play"; });
  await p.waitForTimeout(700);
  await p.click("#play-root .mode-card[data-mode='ai']");
  await p.waitForTimeout(400);
  await p.click("#btn-launch");
  await p.waitForTimeout(1200);
  // Toss pile/face éventuel avant le début de la partie
  const toss = await p.evaluate(() => {
    const btns = [...document.querySelectorAll("#modal button")];
    const b = btns.find((x) => /PILE/i.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  });
  if (toss) console.log("✓ Toss : PILE choisi");
  await p.waitForTimeout(800);
  // Résultat du tirage → « C'est parti ! »
  await p.evaluate(() => {
    const b = [...document.querySelectorAll("#modal button")].find((x) => /parti/i.test(x.textContent));
    if (b) b.click();
  });
  await p.waitForTimeout(1200);

  const img = await p.evaluate(() => {
    const i = document.querySelector(".board-img");
    return i ? { loaded: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight } : null;
  });
  console.log("board-img:", JSON.stringify(img));

  const stage = await p.evaluate(() => {
    const s = document.getElementById("board-stage").getBoundingClientRect();
    return { w: Math.round(s.width), h: Math.round(s.height), ratio: +(s.width / s.height).toFixed(3) };
  });
  console.log("stage:", JSON.stringify(stage), "(ratio attendu ≈ 1.724)");

  // Vérification alignement : pièce (0,0) doit coïncider avec l'intersection haut-gauche
  const align = await p.evaluate(() => {
    const st = document.getElementById("board-stage").getBoundingClientRect();
    const pc = document.querySelector('.piece[data-r="0"][data-c="0"]').getBoundingClientRect();
    const px = (pc.left + pc.width / 2 - st.left) / st.width;   // fraction attendue 197/1647 ≈ 0.1196
    const py = (pc.top + pc.height / 2 - st.top) / st.height;   // fraction attendue 144/955 ≈ 0.1508
    return { fx: +px.toFixed(4), fy: +py.toFixed(4) };
  });
  console.log("pièce (0,0):", JSON.stringify(align), "(attendu fx≈0.1196 fy≈0.1508)");
  // Positions réelles de toutes les pièces (pour calibrer la grille sur l'image)
  const grid = await p.evaluate(() => {
    const st = document.getElementById("board-stage").getBoundingClientRect();
    const pos = {};
    document.querySelectorAll(".piece").forEach((pc) => {
      const r = pc.getBoundingClientRect();
      pos[pc.dataset.r + "," + pc.dataset.c] = [
        +(((r.left + r.width / 2 - st.left) / st.width) * 1647).toFixed(1),
        +(((r.top + r.height / 2 - st.top) / st.height) * 955).toFixed(1),
      ];
    });
    return { stageW: +st.width.toFixed(1), stageH: +st.height.toFixed(1), pieceW: +document.querySelector(".piece").getBoundingClientRect().width.toFixed(1), pos };
  });
  console.log("mesures:", JSON.stringify(grid));

  await p.screenshot({ path: "shots/board_new.png" });
  await (await p.$("#board-stage")).screenshot({ path: "shots/board_only.png" });

  // Clic sur une pièce jouable pour vérifier l'interactivité + dots
  await p.evaluate(() => {
    const pc = document.querySelector(".piece.playable");
    if (pc) document.querySelector(`.cell[data-r="${pc.dataset.r}"][data-c="${pc.dataset.c}"]`).click();
  });
  await p.waitForTimeout(500);
  const dots = await p.evaluate(() => document.querySelectorAll("#dots .dot").length);
  console.log(dots > 0 ? `✓ Interactivité OK (${dots} destinations proposées)` : "✗ Aucun dot après sélection");
  await (await p.$("#board-stage")).screenshot({ path: "shots/board_dots.png" });

  console.log("erreurs page:", errs.length ? errs : "aucune");
  await b.close();
})();
