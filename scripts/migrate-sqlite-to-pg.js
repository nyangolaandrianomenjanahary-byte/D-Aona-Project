/* =========================================================
   D-aôna — Import de la base SQLite vers Postgres / Supabase
   ---------------------------------------------------------
   Copie les données de apps/api/d-aona.db vers une base Postgres
   (Supabase), en respectant :
     · l'ORDRE des tables (clés étrangères) ;
     · les TYPES cibles (`boolean`, `timestamptz`, `date`) — sans quoi
       l'INSERT échoue sur la première colonne 0/1 ;
     · les SÉQUENCES d'identité (sans setval, le premier compte créé
       après l'import entrerait en collision avec l'id 1).

   Usage :
     node scripts/migrate-sqlite-to-pg.js                  # simulation (défaut)
     node scripts/migrate-sqlite-to-pg.js --apply           # écrit
     node scripts/migrate-sqlite-to-pg.js --apply --reset   # vide la cible d'abord

   Variables :
     DATABASE_URL   chaîne Postgres Supabase (obligatoire pour --apply)
     PGSSL=disable  pour un Postgres local sans TLS

   Dépendance : `pg` (npm i pg). Volontairement PAS d'ORM : les 452 appels SQL
   de l'application restent du SQL, l'import n'a pas à en inventer un.
   ========================================================= */
"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { FK, toPgValue } = require("./db-model-map");
const { loadConfig } = require("./db-config");

const ROOT = path.join(__dirname, "..");
const DB_PATH = process.argv.find((a) => a.startsWith("--db="))?.slice(5) || path.join(ROOT, "apps", "api", "d-aona.db");
const APPLY = process.argv.includes("--apply");
const RESET = process.argv.includes("--reset");
const BATCH = 500;

const sqlite = new DatabaseSync(DB_PATH, { readOnly: true });
const tables = sqlite
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map((r) => r.name);

/* ---------- Ordre d'insertion (dépendances de clés étrangères) ---------- */
function orderTables(names) {
  const remaining = names.slice();
  const done = new Set();
  const out = [];
  while (remaining.length) {
    let placed = false;
    for (let i = 0; i < remaining.length; i++) {
      const t = remaining[i];
      const deps = FK.filter((f) => f[0] === t && f[2] !== t).map((f) => f[2]);
      if (deps.every((d) => done.has(d) || !names.includes(d))) {
        out.push(t); done.add(t); remaining.splice(i, 1); placed = true; break;
      }
    }
    /* Cycle (users ↔ friend_requests) : l'import insère alors la table
       incomplète d'abord ; les colonnes en cause sont nullables (SET NULL),
       donc Postgres accepte la ligne, et un second passage les complète. */
    if (!placed) { const t = remaining.shift(); out.push(t); done.add(t); }
  }
  return out;
}

const ORDER = orderTables(tables);

function columnsOf(t) {
  return sqlite.prepare(`PRAGMA table_info("${t}")`).all();
}

function plan() {
  const rows = [];
  for (const t of ORDER) {
    const meta = columnsOf(t);
    const n = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    rows.push({ table: t, columns: meta.length, rows: n });
  }
  return rows;
}

/* ---------- Simulation ---------- */
if (!APPLY) {
  const p = plan();
  console.log("SIMULATION — aucune écriture. Ajoutez --apply pour importer.\n");
  console.log("Base source : " + DB_PATH);
  console.log("Ordre d'insertion (" + p.length + " tables) :\n");
  let total = 0;
  for (const r of p) {
    total += r.rows;
    console.log("  " + String(p.indexOf(r) + 1).padStart(2) + ". " + r.table.padEnd(28) + String(r.rows).padStart(6) + " ligne(s)");
  }
  console.log("\nTotal : " + total + " lignes.");
  const missing = FK.filter((f) => !tables.includes(f[0]) || !tables.includes(f[2]));
  if (missing.length) console.log("Attention : " + missing.length + " relation(s) pointent vers une table absente.");
  return;
}

/* ---------- Import réel ---------- */
const cfg = loadConfig({ requireDatabase: true });

(async () => {
  let pg;
  try { pg = require("pg"); }
  catch (e) {
    console.error("Module `pg` absent. Installez-le : npm i pg");
    process.exit(2);
  }
  const client = new pg.Client({
    connectionString: cfg.databaseUrl,
    ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  console.log("Connecté à Postgres. Source : " + DB_PATH + "\n");

  try {
    await client.query("begin");

    if (RESET) {
      const reverse = ORDER.slice().reverse();
      await client.query(`truncate table ${reverse.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
      console.log("Cible vidée (" + reverse.length + " tables).");
    }

    let imported = 0;
    for (const t of ORDER) {
      const cols = columnsOf(t);
      const names = cols.map((c) => c.name);
      const types = Object.fromEntries(cols.map((c) => [c.name, c.type]));
      const rows = sqlite.prepare(`SELECT * FROM "${t}"`).all();
      if (!rows.length) { console.log("  " + t.padEnd(28) + "0"); continue; }

      const colList = names.map((n) => `"${n}"`).join(", ");
      let done = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const values = [];
        const tuples = slice.map((row, ri) => {
          const ph = names.map((n, ci) => {
            values.push(toPgValue(t, n, row[n], types[n]));
            return "$" + (ri * names.length + ci + 1);
          });
          return "(" + ph.join(", ") + ")";
        });
        const sql = `insert into "${t}" (${colList}) values ${tuples.join(", ")} on conflict do nothing`;
        try {
          await client.query(sql, values);
          done += slice.length;
        } catch (e) {
          console.error("\nECHEC sur " + t + " (lignes " + i + ".." + (i + slice.length) + ") : " + e.message);
          throw e;
        }
      }
      imported += done;
      console.log("  " + t.padEnd(28) + String(done).padStart(6));
    }

    /* Séquences : sans ce recalage, le prochain INSERT réutilise un id existant. */
    for (const t of ORDER) {
      const idCol = columnsOf(t).find((c) => c.name === "id" && /INT/i.test(String(c.type || "")));
      if (!idCol) continue;
      await client.query(
        `select setval(pg_get_serial_sequence('"${t}"', 'id'), coalesce((select max(id) from "${t}"), 0) + 1, false)`
      );
    }
    console.log("\nSéquences recalées.");

    await client.query("commit");
    console.log("Import terminé : " + imported + " lignes.");
    console.log("Vérifiez la parité : node scripts/verify-parity.js");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("\nImport annulé (rollback). Aucune donnée partielle.");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
