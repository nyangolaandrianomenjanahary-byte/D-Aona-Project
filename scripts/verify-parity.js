/* =========================================================
   D-aôna — Parité entre la base SQLite et Postgres / Supabase
   ---------------------------------------------------------
   Prouve que l'import n'a RIEN perdu et n'a RIEN inventé. Contrôle :
     1. le nombre de lignes, table par table ;
     2. les sommes d'argent (solde, grand livre, retraits) ;
     3. les orphelins de clés étrangères, sur LES DEUX bases ;
     4. les séquences d'identité (le prochain INSERT ne doit pas
        réutiliser un identifiant existant).

   Usage :
     node scripts/verify-parity.js
     DATABASE_URL=postgres://... node scripts/verify-parity.js

   Sortie : 0 si parité, 1 sinon. À exécuter AVANT de basculer le
   backend sur Postgres — c'est la porte G6 du plan.
   ========================================================= */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const { FK } = require("./db-model-map");
const { loadConfig } = require("./db-config");

const cfg = loadConfig({ requireDatabase: true });
const sqlite = new DatabaseSync(cfg.sqlitePath, { readOnly: true });

const tables = sqlite
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map((r) => r.name);

let failures = 0;
const fail = (msg) => { failures++; console.log("  ECHEC  " + msg); };
const ok = (msg) => console.log("  OK     " + msg);
const note = (msg) => console.log("  NOTE   " + msg);

/* Les colonnes d'argent : comparées en somme ET en signe, jamais en flottant
   (l'ariary est un entier : un arrondi masquerait un décalage). */
const MONEY = [
  { label: "solde des comptes", table: "users", col: "balance" },
  { label: "grand livre", table: "transactions", col: "amount" },
  { label: "retraits", table: "withdrawals", col: "amount" },
  { label: "mises engagées", table: "challenges", col: "wager" },
  { label: "mises jouées", table: "games", col: "wager" },
];

(async () => {
  let pg;
  try { pg = require("pg"); } catch (e) { console.error("Module `pg` absent : npm i pg"); process.exit(2); }

  const client = new pg.Client({
    connectionString: cfg.databaseUrl,
    ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  console.log("Source SQLite   : " + cfg.sqlitePath);
  console.log("Cible  Postgres : " + cfg.databaseUrl.replace(/:\/\/[^@]*@/, "://***@") + "\n");

  try {
    /* ---------- 1. Nombre de lignes ---------- */
    console.log("=== 1. Nombre de lignes ===");
    let totalS = 0, totalP = 0;
    for (const t of tables) {
      const s = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
      let p = -1;
      try { p = Number((await client.query(`select count(*)::int as c from "${t}"`)).rows[0].c); }
      catch (e) { fail(t + " : table absente de Postgres (" + e.message.slice(0, 60) + ")"); continue; }
      totalS += s; totalP += p;
      if (s === p) ok(t + " : " + s + " ligne(s)");
      else fail(t + " : SQLite " + s + " ≠ Postgres " + p);
    }
    console.log("  ---- total : SQLite " + totalS + " / Postgres " + totalP);

    /* ---------- 2. Argent ---------- */
    console.log("\n=== 2. Sommes d'argent (ariary, entiers) ===");
    for (const m of MONEY) {
      let s = 0, p = 0;
      try { s = Number(sqlite.prepare(`SELECT COALESCE(SUM("${m.col}"),0) AS v FROM "${m.table}"`).get().v) || 0; } catch (e) { note(m.table + "." + m.col + " absente côté SQLite"); continue; }
      try { p = Number((await client.query(`select coalesce(sum("${m.col}"),0)::bigint as v from "${m.table}"`)).rows[0].v) || 0; } catch (e) { fail(m.table + "." + m.col + " absente côté Postgres"); continue; }
      if (s === p) ok(m.label + " : " + s + " Ar");
      else fail(m.label + " : SQLite " + s + " Ar ≠ Postgres " + p + " Ar (écart " + (s - p) + ")");
    }

    /* ---------- 3. Orphelins ---------- */
    console.log("\n=== 3. Orphelins de clés étrangères ===");
    let orphanFail = 0;
    for (const [t, from, refTable, refCol] of FK) {
      if (!tables.includes(t) || !tables.includes(refTable)) continue;
      const q = `SELECT COUNT(*) AS c FROM "${t}" c WHERE c."${from}" IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM "${refTable}" p WHERE p."${refCol}" = c."${from}")`;
      const s = sqlite.prepare(q).get().c;
      const p = Number((await client.query(q)).rows[0].c);
      if (s === 0 && p === 0) continue;
      if (s === p) note(t + "." + from + " : " + s + " orphelin(s) des deux côtés (identique)");
      else { fail(t + "." + from + " : SQLite " + s + " ≠ Postgres " + p + " orphelin(s)"); orphanFail++; }
    }
    if (!orphanFail) ok("aucun écart d'orphelins entre les deux bases");

    /* ---------- 4. Séquences ---------- */
    console.log("\n=== 4. Séquences d'identité ===");
    for (const t of tables) {
      const cols = sqlite.prepare(`PRAGMA table_info("${t}")`).all();
      const idCol = cols.find((c) => c.name === "id" && /INT/i.test(String(c.type || "")));
      if (!idCol) continue;
      const r = await client.query(
        `select coalesce((select max(id) from "${t}"),0)::bigint as max_id,
                coalesce((select last_value from "${t}_id_seq"),0)::bigint as seq`
      ).catch(() => ({ rows: [{ max_id: -1, seq: -1 }] }));
      const { max_id, seq } = r.rows[0];
      if (max_id < 0) { fail(t + " : séquence absente alors que la colonne id existe"); continue; }
      if (Number(seq) < Number(max_id)) fail(t + " : séquence " + seq + " < max(id) " + max_id + " (collision au prochain INSERT)");
      else ok(t + " : séquence " + seq + " ≥ max(id) " + max_id);
    }
  } finally {
    await client.end();
  }

  console.log("\n" + (failures === 0 ? "PARITÉ VÉRIFIÉE — aucune différence." : failures + " ÉCART(S) — ne pas basculer la production."));
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => { console.error("Parité impossible : " + e.message); process.exit(1); });
