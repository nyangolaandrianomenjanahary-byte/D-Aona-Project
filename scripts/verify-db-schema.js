/* =========================================================
   D-aôna — Verrou de cohérence entre les deux schémas Supabase
   ---------------------------------------------------------
   Deux fichiers décrivent la même base :

     · supabase/schema.sql                 — schéma complet, idempotent,
                                             exécuté au démarrage par le
                                             mode serverless (api/_lib/db.js) ;
     · supabase/migrations/0001_initial.sql — schéma versionné, appliqué par
                                             `supabase db push` (mode recommandé).

   Deux descriptions de la même chose finissent toujours par diverger, et
   c'est le déploiement qui le découvre. Ce script compare les INVENTAIRES
   (tables et colonnes) et échoue à la première différence.

   Usage : node scripts/verify-db-schema.js
   Sortie : 0 si identiques, 1 sinon.
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const A = path.join(ROOT, "supabase", "migrations", "0001_initial.sql");
const B = path.join(ROOT, "supabase", "schema.sql");

/* Mots qui ouvrent une contrainte et non une colonne. */
const CONSTRAINT_WORDS = /^(primary|foreign|unique|constraint|check|key)\b/i;

/* ---------- Différences INTENTIONNELLES entre les deux modes ----------
   Le mode B (tout-Vercel) n'a ni mémoire de processus ni disque : il persiste
   en base ce que le mode A garde ailleurs. Ces objets ne doivent PAS être
   recopiés dans le mode A, sinon on ajoute des tables mortes au chemin
   recommandé. Cette liste est vérifiée dans les deux sens : un objet déclaré
   ici mais absent du schéma B fait échouer le contrôle (liste périmée). */
const MODE_B_ONLY_TABLES = new Map([
  ["matchmaking_queue", "file d'appariement (le mode A la garde en mémoire)"],
  ["pending_matches", "adversaires proposés (mémoire en mode A)"],
  ["rt_events", "file d'événements temps réel (WebSocket en mode A)"],
  ["user_avatars", "photos en base (Supabase Storage en mode A)"],
]);
const MODE_B_ONLY_COLUMNS = new Map([
  ["kyc_cases", ["recto_data", "verso_data", "face_data"]],
]);


function parse(file) {
  const raw = fs.readFileSync(file, "utf8");
  /* On retire les commentaires de ligne pour ne pas lire du SQL commenté. */
  const sql = raw.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
  const tables = new Map();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1].toLowerCase();
    /* Corps de la table : jusqu'à la parenthèse fermante de premier niveau. */
    let depth = 1, i = re.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
      i++;
    }
    const body = sql.slice(re.lastIndex, i - 1);
    const cols = [];
    let level = 0, current = "";
    const parts = [];
    for (const ch of body) {
      if (ch === "(") level++;
      if (ch === ")") level--;
      if (ch === "," && level === 0) { parts.push(current); current = ""; }
      else current += ch;
    }
    parts.push(current);
    for (const part of parts) {
      const line = part.trim();
      if (!line || CONSTRAINT_WORDS.test(line)) continue;
      const cm = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
      if (cm) cols.push(cm[1].toLowerCase());
    }
    tables.set(name, cols);
  }
  return tables;
}

const ma = parse(A);
const mb = parse(B);

const label = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

let fails = 0;
const fail = (msg) => { fails++; console.log("  ECHEC  " + msg); };
const ok = (msg) => console.log("  OK     " + msg);
const note = (msg) => console.log("  NOTE   " + msg);

console.log("A = " + label(A) + "  (" + ma.size + " tables)");
console.log("B = " + label(B) + "  (" + mb.size + " tables)\n");

console.log("=== 1. Tables ===");
for (const t of [...ma.keys()].sort()) if (!mb.has(t)) fail("table « " + t + " » absente de B (" + label(B) + ")");
for (const t of [...mb.keys()].sort()) {
  if (ma.has(t)) continue;
  if (MODE_B_ONLY_TABLES.has(t)) { note("table « " + t + " » — mode B seulement : " + MODE_B_ONLY_TABLES.get(t)); continue; }
  fail("table « " + t + " » absente de A (" + label(A) + ") et non déclarée mode B");
}
/* Liste périmée : un objet déclaré mode B qui n'existe plus dans B. */
for (const t of MODE_B_ONLY_TABLES.keys()) if (!mb.has(t)) fail("liste mode B périmée : « " + t + " » n'existe plus dans " + label(B));
if (!fails) ok("les " + ma.size + " tables communes sont identiques (" + MODE_B_ONLY_TABLES.size + " objet(s) mode B déclaré(s))");

console.log("\n=== 2. Colonnes ===");
let colFails = 0;
for (const t of [...ma.keys()].sort()) {
  if (!mb.has(t)) continue;
  const ca = new Set(ma.get(t));
  const cb = new Set(mb.get(t));
  const declared = new Set(MODE_B_ONLY_COLUMNS.get(t) || []);
  const onlyA = [...ca].filter((c) => !cb.has(c));
  const onlyB = [...cb].filter((c) => !ca.has(c) && !declared.has(c));
  if (onlyA.length) { fail(t + " : colonne(s) seulement dans A → " + onlyA.join(", ")); colFails++; }
  if (onlyB.length) { fail(t + " : colonne(s) seulement dans B et non déclarées → " + onlyB.join(", ")); colFails++; }
  /* Liste périmée côté colonnes. */
  for (const c of declared) if (!cb.has(c)) { fail("liste mode B périmée : " + t + "." + c + " n'existe plus dans " + label(B)); colFails++; }
}
if (!colFails) ok("chaque table commune a les mêmes colonnes des deux côtés");

/* Les index ne sont pas comparés : leur NOM peut différer sans conséquence
   fonctionnelle. Ce qui doit être identique, c'est ce que lit et écrit le code. */
console.log("");
console.log(fails === 0
  ? "SCHÉMAS COHÉRENTS — les deux descriptions décrivent la même base."
  : fails + " DIVERGENCE(S) — corriger scripts/gen-db-model.js (mode A) ou supabase/schema.sql (mode B).");
process.exitCode = fails === 0 ? 0 : 1;
