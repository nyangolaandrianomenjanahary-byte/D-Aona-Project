/* =========================================================
   D-aôna — Exécuteur de migrations versionnées
   ---------------------------------------------------------
   Remplace la modification de schéma « à la main » (psql/sqlite3 ou
   ALTER TABLE dispersés dans le code) par une suite ordonnée de
   fichiers SQL versionnés, appliqués une seule fois et tracés.

   Règles appliquées :
     - chaque migration est un fichier `NNN_nom.sql` du dossier migrations/ ;
     - l'ordre est celui du numéro, jamais celui du système de fichiers ;
     - chaque migration s'applique dans SA transaction : un échec
       laisse la base exactement dans son état précédent ;
     - l'empreinte SHA-256 de chaque migration appliquée est conservée :
       réécrire une migration déjà passée est refusé (il faut en créer
       une nouvelle). Sans ce contrôle, deux environnements peuvent
       diverger silencieusement.
     - la table de suivi `schema_migrations` est la seule source de
       vérité sur l'état du schéma.

   Usage :
     node migrate.js            → applique les migrations en attente
     node migrate.js --status   → affiche l'état sans rien appliquer
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function checksum(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function ensureTracking(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum   TEXT NOT NULL
  );`);
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_[A-Za-z0-9_]+\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
}

/* Applique les migrations en attente. Renvoie la liste des versions appliquées
   pendant cet appel (tableau vide si la base est déjà à jour). */
function runMigrations(db, { verbose = false, log = console.log } = {}) {
  ensureTracking(db);
  const rows = db.prepare("SELECT version, checksum FROM schema_migrations").all();
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const done = [];

  for (const file of listMigrations()) {
    const version = file.replace(/\.sql$/i, "");
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const sum = checksum(sql);

    if (applied.has(version)) {
      if (applied.get(version) !== sum) {
        throw new Error(
          `Migration « ${version} » modifiée après son application (empreinte différente). ` +
          `N'éditez jamais une migration déjà appliquée : créez une migration 00X corrective.`
        );
      }
      if (verbose) log(`  = ${version} (déjà appliquée)`);
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)").run(version, sum);
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (_) {}
      throw new Error(`Échec de la migration « ${version} » — annulée, base inchangée : ${err.message}`);
    }
    done.push(version);
    log(`  + ${version} appliquée`);
  }
  return done;
}

/* État du schéma : appliquées / en attente. */
function migrationStatus(db) {
  ensureTracking(db);
  const applied = new Map(db.prepare("SELECT version, applied_at FROM schema_migrations").all()
    .map((r) => [r.version, r.applied_at]));
  return listMigrations().map((f) => {
    const version = f.replace(/\.sql$/i, "");
    return { version, applied: applied.has(version), applied_at: applied.get(version) || null };
  });
}

module.exports = { runMigrations, migrationStatus, listMigrations, MIGRATIONS_DIR };

/* ---------- Exécution directe en ligne de commande ---------- */
if (require.main === module) {
  const { db } = require("./db");           // requis ici : évite toute dépendance circulaire
  const statusOnly = process.argv.includes("--status");

  console.log("=== D-aôna — migrations ===");
  if (statusOnly) {
    for (const s of migrationStatus(db)) {
      console.log(`  ${s.applied ? "[appliquée]" : "[en attente]"} ${s.version}${s.applied_at ? "  (" + s.applied_at + ")" : ""}`);
    }
    process.exit(0);
  }
  const done = runMigrations(db, { verbose: true });
  console.log(done.length ? `\n✅ ${done.length} migration(s) appliquée(s).` : "\n✅ Base déjà à jour.");
}