/* =========================================================
   D-aôna — Sauvegarde VÉRIFIÉE de la base et des fichiers
   ---------------------------------------------------------
   Produit un snapshot cohérent à chaud (VACUUM INTO), copie le
   dossier uploads/, calcule les empreintes SHA-256, puis RE-OUVRE
   la sauvegarde pour contrôler son intégrité (PRAGMA integrity_check)
   et comparer le nombre de lignes de chaque table avec la source.

   Aucune écriture sur la base source : lecture seule + fichier neuf.

   Usage :  node backup_db.js
   Sortie : backups/<horodatage>/  (d-aona.db, uploads/, MANIFEST.txt)
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "d-aona.db");
const UPLOADS = path.join(__dirname, "uploads");
const BACKUPS = path.join(__dirname, "backups");

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listTables(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((r) => r.name);
}

function countAll(db) {
  const out = {};
  for (const t of listTables(db)) out[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
  return out;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("❌ Base introuvable : " + DB_PATH);
    process.exit(1);
  }

  const dir = path.join(BACKUPS, stamp());
  fs.mkdirSync(dir, { recursive: true });
  const destDb = path.join(dir, "d-aona.db");
  const lines = [];

  // ---------- 1. Snapshot cohérent de la base (à chaud) ----------
  const src = new DatabaseSync(DB_PATH);           // connexion normale (nécessaire pour VACUUM INTO)
  const srcCounts = countAll(src);
  const srcIntegrity = src.prepare("PRAGMA integrity_check").get();
  const srcIntegrityVal = Object.values(srcIntegrity)[0];
  src.exec(`VACUUM INTO '${destDb.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  src.close();

  // ---------- 2. Copie des fichiers uploadés (photos de profil) ----------
  let uploadCount = 0;
  if (fs.existsSync(UPLOADS)) {
    fs.cpSync(UPLOADS, path.join(dir, "uploads"), { recursive: true });
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    uploadCount = walk(path.join(dir, "uploads")).length;
  }

  // ---------- 3. Vérification : la sauvegarde est-elle lisible et identique ? ----------
  const bak = new DatabaseSync(destDb, { readOnly: true });
  const bakIntegrityVal = Object.values(bak.prepare("PRAGMA integrity_check").get())[0];
  const bakCounts = countAll(bak);
  bak.close();

  const diff = [];
  for (const t of new Set([...Object.keys(srcCounts), ...Object.keys(bakCounts)])) {
    if (srcCounts[t] !== bakCounts[t]) diff.push(`${t}: source=${srcCounts[t]} sauvegarde=${bakCounts[t]}`);
  }

  // ---------- 4. Manifeste ----------
  lines.push("D-aôna — MANIFESTE DE SAUVEGARDE");
  lines.push("=================================");
  lines.push("Date           : " + new Date().toISOString());
  lines.push("Dossier        : " + dir);
  lines.push("Base source    : " + DB_PATH);
  lines.push("");
  lines.push("--- Empreintes SHA-256 ---");
  lines.push(`d-aona.db                                     ${sha256(destDb)}`);
  lines.push(`taille d-aona.db (source)                     ${fs.statSync(DB_PATH).size} octets`);
  lines.push(`taille d-aona.db (sauvegarde)                 ${fs.statSync(destDb).size} octets`);
  lines.push(`uploads/ : ${uploadCount} fichier(s) copié(s)`);
  lines.push("");
  lines.push("--- Intégrité ---");
  lines.push(`PRAGMA integrity_check (source)     : ${srcIntegrityVal}`);
  lines.push(`PRAGMA integrity_check (sauvegarde) : ${bakIntegrityVal}`);
  lines.push("");
  lines.push("--- Lignes par table (source vs sauvegarde) ---");
  for (const t of Object.keys(bakCounts).sort()) {
    const same = srcCounts[t] === bakCounts[t];
    lines.push(`  ${same ? "OK " : "KO "} ${t.padEnd(26)} ${String(bakCounts[t]).padStart(6)}`);
  }
  lines.push("");
  lines.push(`RÉSULTAT : ${diff.length === 0 && bakIntegrityVal === "ok" ? "✅ SAUVEGARDE VÉRIFIÉE ET CONFORME" : " ÉCART DÉTECTÉ — NE PAS SUPPRIMER LA BASE SOURCE"}`);
  if (diff.length) lines.push("Écarts : " + diff.join(" | "));

  const manifest = lines.join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "MANIFEST.txt"), manifest, "utf8");
  console.log(manifest);
}

main();