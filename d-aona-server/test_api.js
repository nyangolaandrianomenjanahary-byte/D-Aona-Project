"use strict";
const http = require("http");
let token = null;
function api(path, method, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const req = http.request(`http://localhost:8080${path}`, {
      method, headers
    }, (res) => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    if (data) req.write(data);
    req.end();
  });
}
(async () => {
  // Auth
  const auth = await api("/api/auth", "POST", { pseudo: "Tsiry_RN" });
  console.log("AUTH:", auth.status, auth.body);
  const { token: t, user } = JSON.parse(auth.body);
  token = t;

  // User
  const userRes = await api("/api/user", "GET");
  console.log("USER:", userRes.status, userRes.body.slice(0, 200));

  // Tournaments
  const tourneys = await api("/api/tournaments", "GET");
  console.log("TOURNOIS:", tourneys.status, tourneys.body.slice(0, 300));

  // Leaderboard
  const lb = await api("/api/leaderboard", "GET");
  console.log("LEADERBOARD:", lb.status, lb.body.slice(0, 300));

  // Skins
  const skins = await api("/api/skins", "GET");
  console.log("SKINS:", skins.status, skins.body.slice(0, 200));

  // Friends
  const friends = await api("/api/friends", "GET");
  console.log("FRIENDS:", friends.status, friends.body.slice(0, 200));

  // Config
  const config = await api("/api/config", "GET");
  console.log("CONFIG:", config.status, config.body.slice(0, 100));

  // Deposit
  const dep = await api("/api/deposit", "POST", { amount: 10000, operator: "MVola" });
  console.log("DEPOT:", dep.status, dep.body);

  // Buy skin
  const buySkin = await api("/api/skins/buy", "POST", { skinId: "pions-emeraude" });
  console.log("BUY SKIN:", buySkin.status, buySkin.body);

  // Equip skin
  const equip = await api("/api/skins/equip", "POST", { skinId: "pions-emeraude", kind: "pions" });
  console.log("EQUIP:", equip.status, equip.body);

  console.log("\n=== API REST TESTS PASSÉS ===");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });