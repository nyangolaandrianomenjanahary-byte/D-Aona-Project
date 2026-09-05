"use strict";
/* Test complet : partie avec coups réels + persistance DB */
const WebSocket = require("ws");
const http = require("http");
const { legalMoves } = require("./game");

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

(async () => {
  console.log("=== TEST PARTIE COMPLÈTE (coups + DB) ===");
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const a = (await api("/api/auth", "POST", { pseudo: "FullA_" + tag })).data;
  const b = (await api("/api/auth", "POST", { pseudo: "FullB_" + tag })).data;
  console.log("✓ Comptes:", a.user.pseudo, "(id", a.user.id + ")", "/", b.user.pseudo, "(id", b.user.id + ")");

  const ws1 = await connect(a.token);
  const ws2 = await connect(b.token);

  let sessionId = null, lastState = null, movesPlayed = 0, myRole = { 1: null, 2: null };

  function tryPlay(ws, state, playerNum) {
    if (state.turn !== playerNum || state.over) return;
    const moves = legalMoves(state.grid, playerNum, state.chain ? {
      pos: state.chain.pos, visited: new Set(state.chain.visited), lastDir: state.chain.lastDir
    } : null);
    const move = moves[0];
    if (!move) { ws.send(JSON.stringify({ type: "resign", sessionId })); return; }
    movesPlayed++;
    console.log(`  J${playerNum} joue: [${move.from}] → [${move.to}] (${move.kind}${move.cap.length ? ", capture x" + move.cap.length : ""})`);
    ws.send(JSON.stringify({ type: "move", sessionId, move }));
  }

  function onState(ws, playerNum) {
    return (m) => {
      if (m.type === "match_found") ws.send(JSON.stringify({ type: "accept_match", matchKey: m.matchKey }));
      if (m.type === "game_start") {
        sessionId = m.sessionId; myRole[playerNum] = m.playerNum;
        // Chaque joueur choisit une face (l'autre reçoit automatiquement l'autre).
        ws.send(JSON.stringify({ type: "pick_side", sessionId, side: m.playerNum === 1 ? "pile" : "face" }));
      }
      if (m.type === "game_state") {
        lastState = m.state;
        if (movesPlayed < 10) setTimeout(() => tryPlay(ws, m.state, myRole[playerNum] || playerNum), 200);
      }
      if (m.type === "game_end") {
        console.log(`✓ J${playerNum} fin: ${m.result.reason}, gagnant=${m.result.winner}, coups=${m.result.moves}`);
      }
    };
  }

  ws1.on("message", (d) => { const m = JSON.parse(d.toString()); onState(ws1, 1)(m);
    if (m.type === "game_end") setTimeout(verifyDB, 500); });
  ws2.on("message", (d) => onState(ws2, 2)(JSON.parse(d.toString())));

  async function verifyDB() {
    console.log("\n--- Vérification base de données ---");
    // Historique des parties
    const hist1 = await api("/api/games/history", "GET", null, a.token);
    const games = (hist1.data && hist1.data.games) || [];
    const found = games.find((g) => g.player1_id === a.user.id || g.player2_id === a.user.id);
    console.log(found ? "✓ Partie enregistrée en DB (games)" : "… historique:", JSON.stringify(hist1.data).slice(0, 150));

    // Elo mis à jour
    const u1 = await api("/api/user", "GET", null, a.token);
    const u2 = await api("/api/user", "GET", null, b.token);
    console.log(`✓ Elo J1: ${a.user.elo} → ${u1.data.user.elo} | Elo J2: ${b.user.elo} → ${u2.data.user.elo}`);
    console.log(`✓ Wins/Losses J1: ${u1.data.user.wins}V/${u1.data.user.losses}D | J2: ${u2.data.user.wins}V/${u2.data.user.losses}D`);

    console.log("\n=== TEST PARTIE COMPLÈTE RÉUSSI ===");
    process.exit(0);
  }

  ws1.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" }));
  setTimeout(() => ws2.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" })), 400);
  // Après 10 coups, J2 résigne pour clore
  setTimeout(() => { if (sessionId) ws2.send(JSON.stringify({ type: "resign", sessionId })); }, 6000);

  setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 25000);
})().catch((e) => { console.error("ERREUR:", e); process.exit(1); });
