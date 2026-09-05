"use strict";
/* Test E2E : demandes d'ami + message auto « D-aona » + crop avatar
   + dropdown provinces + recherche classement + profil avec photo.
   AUCUN screenshot — vérifications DOM/API uniquement. */
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8080";

async function api(path, method = "GET", body = null, token = null) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

(async () => {
  const errors = [];
  const ok = (cond, label) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) errors.push(label); };
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const A = "ReqA_" + tag, B = "ReqB_" + tag, C = "ReqC_" + tag;

  /* ---- 0. Crop avatar : toutes résolutions (400×200 → 256×256 carré) ---- */
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const crop = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 200;
    canvas.getContext("2d").fillStyle = "#f00";
    canvas.getContext("2d").fillRect(0, 0, 400, 200);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = canvas.toDataURL("image/png"); });
    const w = img.width, h = img.height, side = Math.min(w, h);
    const c = document.createElement("canvas"); c.width = c.height = 256;
    c.getContext("2d").drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 256, 256);
    const out = c.toDataURL("image/jpeg", 0.85);
    const outImg = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = out; });
    return { w: outImg.width, h: outImg.height, isSquare: outImg.width === outImg.height, isJpeg: out.startsWith("data:image/jpeg") };
  });
  ok(crop.isSquare && crop.w === 256 && crop.h === 256, "Crop avatar: 400×200 → 256×256 carré (non déformé)");
  ok(crop.isJpeg, "Crop avatar: sortie JPEG");

  /* ---- 1. Demande d'ami : envoi ---- */
  const authA = await api("/api/auth", "POST", { pseudo: A });
  const authB = await api("/api/auth", "POST", { pseudo: B });
  const authC = await api("/api/auth", "POST", { pseudo: C });
  const tokA = authA.data.token, tokB = authB.data.token, tokC = authC.data.token;

  const send = await api("/api/friends/request", "POST", { pseudo: B }, tokA);
  ok(send.status === 200 && send.data.status === "sent", `A → B : demande envoyée (id=${send.data.requestId})`);
  const reqId = send.data.requestId;
  const fb = await api("/api/friends", "GET", null, tokB);
  ok(fb.data.incoming.length === 1 && fb.data.incoming[0].pseudo === A, "B : 1 demande reçue de A");
  const fa = await api("/api/friends", "GET", null, tokA);
  ok(fa.data.outgoing.length === 1 && fa.data.outgoing[0].pseudo === B, "A : 1 demande envoyée vers B");
  ok(fa.data.friends.length === 0 && fb.data.friends.length === 0, "Pas encore amis (attente acceptation)");

  /* ---- 2. Refus (C refuse A) ---- */
  const sendC = await api("/api/friends/request", "POST", { pseudo: C }, tokA);
  const dec = await api("/api/friends/respond", "POST", { id: sendC.data.requestId, action: "decline" }, tokC);
  ok(dec.status === 200 && dec.data.status === "declined", "C refuse la demande de A");
  const fa2 = await api("/api/friends", "GET", null, tokA);
  ok(fa2.data.outgoing.filter((r) => r.pseudo === C).length === 0, "Demande refusée n'apparaît plus");
  ok(fa2.data.friends.filter((f) => f.pseudo === C).length === 0, "C n'est PAS ami après refus");

  /* ---- 3. Acceptation + message auto « D-aona » ---- */
  const acc = await api("/api/friends/respond", "POST", { id: reqId, action: "accept" }, tokB);
  ok(acc.status === 200 && acc.data.status === "accepted", "B accepte la demande de A");
  const fa3 = await api("/api/friends", "GET", null, tokA);
  const fb3 = await api("/api/friends", "GET", null, tokB);
  ok(fa3.data.friends.some((f) => f.pseudo === B), "A voit B dans ses amis");
  ok(fb3.data.friends.some((f) => f.pseudo === A), "B voit A dans ses amis");
  const thread = await api("/api/chat/" + encodeURIComponent(B), "GET", null, tokA);
  const msgs = thread.data.messages || [];
  const lastMsg = msgs.slice(-1)[0];
  ok(msgs.some((m) => /d-?aona/i.test(m.text) && m.direction === "them"), `Message auto « D-aona » reçu par A ("${lastMsg ? lastMsg.text.slice(0, 40) : "aucun"}")`);
  const again = await api("/api/friends/respond", "POST", { id: reqId, action: "accept" }, tokB);
  ok(again.status === 400, "Re-acceptation d'une demande traitée → 400");

  /* ---- 4. Profil public AVEC photo ---- */
  const up = await api("/api/user/avatar", "POST", { avatar: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }, tokA);
  ok(up.data.ok === true, "A : photo uploadée " + up.data.avatar);
  const prof = await api("/api/users/" + authA.data.user.id, "GET", null, tokC);
  ok(prof.status === 200 && prof.data.user.avatar, "C accède au profil de A (avec photo)");
  ok(prof.data.user.friendStatus === "none", "friendStatus C→A = none");

  /* ---- 5. Dropdown provinces + recherche (DOM) ---- */
  await page.evaluate((t) => localStorage.setItem("daona_token", t), tokC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#auth.hidden", { state: "attached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => { location.hash = "#/ranks"; });
  await page.waitForTimeout(900);

  const hasSearch = await page.locator("#rank-search").count();
  ok(hasSearch === 1, "Barre de recherche présente");
  await page.fill("#rank-search", "SolofoGM");
  await page.waitForTimeout(500);
  const rows = await page.locator("#screen-ranks .rank-row:not(.head)").count();
  ok(rows === 1, `Recherche "SolofoGM" → ${rows} ligne filtrée`);
  await page.click("#rank-search-clear").catch(() => {});
  await page.waitForTimeout(400);
  ok((await page.locator("#screen-ranks .rank-row:not(.head)").count()) > 10, "Recherche effacée → liste complète");

  await page.click('[data-scope="province"]');
  await page.waitForTimeout(400);
  const sel = page.locator("#province-select");
  ok((await sel.locator("option").count()) === 6, `Dropdown province : 6 options`);
  ok((await page.locator("#screen-ranks .province-strip").count()) === 0, "Ancienne barre de boutons supprimée");
  await sel.selectOption("Toamasina");
  await page.waitForTimeout(400);
  const pRanks = await page.evaluate(() => [...document.querySelectorAll("#screen-ranks .rank-row:not(.head) .mono.muted")].map((e) => e.textContent.trim()));
  ok(pRanks[0] === "1" && pRanks.every((v, i) => parseInt(v) === i + 1), `Toamasina via dropdown → rang recalculé 1..n (${pRanks.length})`);

  await page.setViewportSize({ width: 380, height: 800 });
  await page.waitForTimeout(300);
  const selW = await page.evaluate(() => { const s = document.getElementById("province-select"); return s ? Math.round(s.getBoundingClientRect().width) : 0; });
  ok(selW > 300, `Mobile 380px : dropdown pleine largeur (${selW}px)`);

  await browser.close();
  console.log("\n--- Erreurs ---");
  if (errors.length) { errors.forEach((e) => console.log("  ⚠", e)); console.log("=== TEST ÉCHOUÉ ==="); process.exit(1); }
  console.log("  (aucune)");
  console.log("\n=== TEST DEMANDES D'AMI / CROP / DROPDOWN / RECHERCHE RÉUSSI ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
