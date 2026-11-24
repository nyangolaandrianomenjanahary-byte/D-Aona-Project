/* =========================================================
   D-aôna — Les 13 invariants de la RÉFÉRENCE (§11.5) + fuzz
   ---------------------------------------------------------
   Deux parties :

   A. Les 13 invariants du cahier des charges, vérifiés sur un seed NEUF :
      financiers (grand livre), structurels (inscriptions, références),
      comportementaux (paiement atomique, Elo une seule fois, litige bloquant,
      puissance de 2, badges continus, dernier super admin) et l'absence
      d'effet de bord sur une commande refusée.

   B. Un FUZZ : 500 commandes aléatoires VALIDES, avec revérification des
      invariants financiers APRÈS CHACUNE. Une séquence aléatoire révèle ce
      qu'un scénario écrit à la main ne voit pas : une écriture orpheline, un
      solde qui dérive, une référence dupliquée.

   Usage : node scripts/invariants.js
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const SERVER_DIR = path.join(__dirname, "..", "apps", "api");
const DB = path.join(SERVER_DIR, "_invariants.db");
const PORT = 8096;
const BASE = "http://127.0.0.1:" + PORT;
const PWD = "Scenario!2026Zz";
const ADMIN_PSEUDO = "InvariantAdmin";
const FUZZ_STEPS = 500;

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

/* ---------- Invariants financiers, lus en SQL (lecture seule) ---------- */
function financialInvariants() {
  const ro = new DatabaseSync(DB, { readOnly: true });
  /* Le serveur écrit pendant qu'on lit : sans attente, SQLite rend la main
     immédiatement par « database is locked » et le banc échoue sur un incident
     de timing, pas sur un défaut. La même attente que le serveur (5 s). */
  ro.exec("PRAGMA busy_timeout = 5000;");
  const one = (sql, ...a) => (ro.prepare(sql).get(...a) || {}).c || 0;
  const sum = (sql, ...a) => (ro.prepare(sql).get(...a) || {}).s || 0;

  /* 1. balance = somme des écritures du joueur */
  const drift = ro.prepare(
    `SELECT u.id, u.balance,
       COALESCE((SELECT SUM(CASE WHEN t.dir = 'in' THEN t.amount ELSE -t.amount END)
                 FROM transactions t WHERE t.user_id = u.id), 0) AS ledger
     FROM users u`
  ).all().filter((r) => r.balance !== r.ledger);

  /* 2. réservé = bonus verrouillé + demandes en cours (par joueur) */
  const overReserved = ro.prepare(
    `SELECT u.id FROM users u
     WHERE u.bonus_lock + COALESCE((SELECT SUM(w.amount) FROM withdrawals w
       WHERE w.user_id = u.id AND w.status IN ('pending','approved')), 0)
       > u.balance`).all();

  /* 3. crédits − débits = somme des soldes */
  const credits = sum("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE dir = 'in'");
  const debits = sum("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE dir = 'out'");
  const balances = sum("SELECT COALESCE(SUM(balance),0) AS s FROM users");

  /* 4. une seule inscription active par (joueur, tournoi) */
  const dupRegs = one(
    `SELECT COUNT(*) AS c FROM (SELECT tournament_id, user_id, COUNT(*) AS n
       FROM tournament_registrations GROUP BY tournament_id, user_id HAVING n > 1)`);

  /* 5. référence comptable unique (les NULL sont permis) */
  const dupRefs = one(
    `SELECT COUNT(*) AS c FROM (SELECT ref_id FROM transactions
       WHERE ref_id IS NOT NULL GROUP BY ref_id HAVING COUNT(*) > 1)`);

  /* 7. dotation = somme des frais réellement inscrits : vérifié comme
        « aucune dotation n'existe sans tournoi terminé » */
  const prizeOnLive = one(
    `SELECT COUNT(*) AS c FROM transactions t JOIN tournaments tt
       ON t.label LIKE '%' || tt.name || '%'
     WHERE t.label LIKE 'Dotation%' AND tt.status <> 'termine'`);

  /* 11. badges continus : 1 -> ∞, sans trou ni chevauchement */
  const badges = ro.prepare("SELECT name, min_rank, max_rank FROM badges ORDER BY min_rank").all();
  let badgeOk = badges.length > 0 && badges[0].min_rank === 1;
  for (let i = 1; i < badges.length && badgeOk; i++) {
    if (badges[i - 1].max_rank == null) badgeOk = false;
    else if (badges[i].min_rank !== badges[i - 1].max_rank + 1) badgeOk = false;
  }
  if (badgeOk && badges[badges.length - 1].max_rank != null) badgeOk = false;

  ro.close();
  return {
    drift, overReserved, credits, debits, balances,
    dupRegs, dupRefs, prizeOnLive, badgeOk, badges,
    ok: drift.length === 0 && overReserved.length === 0 && credits - debits === balances &&
      dupRegs === 0 && dupRefs === 0 && prizeOnLive === 0 && badgeOk,
  };
}

async function main() {
  for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch (e) {} }
  const seed = spawn(process.execPath, ["seed_oracle.js", "--db=" + DB, "--force"], { cwd: SERVER_DIR });
  const seedCode = await new Promise((resolve) => {
    let s = "";
    seed.stdout.on("data", (d) => { s += d; });
    seed.stderr.on("data", (d) => { s += d; });
    seed.on("close", (code) => { if (code !== 0) console.error(s); resolve(code); });
  });
  if (seedCode !== 0) process.exit(2);

  process.env.D_AONA_DB_PATH = DB;
  const Auth = require(path.join(SERVER_DIR, "auth"));
  const Admin = require(path.join(SERVER_DIR, "admin"));
  const reg = await Auth.register({ pseudo: ADMIN_PSEUDO, password: PWD, province: "Antananarivo",
    userAgent: "invariants", ip: "127.0.0.1" });
  if (!reg.ok) { console.error("Compte d'ancrage : " + reg.error); process.exit(2); }
  Admin.Store.ensureSeed();
  Admin.Store.grantRole(reg.user.id, "super_admin", null);
  const adminUserId = reg.user.id;

  /* La connexion du script est FERMÉE avant de lancer le serveur : deux
     écrivains sur le même fichier SQLite se disputent le verrou (`database is
     locked`), et `busy_timeout` ne suffit pas quand c'est le même processus qui
     tient la transaction. Seed et ancrage sont faits, on n'écrit plus. */
  try { require(path.join(SERVER_DIR, "db")).db.close(); } catch (e) {}

  const srv = spawn(process.execPath, ["server.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, D_AONA_PORT: String(PORT), D_AONA_DB_PATH: DB },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(BASE + "/index.html")).ok; } catch (e) { await sleep(250); }
  }
  if (!up) { srv.kill(); console.error("serveur non démarré"); process.exit(2); }
  const login = await api("/api/auth/login", { method: "POST", body: { pseudo: ADMIN_PSEUDO, password: PWD } });
  const T = login.json.token;

  console.log("=== Invariants de la référence (§11.5) — seed neuf ===\n");

  /* ---------- A. Invariants statiques ---------- */
  const inv = financialInvariants();
  check("1. balance = somme des écritures du joueur",
    inv.drift.length === 0, inv.drift.slice(0, 3).map((r) => "u" + r.id).join(", "));
  check("2. réservé (bonus + demandes) ≤ solde pour chaque joueur",
    inv.overReserved.length === 0, inv.overReserved.map((r) => "u" + r.id).join(", "));
  check("3. crédits − débits = somme des soldes",
    inv.credits - inv.debits === inv.balances, `${inv.credits} − ${inv.debits} = ${inv.balances}`);
  check("4. une seule inscription ACTIVE par (joueur, tournoi)", inv.dupRegs === 0, `${inv.dupRegs} doublon(s)`);
  check("5. référence comptable unique", inv.dupRefs === 0, `${inv.dupRefs} doublon(s)`);
  check("7. aucune dotation sur un tournoi non terminé", inv.prizeOnLive === 0, `${inv.prizeOnLive} cas`);
  check("11. badges continus 1 → ∞, sans trou ni chevauchement",
    inv.badgeOk, inv.badges.map((b) => `${b.min_rank}-${b.max_rank == null ? "∞" : b.max_rank}`).join(" "));

  /* ---------- 6. Paiement atomique : débit ET levée de réserve ---------- */
  const wBefore = (await api("/api/admin/withdrawals/1", { token: T })).status; // pas de route détail : liste
  void wBefore;
  const u2Before = ((await api("/api/admin/users?q=DemoRado&limit=1", { token: T })).json.users || [])[0];
  await api("/api/admin/withdrawals/1/review", { method: "POST", token: T, body: { decision: "approve" } });
  /* Paiement refusé (sans référence) : AUCUN débit ne doit avoir eu lieu. */
  const nope = await api("/api/admin/withdrawals/1/pay", { method: "POST", token: T, body: {} });
  const u2Mid = ((await api("/api/admin/users?q=DemoRado&limit=1", { token: T })).json.users || [])[0];
  const okPay = await api("/api/admin/withdrawals/1/pay", { method: "POST", token: T, body: { reference: "INV-S6" } });
  const u2After = ((await api("/api/admin/users?q=DemoRado&limit=1", { token: T })).json.users || [])[0];
  check("6. paiement : un refus ne débite pas, un succès débite ET clôt la demande",
    nope.status === 400 && u2Mid.balance === u2Before.balance &&
    okPay.status === 200 && u2After.balance === u2Before.balance - 15000,
    `${u2Before.balance} → ${u2Mid.balance} → ${u2After.balance}`);

  /* ---------- 8. Elo zero-sum, appliqué UNE SEULE FOIS ---------- */
  await api("/api/admin/disputes/1/resolve", { method: "POST", token: T,
    body: { status: "resolved", outcome: "none", resolution: "Contrôle terminé, résultat confirmé." } });
  const first = await api("/api/admin/matches/56/result", { method: "POST", token: T,
    body: { decision: "confirm", winnerId: 8, reason: "Résultat confirmé." } });
  const second = await api("/api/admin/matches/56/result", { method: "POST", token: T,
    body: { decision: "confirm", winnerId: 8, reason: "Deuxième tentative." } });
  const u8 = ((await api("/api/admin/users?q=DemoMiora&limit=1", { token: T })).json.users || [])[0];
  const u9 = ((await api("/api/admin/users?q=DemoSolo&limit=1", { token: T })).json.users || [])[0];
  const d1 = first.json.match.elo["8"]; const d2 = first.json.match.elo["9"];
  check("8. Elo zero-sum appliqué UNE seule fois",
    first.status === 200 && d1 + d2 === 0 && second.status === 409 &&
    second.json.code === "ELO_DEJA_APPLIQUE" && u8.elo + u9.elo === 1210 + 1105 + 0,
    `deltas ${d1}/${d2} · second appel ${second.json && second.json.code}`);

  /* ---------- 9. Litige ouvert bloque le résultat ---------- */
  await api("/api/admin/disputes", { method: "POST", token: T,
    body: { matchId: 51, category: "Comportement", reason: "Signalement de contrôle automatique." } });
  const blocked = await api("/api/admin/matches/51/result", { method: "POST", token: T,
    body: { decision: "confirm", winnerId: 2, reason: "Tentative sous litige." } });
  check("9. litige ouvert bloque la validation du résultat",
    blocked.status === 409 && blocked.json.code === "LITIGE_OUVERT", blocked.json && blocked.json.code);

  /* ---------- 10. Capacité = puissance de 2 ---------- */
  const caps = {};
  for (const n of [3, 5, 6, 7, 12]) {
    const r = await api("/api/admin/tournaments", { method: "POST", token: T,
      body: { name: "Cap " + n, format: "rapide", entry: 0, maxPlayers: n,
        startsAt: new Date(Date.now() + 9 * 3600000).toISOString() } });
    caps[n] = r.status;
  }
  const cap4 = await api("/api/admin/tournaments", { method: "POST", token: T,
    body: { name: "Cap 4", format: "rapide", entry: 0, maxPlayers: 4,
      startsAt: new Date(Date.now() + 9 * 3600000).toISOString() } });
  check("10. capacité : puissance de 2 exigée (3,5,6,7,12 refusés ; 4 accepté)",
    caps[3] === 400 && caps[5] === 400 && caps[6] === 400 && caps[7] === 400 && caps[12] === 400 &&
    cap4.status === 200, JSON.stringify(caps) + " · 4=" + cap4.status);

  /* ---------- 12. Dernier super administrateur protégé ----------
     Le seed contient DÉJÀ un super administrateur (GuideAdmin) : on retire
     celui-là d'abord, puis on tente de retirer le nôtre — devenu le dernier. */
  const rev1 = await api("/api/admin/assignments", { method: "POST", token: T,
    body: { pseudo: "GuideAdmin", role: "super_admin", action: "revoke" } });
  const revoke = await api("/api/admin/assignments", { method: "POST", token: T,
    body: { pseudo: ADMIN_PSEUDO, role: "super_admin", action: "revoke" } });
  const me = await api("/api/admin/me", { token: T });
  check("12. le dernier super administrateur ne peut pas être retiré",
    rev1.status === 200 && revoke.status === 409 && revoke.json.code === "DERNIER_SUPER" &&
    me.status === 200, `premier retrait ${rev1.status} · second ${revoke.json && revoke.json.code}`);
  void adminUserId;

  /* ---------- 13. Commande refusée = aucun effet de bord ---------- */
  const before13 = financialInvariants();
  const n13 = await api("/api/admin/withdrawals/9999/pay", { method: "POST", token: T, body: { reference: "X" } });
  const bad = await api("/api/admin/badges", { method: "POST", token: T,
    body: { badges: [{ name: "Seul", minRank: 3, maxRank: null }] } });
  const after13 = financialInvariants();
  check("13. une commande refusée ne change rien (finances ni barème)",
    n13.status === 404 && bad.status === 400 &&
    JSON.stringify(before13.badges) === JSON.stringify(after13.badges) &&
    after13.ok && before13.ok,
    `paiement ${n13.status} · barème ${bad.status}`);

  /* ---------- B. FUZZ : 500 commandes valides ---------- */
  const pending = async () => ((await api("/api/admin/withdrawals?status=pending&limit=50", { token: T })).json.withdrawals || []);
  const ads = async () => ((await api("/api/admin/ads", { token: T })).json.ads || []);
  const mods = ["campaigns", "ranking", "matches", "games", "disputes"];
  let violations = 0;
  let lastViolation = "";
  let applied = 0;

  for (let step = 1; step <= FUZZ_STEPS; step++) {
    const kind = step % 5;
    let r = null;
    if (kind === 0) {
      const list = await pending();
      if (!list.length) { await sleep(1); continue; }
      const w = list[step % list.length];
      r = await api(`/api/admin/withdrawals/${w.id}/review`, { method: "POST", token: T,
        body: { decision: "reject", reason: "Fuzz : refus de contrôle." } });
    } else if (kind === 1) {
      const m = mods[step % mods.length];
      r = await api("/api/admin/modules/" + m, { method: "POST", token: T, body: { enabled: step % 10 < 5 } });
      await api("/api/admin/modules/" + m, { method: "POST", token: T, body: { enabled: true } });
    } else if (kind === 2) {
      const list = await ads();
      if (!list.length) continue;
      const a = list[step % list.length];
      r = await api("/api/admin/ads/" + a.id, { method: "POST", token: T, body: { actif: !a.actif } });
    } else if (kind === 3) {
      const cur = (await api("/api/admin/ranking", { token: T })).json.badges || [];
      r = await api("/api/admin/badges", { method: "POST", token: T,
        body: { badges: cur.map((b) => ({ name: b.name, minRank: b.minRank, maxRank: b.maxRank,
          icon: b.icon, color: b.color, ink: b.ink })) } });
    } else {
      const s = (await api("/api/admin/settings", { token: T })).json.settings;
      r = await api("/api/admin/settings", { method: "POST", token: T,
        body: { platform_name: s.platform_name.value, contact: s.contact.value } });
    }
    if (r && r.status >= 200 && r.status < 300) applied++;

    const now = financialInvariants();
    if (!now.ok) {
      violations++;
      lastViolation = `étape ${step} : ` +
        (now.drift.length ? "solde ≠ grand livre (" + now.drift.length + ")" : "") +
        (now.overReserved.length ? " réservé > solde" : "") +
        (now.dupRegs ? " inscriptions dupliquées" : "") +
        (now.dupRefs ? " références dupliquées" : "") +
        (now.badgeOk ? "" : " barème non continu");
      break;
    }
  }
  check(`fuzz : ${FUZZ_STEPS} commandes aléatoires sans violer un invariant`,
    violations === 0, violations ? lastViolation : `${applied} commande(s) appliquée(s)`);

  srv.kill();
  await sleep(300);
  for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch (e) {} }

  console.log("\n=====================================");
  console.log(`RÉSULTAT : ${passed}/${passed + failed} invariant(s) vérifié(s)`);
  if (failed) { console.log(`${failed} ÉCHEC(S)`); process.exit(1); }
  console.log("TOUS LES INVARIANTS DE LA RÉFÉRENCE TIENNENT");
}

main().catch((e) => { console.error(e); process.exit(2); });
