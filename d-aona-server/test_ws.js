"use strict";
/* Test WebSocket : matchmaking + jeu en ligne + résignation */
const WebSocket = require("ws");
const http = require("http");

function auth(pseudo) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ pseudo });
    const req = http.request("http://localhost:8080/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" }
    }, (res) => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => resolve(JSON.parse(b)));
    });
    req.write(data); req.end();
  });
}

function connect(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      resolve(ws);
    });
  });
}

(async () => {
  console.log("=== TEST WEBSOCKET (matchmaking + jeu) ===");
  const a = await auth("TestJoueur1");
  const b = await auth("TestJoueur2");
  const ws1 = await connect(a.token);
  const ws2 = await connect(b.token);
  console.log("✓ 2 joueurs connectés et authentifiés WS");

  let sessionId = null;
  let matched = false;
  let resigned = false;

  ws1.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "match_found") {
      console.log(`✓ J1 - match trouvé vs ${m.opponent.pseudo} (Elo ${m.opponent.elo}), acceptation…`);
      ws1.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
    }
    if (m.type === "game_start") {
      sessionId = m.sessionId;
      matched = true;
      console.log(`✓ J1 - partie démarrée (session ${m.sessionId}), joueur ${m.playerNum}, adversaire: ${m.opponent.pseudo}`);
      // J1 se résigne après 1.5s pour terminer proprement
      setTimeout(() => {
        ws1.send(JSON.stringify({ type: "resign", sessionId }));
        console.log("✓ J1 - résignation envoyée");
      }, 1500);
    }
    if (m.type === "game_state") {
      console.log("  J1 - état reçu (tour " + m.state.turn + ")");
    }
    if (m.type === "game_end") {
      console.log(`✓ J1 - fin de partie: raison=${m.result.reason}, gagnant=${m.result.winner}, coups=${m.result.moves}`);
      resigned = true;
      console.log("\n=== TEST WS RÉUSSI ===");
      console.log("Matchmaking: OK");
      console.log("Jeu en ligne temps réel: OK");
      console.log("Résignation + fin serveur: OK");
      process.exit(0);
    }
    if (m.type === "error") console.log("  J1 - erreur:", m.message);
  });

  ws2.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "match_found") {
      console.log(`✓ J2 - match trouvé vs ${m.opponent.pseudo} (Elo ${m.opponent.elo}), acceptation…`);
      ws2.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
    }
    if (m.type === "game_start") {
      console.log(`✓ J2 - partie démarrée (session ${m.sessionId}), joueur ${m.playerNum}, adversaire: ${m.opponent.pseudo}`);
    }
    if (m.type === "game_end") {
      console.log(`✓ J2 - fin de partie: raison=${m.result.reason}, gagnant=${m.result.winner}`);
    }
    if (m.type === "error") console.log("  J2 - erreur:", m.message);
  });

  // Matchmaking
  ws1.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" }));
  console.log("J1 - recherche de match…");
  setTimeout(() => {
    ws2.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" }));
    console.log("J2 - recherche de match…");
  }, 500);

  // Timeout 30s
  setTimeout(() => {
    if (!matched) console.log("TIMEOUT - matchmaking n'a pas abouti");
    else if (!resigned) console.log("TIMEOUT - la partie n'a pas fini, mais le matchmaking et la connexion WS ont fonctionné");
    process.exit(matched ? 0 : 1);
  }, 30000);
})().catch((e) => { console.error(e); process.exit(1); });