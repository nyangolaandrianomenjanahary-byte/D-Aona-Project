// Test E2E : inscription de 8 joueurs -> generation du bracket a la completion
const BASE = "http://localhost:8080";
const PLAYERS = ["SolofoGM","RadoTheKing","MialyPro","TianaDiam","KantoV","HajaPlt","Faniry_","ZoFighter"];

async function auth(pseudo) {
  const r = await fetch(BASE + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pseudo }) });
  return r.json();
}
async function post(path, token, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body || {}) });
  return r.json();
}
async function get(path, token) {
  const r = await fetch(BASE + path, { headers: { Authorization: "Bearer " + token } });
  return r.json();
}

(async () => {
  // 1. Donner KYC + solde aux joueurs (via DB indirectement impossible -> on triche via /api/kyc puis depot)
  const tokens = {};
  for (const p of PLAYERS) {
    const a = await auth(p);
    tokens[p] = a.token;
    await post("/api/kyc/verify", a.token, {});
    await post("/api/deposit", a.token, { amount: 20000, operator: "MVola" });
  }
  // 2. Inscrire les 8 joueurs au tournoi 1 (entry 2000, max 8)
  for (const p of PLAYERS) {
    const res = await post("/api/tournaments/join", tokens[p], { tournamentId: 1 });
    console.log(p, "->", res.error ? "ERR: " + res.error : "inscrit");
  }
  // 3. Verifier le bracket genere
  const detail = await get("/api/tournaments/1", tokens[PLAYERS[0]]);
  console.log("\nTournoi status:", detail.tournament.status, "| participants:", detail.tournament.participants);
  console.log("Matchs du bracket:", detail.matches.length);
  for (const m of detail.matches)
    console.log(`  R${m.round} S${m.slot}: ${m.p1_pseudo || "bye"} vs ${m.p2_pseudo || "bye"} | ${m.status} | next=${m.next_match_id}`);
  // 4. Mes tournois pour SolofoGM
  const mine = await get("/api/tournaments/my", tokens["SolofoGM"]);
  console.log("\nMes tournois (SolofoGM):", JSON.stringify(mine.tournaments, null, 1));
  // 5. Notifications de SolofoGM
  const n = await get("/api/notifications", tokens["SolofoGM"]);
  console.log("\nNotifications SolofoGM (unread=" + n.unread + "):");
  n.notifications.slice(0, 5).forEach((x) => console.log("  -", x.type, ":", x.payload.text));
})().catch((e) => { console.error("ERREUR", e); process.exit(1); });
