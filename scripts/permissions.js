/* =========================================================
   D-aôna — Parité des permissions : 630 assertions (§11.6)
   ---------------------------------------------------------
   Pourquoi 630 : 7 rôles × 15 modules × 6 actions. C'est le produit cartésien
   de la matrice, et c'est ce que le cahier des charges demande de comparer.

   DEUX NIVEAUX, et ils ne mesurent pas la même chose :

   A. **630 assertions d'AUTORISATION** — pour chaque triplet, on appelle la
      barrière exacte que traverse chaque route (`authorise(userId, "m.a")`) et
      on compare à l'ORACLE. C'est la matrice elle-même, exhaustivement, sans
      avoir besoin de 90 endpoints.

   B. **Assertions HTTP** sur les couples (module, action) qui possèdent un
      endpoint. Elles prouvent que les routes branchées utilisent réellement
      cette barrière — un contrôle de matrice qui ne serait câblé nulle part
      passerait A et échouerait B.

   L'ATTENDU VIENT DU GOLDEN FILE, jamais du code testé : comparer
   `permissions.js` à lui-même ne prouverait rien.

   Usage : node scripts/permissions.js
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const SERVER_DIR = path.join(__dirname, "..", "d-aona-server");
const DB = path.join(SERVER_DIR, "_permissions.db");
const REF = path.join(__dirname, "..", "reference", "REFERENCE-DEMO.json");
const PORT = 8095;
const BASE = "http://127.0.0.1:" + PORT;
const PWD = "Scenario!2026Zz";

if (!fs.existsSync(REF)) {
  console.error("Golden file manquant : lancez `npm run ref` puis `npm run verify:seed`.");
  process.exit(2);
}
const ref = JSON.parse(fs.readFileSync(REF, "utf8"));

/* Un compte par rôle. Les pseudos doivent respecter 3–14 caractères. */
const ROLES = ["super_admin", "admin", "moderation", "finance", "tournaments", "marketing", "observer"];
const PSEUDO = {
  super_admin: "PermSuper", admin: "PermAdmin", moderation: "PermModo",
  finance: "PermFin", tournaments: "PermTour", marketing: "PermMarkt", observer: "PermObs",
};

let failed = 0;
let passed = 0;
function check(label, ok, detail = "") {
  if (ok) passed++;
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

/* ---------- Un endpoint représentatif par (module, action) ----------
   On vise des appels qui n'ont AUCUN effet de bord quand ils passent :
   identifiant inexistant (404), corps invalide (400), ou action idempotente
   (réactiver un module déjà actif). Un refus doit répondre 403 AVANT toute
   écriture — c'est précisément ce que l'assertion vérifie. */
const ENDPOINT = {
  "overview.read": () => ["GET", "/api/admin/overview"],
  "users.read": () => ["GET", "/api/admin/users?limit=1"],
  "users.edit": () => ["POST", "/api/admin/users/99999", { action: "warn", reason: "Test de permission." }],
  "kyc.read": () => ["GET", "/api/admin/kyc?status=pending&limit=1"],
  "kyc.review": () => ["POST", "/api/admin/kyc/99999/approve", { reason: "Test." }],
  "disputes.read": () => ["GET", "/api/admin/disputes?limit=1"],
  "disputes.create": () => ["POST", "/api/admin/disputes", {}],
  "disputes.review": () => ["POST", "/api/admin/disputes/99999/resolve", { status: "resolved", resolution: "Test." }],
  "games.read": () => ["GET", "/api/admin/games"],
  "games.create": () => ["POST", "/api/admin/games/zz-inexistant", { name: "Test" }],
  "games.edit": () => ["POST", "/api/admin/games/fanorona", { name: "Fanorona" }],
  "matches.read": () => ["GET", "/api/admin/matches?limit=1"],
  "matches.review": () => ["POST", "/api/admin/matches/99999/result", { decision: "confirm", reason: "Test." }],
  "tournaments.read": () => ["GET", "/api/admin/tournaments"],
  "tournaments.create": () => ["POST", "/api/admin/tournaments", {}],
  "tournaments.edit": () => ["POST", "/api/admin/tournaments/99999", { action: "update" }],
  "ranking.read": () => ["GET", "/api/admin/ranking"],
  "ranking.edit": () => ["POST", "/api/admin/badges", {}],
  "finance.read": () => ["GET", "/api/admin/finance"],
  "finance.export": () => ["GET", "/api/admin/accounting?format=csv"],
  "withdrawals.read": () => ["GET", "/api/admin/withdrawals?status=all&limit=1"],
  "withdrawals.review": () => ["POST", "/api/admin/withdrawals/99999/review", { decision: "approve" }],
  "campaigns.read": () => ["GET", "/api/admin/ads"],
  "campaigns.create": () => ["POST", "/api/admin/ads", {}],
  "campaigns.edit": () => ["POST", "/api/admin/ads/99999", { titre: "Test" }],
  "campaigns.delete": () => ["DELETE", "/api/admin/ads/99999"],
  "roles.read": () => ["GET", "/api/admin/roles"],
  "roles.edit": () => ["POST", "/api/admin/roles/observer", { changes: [] }],
  "modules.read": () => ["GET", "/api/admin/modules"],
  "modules.edit": () => ["POST", "/api/admin/modules/users", { enabled: true }],
  "audit.read": () => ["GET", "/api/admin/audit?limit=1"],
  "settings.read": () => ["GET", "/api/admin/settings"],
  "settings.edit": () => ["POST", "/api/admin/settings", { platform_name: "D-aôna" }],
};

/* Attendu, lu dans l'ORACLE. `super_admin` est protégé : tous les droits. */
function expectedFor(role, module, action) {
  if (role === "super_admin") return true;
  const granted = (ref.structure.defaultPermissions[role] || {})[module] || [];
  return granted.includes(action);
}

async function main() {
  for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch (e) {} }
  const seed = spawn(process.execPath, ["seed_oracle.js", "--db=" + DB, "--force"], { cwd: SERVER_DIR });
  const seedCode = await new Promise((resolve) => {
    let s = ""; seed.stdout.on("data", (d) => { s += d; }); seed.stderr.on("data", (d) => { s += d; });
    seed.on("close", (c) => { if (c !== 0) console.error(s); resolve(c); });
  });
  if (seedCode !== 0) process.exit(2);

  /* ---------- Sept comptes, un par rôle ---------- */
  process.env.D_AONA_DB_PATH = DB;
  const Auth = require(path.join(SERVER_DIR, "auth"));
  const Admin = require(path.join(SERVER_DIR, "admin"));
  const { db } = require(path.join(SERVER_DIR, "db"));
  Admin.Store.ensureSeed();

  const ids = {};
  for (const role of ROLES) {
    const r = await Auth.register({ pseudo: PSEUDO[role], password: PWD, province: "Antananarivo",
      userAgent: "permissions", ip: "127.0.0.1" });
    if (!r.ok) { console.error("Compte " + role + " : " + r.error); process.exit(2); }
    Admin.Store.grantRole(r.user.id, role, null);
    ids[role] = r.user.id;
  }

  /* ---------- A. 630 assertions d'autorisation ----------
     Fait AVANT le démarrage du serveur : `authorise` lit la base, et on évite
     ainsi deux écrivains sur le même fichier. */
  const modules = ref.structure.modules;
  const actions = ref.structure.actions;
  let wrong = [];
  for (const role of ROLES) {
    for (const m of modules) {
      for (const a of actions) {
        const want = expectedFor(role, m, a);
        const got = Admin.authorise(ids[role], m + "." + a).ok;
        check(`A ${role} × ${m}.${a}`, want === got, `attendu ${want ? "autorisé" : "refusé"}`);
        if (want !== got) wrong.push(`${role}×${m}.${a}`);
      }
    }
  }
  const totalA = ROLES.length * modules.length * actions.length;
  console.log(`A. autorisation          : ${totalA - wrong.length}/${totalA} conforme(s)` +
    (wrong.length ? ` — écarts : ${wrong.slice(0, 6).join(", ")}` : ""));

  /* La connexion du script est fermée : le serveur va écrire. */
  try { db.close(); } catch (e) {}

  /* ---------- B. Assertions HTTP ---------- */
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

  const tokens = {};
  for (const role of ROLES) {
    const r = await api("/api/auth/login", { method: "POST", body: { pseudo: PSEUDO[role], password: PWD } });
    if (r.status !== 200) { srv.kill(); console.error("connexion " + role + " : " + JSON.stringify(r.json)); process.exit(2); }
    tokens[role] = r.json.token;
  }

  let httpTotal = 0;
  let httpWrong = 0;
  const httpDetail = [];
  for (const role of ROLES) {
    for (const [perm, build] of Object.entries(ENDPOINT)) {
      const [m, a] = perm.split(".");
      const want = expectedFor(role, m, a);
      const [method, pathname, body] = build();
      const r = await api(pathname, { method, body, token: tokens[role] });
      httpTotal++;
      /* Autorisé → tout SAUF 401/403 (404 et 400 sont normaux : on a visé des
         identifiants inexistants). Refusé → 403 exactement. */
      const ok = want ? (r.status !== 403 && r.status !== 401) : r.status === 403;
      if (!ok) { httpWrong++; httpDetail.push(`${role} ${method} ${pathname} → ${r.status} (attendu ${want ? "non-403" : "403"})`); }
      check(`B ${role} × ${perm}`, ok, `${r.status}`);
    }
  }
  console.log(`B. endpoints réels       : ${httpTotal - httpWrong}/${httpTotal} conforme(s)` +
    (httpDetail.length ? "\n   " + httpDetail.slice(0, 8).join("\n   ") : ""));

  srv.kill();
  await sleep(300);
  for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch (e) {} }

  console.log("\n=====================================");
  console.log(`RÉSULTAT : ${passed}/${passed + failed} assertion(s) conforme(s)`);
  console.log(`  A. matrice : ${totalA - wrong.length}/${totalA}   B. endpoints : ${httpTotal - httpWrong}/${httpTotal}`);
  if (failed) { console.log(`${failed} ÉCHEC(S)`); process.exit(1); }
  console.log("PARITÉ DES PERMISSIONS ATTEINTE");
}

main().catch((e) => { console.error(e); process.exit(2); });
