/* =========================================================
   D-aôna — Export de l'état RÉEL, au format du golden file
   ---------------------------------------------------------
   Produit `reference/ACTUAL.json`, de MÊME FORME que
   `reference/REFERENCE-DEMO.json`, pour que `scripts/compare.js` compare des
   valeurs et non des impressions.

   Lecture seule : aucune écriture, aucune migration. Le script ouvre la base
   demandée avec `node:sqlite` en mode `readOnly`.

   Usage : node scripts/export-actual.js [--db=chemin] [--out=chemin]
   Défaut : apps/api/_oracle.db  ->  reference/ACTUAL.json
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const REF_DAY = "2026-11-02";
const FROM7 = "2026-10-27"; // 2026-11-02 moins 6 jours

const args = process.argv.slice(2);
const dbArg = args.find((a) => a.startsWith("--db="));
const outArg = args.find((a) => a.startsWith("--out="));
const DB = dbArg ? path.resolve(dbArg.slice(5))
  : path.join(__dirname, "..", "apps", "api", "_oracle.db");
const OUT = outArg ? path.resolve(outArg.slice(6))
  : path.join(__dirname, "..", "reference", "ACTUAL.json");

if (!fs.existsSync(DB)) {
  console.error("Base introuvable : " + DB + "\nLancez d'abord : node apps/api/seed_oracle.js --db=... --force");
  process.exit(2);
}
const db = new DatabaseSync(DB, { readOnly: true });

const one = (sql, ...a) => (db.prepare(sql).get(...a) || {}).c || 0;
const sum = (sql, ...a) => (db.prepare(sql).get(...a) || {}).s || 0;

/* ---------- Structure : lue depuis le catalogue du serveur ----------
   On n'écrit pas les modules à la main ici : ce serait une seconde source de
   vérité, et c'est exactement ce que la comparaison doit détecter. */
const perms = require(path.join(__dirname, "..", "apps", "api", "admin", "permissions.js"));
const structure = {
  modules: perms.ALL_MODULES.slice(),
  groups: perms.GROUPS.slice(),
  roles: Object.keys(perms.ROLES),
  actions: perms.ALL_ACTIONS.slice(),
  defaultPermissions: {},
  badgeRules: db.prepare("SELECT * FROM badges ORDER BY min_rank").all().map((b) => ({
    name: b.name, minRank: b.min_rank, maxRank: b.max_rank == null ? null : b.max_rank,
  })),
};
/* Matrice effective : rôle × module × action, telle qu'elle est EN BASE. */
for (const role of structure.roles) {
  structure.defaultPermissions[role] = {};
  for (const m of structure.modules) structure.defaultPermissions[role][m] = [];
}
for (const g of db.prepare(" SELECT role_id, module, action FROM admin_grants WHERE allowed = 1").all()) {
  if (structure.defaultPermissions[g.role_id] && structure.defaultPermissions[g.role_id][g.module]) {
    structure.defaultPermissions[g.role_id][g.module].push(g.action);
  }
}
/* `super_admin` est protégé : ses droits sont CALCULÉS, pas lus en base.
   La référence stocke `read` partout pour lui mais `can()` court-circuite ;
   on reproduit donc le calcul, sinon la comparaison signalerait un faux écart. */
structure.defaultPermissions.super_admin = {};
for (const m of structure.modules) structure.defaultPermissions.super_admin[m] = perms.MODULES[m].actions.slice();

/* ---------- Portefeuilles, dérivés du grand livre ---------- */
const balBy = new Map();
for (const r of db.prepare(
  `SELECT user_id AS u, COALESCE(SUM(CASE WHEN dir = 'in' THEN amount ELSE -amount END), 0) AS s
   FROM transactions GROUP BY user_id`).all()) balBy.set(r.u, r.s);
const resBy = new Map();
for (const r of db.prepare(
  `SELECT user_id AS u, COALESCE(SUM(amount), 0) AS s FROM withdrawals
   WHERE status IN ('pending', 'approved') GROUP BY user_id`).all()) resBy.set(r.u, r.s);

const users = db.prepare("SELECT id, pseudo, elo, wins, losses, balance, bonus_lock FROM users ORDER BY id").all();
const wallets = users.map((u) => {
  const balance = balBy.get(u.id) || 0;
  /* Réservé = bonus verrouillé + demandes en cours. La référence porte la même
     définition, répartie entre `holds` et le bonus. */
  const reserved = (u.bonus_lock || 0) + (resBy.get(u.id) || 0);
  return {
    demoId: "u" + u.id, pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses,
    balance, reserved, available: balance - reserved,
    storedBalance: u.balance,
  };
});

const badgeRows = structure.badgeRules;
const badgeOf = (rank) => {
  const b = badgeRows.find((x) => rank >= x.minRank && (x.maxRank == null || rank <= x.maxRank));
  return (b || badgeRows[badgeRows.length - 1] || {}).name || null;
};
const top5 = wallets.slice().sort((a, b) => b.elo - a.elo).slice(0, 5)
  .map((w, i) => ({ rank: i + 1, demoId: w.demoId, pseudo: w.pseudo, elo: w.elo, badge: badgeOf(i + 1) }));

const credits = sum("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE dir = 'in'");
const debits = sum("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE dir = 'out'");
const balance = wallets.reduce((s, w) => s + w.balance, 0);
const reserved = wallets.reduce((s, w) => s + w.reserved, 0);

/* ---------- Activité ---------- */
const openStatuses = ["inscriptions"];
const openTournaments = one(
  `SELECT COUNT(*) AS c FROM tournaments WHERE status IN (${openStatuses.map(() => "?").join(",")})`,
  ...openStatuses);
const openRegistrations = one(
  `SELECT COUNT(*) AS c FROM tournament_registrations r
   JOIN tournaments t ON t.id = r.tournament_id WHERE t.status IN (${openStatuses.map(() => "?").join(",")})`,
  ...openStatuses);
const kycPending = one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'pending'");
const wPending = one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'");
const dOpen = one("SELECT COUNT(*) AS c FROM disputes WHERE status IN ('open','investigating')");

const doc = {
  generatedAt: new Date().toISOString(),
  source: "base de démonstration issue de seed_oracle.js",
  db: DB,
  seed: {
    counts: {
      users: one("SELECT COUNT(*) AS c FROM users"),
      kyc: {
        pending: kycPending,
        verified: one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'verified'"),
        rejected: one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'rejected'"),
        total: one("SELECT COUNT(*) AS c FROM kyc_cases"),
      },
      withdrawals: {
        pending: wPending,
        approved: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'approved'"),
        paid: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'paid'"),
        rejected: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'rejected'"),
      },
      disputes: {
        open: one("SELECT COUNT(*) AS c FROM disputes WHERE status = 'open'"),
        investigating: one("SELECT COUNT(*) AS c FROM disputes WHERE status = 'investigating'"),
      },
      tournaments: one("SELECT COUNT(*) AS c FROM tournaments"),
      registrations: one("SELECT COUNT(*) AS c FROM tournament_registrations"),
      ledgerEntries: one("SELECT COUNT(*) AS c FROM transactions"),
      /* Une « réserve active » de la référence = un engagement encore valide :
         le bonus verrouillé et chaque demande de retrait en cours. */
      activeHolds: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status IN ('pending','approved')")
        + one("SELECT COUNT(*) AS c FROM users WHERE bonus_lock > 0"),
      matches: one("SELECT COUNT(*) AS c FROM games"),
      campaigns: one("SELECT COUNT(*) AS c FROM ads"),
    },
    totals: { balance, reserved, available: balance - reserved, credits, debits },
    wallets,
    top5,
  },
  dashboard: {
    players: one("SELECT COUNT(*) AS c FROM users"),
    gamesToday: one("SELECT COUNT(*) AS c FROM games WHERE date(created_at) = ?", REF_DAY),
    games7d: one("SELECT COUNT(*) AS c FROM games WHERE date(created_at) BETWEEN ? AND ?", FROM7, REF_DAY),
    openTournaments,
    openRegistrations,
    pendingDecisions: {
      kyc: kycPending,
      withdrawals: wPending,
      disputes: dOpen,
      total: kycPending + wPending + dOpen,
    },
  },
  structure,
  /* Les 25 commandes et leur couple (module, action), telles que la référence
     les déclare. Recopiées de `REFERENCE-DEMO.json` par le comparateur. */
  commands: {},
  invariants: [],
};

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");

/* ---------- Table de correspondance des identifiants ---------- */
const idMap = { note: "demoId -> identifiant réel, pour que la comparaison reste possible",
  users: {}, tournaments: {}, withdrawals: {}, matches: {}, kyc: {}, disputes: {}, campaigns: {}, badges: {} };
users.forEach((u) => { idMap.users["u" + u.id] = u.id; });
for (const t of db.prepare("SELECT id FROM tournaments ORDER BY id").all()) idMap.tournaments["t" + t.id] = t.id;
for (const w of db.prepare("SELECT id FROM withdrawals ORDER BY id").all()) idMap.withdrawals["w" + w.id] = w.id;
db.prepare("SELECT id FROM games ORDER BY id").all()
  .forEach((g, i) => { idMap.matches["m" + i] = g.id; });
for (const k of db.prepare("SELECT id FROM kyc_cases ORDER BY id").all()) idMap.kyc["k" + k.id] = k.id;
for (const d of db.prepare("SELECT id FROM disputes ORDER BY id").all()) idMap.disputes["d" + d.id] = d.id;
fs.writeFileSync(path.join(path.dirname(OUT), "id-map.json"), JSON.stringify(idMap, null, 2) + "\n", "utf8");

console.log("État réel exporté : " + OUT);
console.log(`  comptes ${doc.seed.counts.users} · écritures ${doc.seed.counts.ledgerEntries} · réserves ${doc.seed.counts.activeHolds}`);
console.log(`  solde ${balance} Ar · réservé ${reserved} Ar · disponible ${balance - reserved} Ar`);
console.log(`  crédits ${credits} Ar · débits ${debits} Ar`);
console.log(`  aujourd'hui ${doc.dashboard.gamesToday} · 7 j ${doc.dashboard.games7d} · décisions ${doc.dashboard.pendingDecisions.total}`);
