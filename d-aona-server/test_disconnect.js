"use strict";
/* Test "victoire par abandon sans avoir cliqué" :
   Une déconnexion WebSocket ne doit PAS clore la partie immédiatement ;
   une reconnexion pendant le délai de grâce (20 s) doit reprendre le match. */
const WebSocket = require("ws");
const http = require("http");

function api(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const req = http.request("http://localhost:8080" + path, { method, headers }, (res) => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, data: b }); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
function connect(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    ws.on("open", () => { ws.send(JSON.stringify({ type: "auth", token })); resolve(ws); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("=== TEST DÉCONNEXION / DÉLAI DE GRÂCE ===");
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const a = (await api("/api/auth", "POST", { pseudo: "GraceA_" + tag })).data;
  const b = (await api("/api/auth", "POST", { pseudo: "GraceB_" + tag })).data;

  const wsA = await connect(a.token);
  const wsB = await connect(b.token);
  const t0 = Date.now();
  let sessionId = null, endedA = null;

  wsA.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "match_found") wsA.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
    if (m.type === "game_start") sessionId = m.sessionId;
    if (m.type === "game_end") { endedA = { reason: m.result && m.result.reason, winner: m.result && m.result.winner, atSec: Math.round((Date.now() - t0) / 1000) }; console.log("  [game_end reçu à", endedA.atSec + "s]", JSON.stringify(endedA)); }
  });
  wsB.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "match_found") wsB.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
  });

  wsA.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" }));
  await sleep(400);
  wsB.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" }));
  for (let i = 0; i < 40 && !sessionId; i++) await sleep(200);
  if (!sessionId) { console.log("✗ aucune partie démarrée"); process.exit(1); }
  console.log("✓ Partie démarrée:", sessionId);

  await sleep(500);
  // B se déconnecte brutalement (simule un blip réseau / tunnel).
  wsB.terminate();

  // Dans le délai de grâce, A ne doit PAS recevoir de game_end (abandon).
  await sleep(3000);
  if (endedA) { console.log(`✗ abandon prématuré en 3 s : ${JSON.stringify(endedA)}`); process.exit(1); }
  console.log("✓ Pas d'abandon pendant la coupure (3 s < grâce 20 s)");

  // B se reconnecte avant la fin de la grâce : le match doit continuer.
  const wsB2 = await connect(b.token);
  const gotRefresh = new Promise((resolve) => {
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.type === "game_state" || m.type === "game_end") { wsA.off("message", h); resolve(m.type); } };
    wsA.on("message", h);
  });
  wsB2.send(JSON.stringify({ type: "sync_game", sessionId }));
  const refreshType = await Promise.race([gotRefresh, sleep(3000).then(() => "timeout")]);
  await sleep(1000);
  if (endedA) {
    if (endedA.reason === "abandon") { console.log(`✗ abandon après reconnexion (reason=${endedA.reason})`); process.exit(1); }
  } else {
    console.log("✓ Aucun game_end ; type reçu:", refreshType);
  }

  // Fermer proprement : A résigne pour ne pas laisser de session orpheline.
  wsA.send(JSON.stringify({ type: "resign", sessionId }));
  await sleep(400);
  console.log("=== TEST DÉCONNEXION / GRÂCE OK (pas d'abandon intempestif) ===");
  process.exit(0);
})().catch((e) => { console.error("ÉCHEC:", e.message); process.exit(1); });
