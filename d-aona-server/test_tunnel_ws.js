"use strict";
/* Test WebSocket à travers le tunnel public Cloudflare (wss://) */
const WebSocket = require("ws");
const https = require("https");

const BASE = process.argv[2] || "https://petite-doing-oakland-colleges.trycloudflare.com";
const WS_BASE = BASE.replace(/^http/, "ws");

function auth(pseudo) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ pseudo });
    const url = new URL(BASE + "/api/auth");
    const req = https.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, (res) => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b)); } });
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_BASE + "/ws");
    ws.on("open", () => { ws.send(JSON.stringify({ type: "auth", token })); resolve(ws); });
    ws.on("error", reject);
  });
}

(async () => {
  console.log("=== TEST WS VIA TUNNEL PUBLIC (wss) ===");
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const a = await auth("RemoteA_" + tag);
  const b = await auth("RemoteB_" + tag);
  console.log("✓ 2 comptes créés via tunnel HTTPS:", a.user.pseudo, "/", b.user.pseudo);

  const ws1 = await connect(a.token);
  const ws2 = await connect(b.token);
  console.log("✓ 2 WebSocket wss:// connectés via tunnel");

  let done = false;
  ws1.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "match_found") {
      console.log("✓ J1 match trouvé, acceptation…");
      ws1.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
    }
    if (m.type === "game_start") {
      console.log("✓ J1 partie démarrée (joueur " + m.playerNum + ")");
      setTimeout(() => ws1.send(JSON.stringify({ type: "resign", sessionId: m.sessionId })), 800);
    }
    if (m.type === "game_end" && !done) {
      done = true;
      console.log("✓ J1 fin de partie reçue:", m.result.reason, "— gagnant:", m.result.winner);
      console.log("\n=== TEST TUNNEL WS RÉUSSI ===");
      process.exit(0);
    }
  });
  ws2.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "match_found") {
      console.log("✓ J2 match trouvé, acceptation…");
      ws2.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
    }
    if (m.type === "game_start") console.log("✓ J2 partie démarrée (joueur " + m.playerNum + ")");
  });

  ws1.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" }));
  setTimeout(() => ws2.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" })), 500);

  setTimeout(() => { console.log("TIMEOUT - échec du test tunnel WS"); process.exit(1); }, 30000);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
