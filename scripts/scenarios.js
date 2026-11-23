/* =========================================================
   D-aôna — Les 8 scénarios métier de la RÉFÉRENCE (§11.4)
   ---------------------------------------------------------
   Rejoue sur un seed NEUF les huit scénarios du cahier des charges et compare
   l'état final aux valeurs attendues. Ce ne sont pas des tests unitaires : ce
   sont les scénarios de la maquette, rejoués contre l'API réelle.

   Ordre imposé par les dépendances :
     S1 → S3 → S6 → S5 → S2 → S7 → S4 → S8
   S6 (validation refusée sous litige) doit précéder S5 (qui clôt le litige),
   et S7 (rejeu du paiement) doit suivre S2.

   Usage : node scripts/scenarios.js
   Sortie : rapport ligne par ligne + code de sortie 1 si un scénario échoue.
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const SERVER_DIR = path.join(__dirname, "..", "d-aona-server");
const DB = path.join(SERVER_DIR, "_scenarios.db");
const PORT = 8097;
const BASE = "http://127.0.0.1:" + PORT;
const PWD = "Scenario!2026Zz";
const ADMIN_PSEUDO = "ScenarAdmin";

let failed = 0;
let passed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log("  OK    " + label + (detail ? "   -> " + detail : "")); }
  else { failed++; console.log("  ECHEC " + label + (detail ? "   -> " + detail : "")); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, { method = "GET", body = null, token = null } = {}) {
  const opt = { method, headers: { "Content-Type": "application/json" }, cache: "no-store" };
  if (token) opt.headers.Authorization = "Bearer " + token;
  if (body != null) opt.body = JSON.stringify(body);
  const res = await fetch(BASE + pathname, opt);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { status: res.status, json };
}

/* Solde et Elo d'un joueur par son pseudo — l'écran Joueurs les expose. */
async function player(token, pseudo) {
  const r = await api("/api/admin/users?q=" + encodeURIComponent(pseudo) + "&limit=1", { token });
  return ((r.json && r.json.users) || [])[0] || null;
}

async function main() {
  /* ---------- 1. Seed neuf ---------- */
  for (const f of [DB, DB + "-wal", DB + "-shm"]) {
    try { fs.unlinkSync(f); } catch (e) {}
  }
  const seed = spawn(process.execPath, ["seed_oracle.js", "--db=" + DB, "--force"], { cwd: SERVER_DIR });
  const seedOut = await new Promise((resolve) => {
    let s = "";
    seed.stdout.on("data", (d) => { s += d; });
    seed.stderr.on("data", (d) => { s += d; });
    seed.on("close", (code) => resolve({ code, s }));
  });
  if (seedOut.code !== 0) {
    console.error("Seed impossible :\n" + seedOut.s);
    process.exit(2);
  }

  /* ---------- 2. Compte d'ancrage (super administrateur) ---------- */
  process.env.D_AONA_DB_PATH = DB;
  const Auth = require(path.join(SERVER_DIR, "auth"));
  const Store = require(path.join(SERVER_DIR, "admin", "store"));
  const reg = await Auth.register({
    pseudo: ADMIN_PSEUDO, password: PWD, province: "Antananarivo",
    userAgent: "scenarios", ip: "127.0.0.1",
  });
  if (!reg.ok) { console.error("Création du compte d'ancrage impossible : " + reg.error); process.exit(2); }
  Store.ensureSeed();
  Store.grantRole(reg.user.id, "super_admin", null);

  /* La connexion du script est FERMÉE avant de lancer le serveur : deux
     écrivains sur le même fichier SQLite se disputent le verrou (`database is
     locked`), et `busy_timeout` ne suffit pas quand c'est le même processus qui
     tient la transaction. Le seed et l'ancrage sont faits, on n'écrit plus. */
  try { require(path.join(SERVER_DIR, "db")).db.close(); } catch (e) {}

  /* ---------- 3. Serveur sur la base seedée ---------- */
  const srv = spawn(process.execPath, ["server.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, D_AONA_PORT: String(PORT), D_AONA_DB_PATH: DB },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let srvErr = "";
  srv.stderr.on("data", (d) => { srvErr += d; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      const r = await fetch(BASE + "/index.html");
      up = r.ok;
    } catch (e) { await sleep(250); }
  }
  if (!up) { console.error("Le serveur n'a pas démarré.\n" + srvErr); srv.kill(); process.exit(2); }

  const login = await api("/api/auth/login", { method: "POST", body: { pseudo: ADMIN_PSEUDO, password: PWD } });
  if (login.status !== 200) { console.error("Connexion impossible : " + JSON.stringify(login.json)); srv.kill(); process.exit(2); }
  const T = login.json.token;

  console.log("=== Scénarios de la référence (§11.4) — seed neuf ===\n");

  /* ---------- S1 : vérifier l'identité k1 ---------- */
  const before = await api("/api/admin/kyc?status=verified&limit=200", { token: T });
  const verifiedBefore = ((before.json && before.json.cases) || []).length;
  const s1 = await api("/api/admin/kyc/1/approve", { method: "POST", token: T, body: { reason: "Contrôle des pièces conforme." } });
  const after = await api("/api/admin/kyc?status=verified&limit=200", { token: T });
  const verifiedAfter = ((after.json && after.json.cases) || []).length;
  check("S1 — vérifier k1 : statut verified, identités vérifiées = 11",
    s1.status === 200 && verifiedBefore === 10 && verifiedAfter === 11,
    `avant ${verifiedBefore} · après ${verifiedAfter}`);

  /* ---------- S3 : refuser le retrait w2 ---------- */
  const u5Before = await player(T, "DemoTsiry");
  const s3 = await api("/api/admin/withdrawals/2/review", { method: "POST", token: T,
    body: { decision: "reject", reason: "Justificatif de transfert manquant." } });
  const u5After = await player(T, "DemoTsiry");
  const engaged = (await api("/api/admin/withdrawals?status=all&limit=200", { token: T })).json.totals.engaged;
  check("S3 — refuser w2 : statut rejected, réserve libérée, solde inchangé (31 500)",
    s3.status === 200 && s3.json.request.status === "rejected" &&
    u5After.balance === 31500 && u5Before.balance === u5After.balance && engaged === 15000,
    `solde ${u5After.balance} · engagé ${engaged}`);

  /* ---------- S6 : valider un résultat SOUS LITIGE ---------- */
  const s6 = await api("/api/admin/matches/56/result", { method: "POST", token: T,
    body: { decision: "confirm", winnerId: 8, reason: "Tentative sous litige." } });
  const u8Under = await player(T, "DemoMiora");
  check("S6 — valider sous litige : REFUS, statut disputed, Elo u8 reste 1 210",
    s6.status === 409 && s6.json.code === "LITIGE_OUVERT" && u8Under.elo === 1210,
    `code ${s6.json && s6.json.code} · elo ${u8Under.elo}`);

  /* ---------- S5 : clore d1 puis valider m-dispute ---------- */
  const s5a = await api("/api/admin/disputes/1/resolve", { method: "POST", token: T,
    body: { status: "resolved", outcome: "none",
      resolution: "Vérification faite : le résultat enregistré est confirmé." } });
  const s5b = await api("/api/admin/matches/56/result", { method: "POST", token: T,
    body: { decision: "confirm", winnerId: 8, reason: "Litige clos, résultat confirmé." } });
  const u8 = await player(T, "DemoMiora");
  const u9 = await player(T, "DemoSolo");
  const d8 = s5b.json && s5b.json.match && s5b.json.match.elo && s5b.json.match.elo["8"];
  const d9 = s5b.json && s5b.json.match && s5b.json.match.elo && s5b.json.match.elo["9"];
  check("S5 — clore d1 puis valider : u8 1 221 (+11), u9 1 094 (−11), somme nulle",
    s5a.status === 200 && s5b.status === 200 && u8.elo === 1221 && u9.elo === 1094 && (d8 + d9) === 0,
    `u8 ${u8.elo} · u9 ${u9.elo} · deltas ${d8}/${d9}`);

  /* ---------- S2 : approuver puis payer w1 ---------- */
  const s2a = await api("/api/admin/withdrawals/1/review", { method: "POST", token: T, body: { decision: "approve" } });
  const s2b = await api("/api/admin/withdrawals/1/pay", { method: "POST", token: T, body: { reference: "PAIEMENT-S2" } });
  const u2 = await player(T, "DemoRado");
  const engaged2 = (await api("/api/admin/withdrawals?status=all&limit=200", { token: T })).json.totals.engaged;
  check("S2 — approuver puis payer w1 : statut paid, u2 solde 104 000, réservé 0",
    s2a.status === 200 && s2b.status === 200 && s2b.json.request.status === "paid" &&
    u2.balance === 104000 && engaged2 === 0,
    `solde ${u2.balance} · engagé ${engaged2}`);

  /* ---------- S7 : rejouer le paiement de w1 ---------- */
  const s7 = await api("/api/admin/withdrawals/1/pay", { method: "POST", token: T, body: { reference: "PAIEMENT-S2" } });
  const u2After = await player(T, "DemoRado");
  check("S7 — rejouer le paiement : REFUS, solde u2 reste 104 000 (aucun double débit)",
    s7.status === 409 && u2After.balance === 104000,
    `code ${s7.json && s7.json.code} · solde ${u2After.balance}`);

  /* ---------- S4 : annuler le tournoi t5 ---------- */
  const s4 = await api("/api/admin/tournaments/5", { method: "POST", token: T,
    body: { action: "cancel", reason: "Annulation de démonstration." } });
  check("S4 — annuler t5 : cancelled, 4 inscriptions remboursées, 2 matchs annulés",
    s4.status === 200 && s4.json.status === "annule" && s4.json.registrations === 4 &&
    s4.json.refunded === 8000 && s4.json.matches === 2,
    `inscriptions ${s4.json && s4.json.registrations} · remboursé ${s4.json && s4.json.refunded} · matchs ${s4.json && s4.json.matches}`);

  /* ---------- S8 : désactiver le module campaigns ---------- */
  const off = await api("/api/admin/modules/campaigns", { method: "POST", token: T, body: { enabled: false } });
  const closed = await api("/api/admin/ads", { token: T });
  await api("/api/admin/modules/campaigns", { method: "POST", token: T, body: { enabled: true } });
  const back = await api("/api/admin/ads", { token: T });
  const kept = ((back.json && back.json.ads) || []).length;
  check("S8 — désactiver campaigns : module fermé, 2 campagnes CONSERVÉES",
    off.status === 200 && closed.status === 403 && closed.json.code === "MODULE_DESACTIVE" && kept === 2,
    `fermé ${closed.status} · conservées ${kept}`);

  srv.kill();
  await sleep(300);
  for (const f of [DB, DB + "-wal", DB + "-shm"]) {
    try { fs.unlinkSync(f); } catch (e) {}
  }

  console.log("\n=====================================");
  console.log(`RÉSULTAT : ${passed}/${passed + failed} scénario(s) conforme(s)`);
  if (failed) {
    console.log(`${failed} ÉCHEC(S)`);
    process.exit(1);
  }
  console.log("TOUS LES SCÉNARIOS DE LA RÉFÉRENCE PASSENT");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
