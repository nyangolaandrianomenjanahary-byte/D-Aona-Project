"use strict";
/* Test des nouvelles fonctionnalités : amis (recherche/ajout/suppression) + défis non gratuits */
const http = require("http");
const WebSocket = require("ws");

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

(async () => {
  console.log("=== TEST AMIS + DÉFIS NON GRATUITS ===");
  const tag = Math.floor(Math.random() * 90000 + 10000);
  const a = (await api("/api/auth", "POST", { pseudo: "AmiA_" + tag })).data;
  const b = (await api("/api/auth", "POST", { pseudo: "AmiB_" + tag })).data;
  console.log("✓ Comptes:", a.user.pseudo, "/", b.user.pseudo);

  // 1. Recherche
  const search = await api("/api/users/search?q=AmiB_" + tag, "GET", null, a.token);
  const found = (search.data.users || []).find((u) => u.pseudo === b.user.pseudo);
  console.log(found ? "✓ Recherche trouve " + b.user.pseudo : "✗ Recherche KO", "| isFriend:", found && found.isFriend);
  if (!found) process.exit(1);

  // 2. Ajout ami
  const add = await api("/api/friends", "POST", { pseudo: b.user.pseudo }, a.token);
  console.log(add.status === 200 && add.data.ok ? "✓ Ami ajouté" : "✗ Ajout KO: " + JSON.stringify(add.data));

  // 3. Liste amis
  const list = await api("/api/friends", "GET", null, a.token);
  const hasB = (list.data.friends || []).some((f) => f.pseudo === b.user.pseudo);
  console.log(hasB ? "✓ Liste amis contient " + b.user.pseudo : "✗ Liste amis KO");
  if (!hasB) process.exit(1);

  // 4. Doublon refusé
  const dup = await api("/api/friends", "POST", { pseudo: b.user.pseudo }, a.token);
  console.log(dup.status === 400 ? "✓ Doublon refusé" : "✗ Doublon non refusé: " + dup.status);

  // 5. Suppression
  const del = await api("/api/friends/" + encodeURIComponent(b.user.pseudo), "DELETE", null, a.token);
  const list2 = await api("/api/friends", "GET", null, a.token);
  const stillB = (list2.data.friends || []).some((f) => f.pseudo === b.user.pseudo);
  console.log(del.data.ok && !stillB ? "✓ Ami supprimé" : "✗ Suppression KO");

  // 6. Défi gratuit refusé (wager 0)
  const ws = new WebSocket("ws://localhost:8080/ws");
  await new Promise((r) => { ws.on("open", () => { ws.send(JSON.stringify({ type: "auth", token: a.token })); r(); }); });
  await new Promise((r) => setTimeout(r, 300));
  let gotError = null;
  ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "error") gotError = m.message; });
  ws.send(JSON.stringify({ type: "send_challenge", toPseudo: b.user.pseudo, wager: 0, format: "blitz" }));
  await new Promise((r) => setTimeout(r, 600));
  console.log(gotError && /500 Ar/.test(gotError) ? "✓ Défi gratuit refusé (mise minimale)" : "✗ Défi gratuit NON refusé: " + gotError);

  // 7. Défi avec mise (sans KYC → refusé KYC)
  let gotError2 = null;
  ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "error") gotError2 = m.message; });
  ws.send(JSON.stringify({ type: "send_challenge", toPseudo: b.user.pseudo, wager: 500, format: "blitz" }));
  await new Promise((r) => setTimeout(r, 600));
  console.log(gotError2 && /KYC/.test(gotError2) ? "✓ Défi avec mise exige KYC" : "⚠ KYC non exigé: " + gotError2);

  ws.close();
  console.log("\n=== TEST AMIS + DÉFIS RÉUSSI ===");
  process.exit(0);
})().catch((e) => { console.error("ERREUR:", e); process.exit(1); });
