#!/usr/bin/env node
/* =========================================================
   update_log.js — Mise à jour automatique du journal technique
   D-aôna (CONTEXTE_PROJET.md, section « Journal des changements »)

   Rôle :
   1. Inventaire de la STRUCTURE du logiciel (fichiers + taille + date + empreinte)
      en EXCLUANT les données clients (bases *.db, *.log, node_modules, skills, etc.)
   2. Diff avec l'état précédent (maj_state.json) → fichiers modifiés/ajoutés/supprimés
   3. Insertion d'une entrée horodatée dans la section journal (entre les marqueurs)

   Aucune lecture ni écriture de données clients : uniquement du code / fichiers.
   Usage : node update_log.js
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DOC = path.join(ROOT, "CONTEXTE_PROJET.md");
const STATE = path.join(ROOT, "maj_state.json");

const MARK_START = "<!-- JOURNAL_AUTO_START -->";
const MARK_END = "<!-- JOURNAL_AUTO_END -->";

/* ---------- Exclusions ---------- */
const SKIP_DIRS = ["node_modules", ".git", ".claude", ".agents", "agent", ".vscode"];
const SKIP_EXT = [".log", ".db", ".exe", ".sqlite"];
const SKIP_NAME = ["maj_state.json", "CONTEXTE_PROJET.md", "update_log.js"];

/* Seuil : fichiers >= 1 Mo → pas d'empreinte (perf), on se fie à taille+date */
const HASH_LIMIT = 1 * 1024 * 1024;

function hashFile(file) {
  return new Promise((resolve) => {
    try {
      const h = crypto.createHash("sha256");
      const s = fs.createReadStream(file);
      s.on("error", () => resolve(null));
      s.on("data", (d) => h.update(d));
      s.on("end", () => resolve(h.digest("hex")));
    } catch { resolve(null); }
  });
}

function today() { return new Date().toISOString().slice(0, 10); }

/* ---------- Scan récursif ---------- */
// Le root couvre tout ; les dossiers exclus sont listés dans SKIP_DIRS.
const WALK = [ROOT];

async function snapshot() {
  const map = {};
  const pending = [];
  walk(ROOT, map, "", pending);
  await Promise.all(pending);
  return map;
}

function walk(dir, map, base, pending) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.includes(e.name)) continue;
      walk(full, map, base, pending);
      continue;
    }
    const name = e.name;
    const ext = path.extname(name).toLowerCase();
    if (SKIP_NAME.includes(name)) continue;
    if (SKIP_EXT.includes(ext)) continue;
    if (ext === ".txt" && (name.includes("result") || name.includes("_out") || name.includes("_err"))) continue;
    const r = base + name;
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    map[r] = { s: st.size, m: st.mtimeMs };
    if (st.size < HASH_LIMIT) {
      pending.push(hashFile(full).then((h) => { map[r].h = h; }));
    } else {
      map[r].h = null;
    }
  }
}

/* ---------- Diff ---------- */
function diff(prev, next) {
  const added = [], mod = [], del = [];
  for (const f of Object.keys(next)) {
    if (!prev[f]) { added.push(f); continue; }
    const a = prev[f], b = next[f];
    const same = a.s === b.s && a.m === b.m && (a.h === b.h || (b.h === null && a.h === null));
    if (!same) mod.push(f);
  }
  for (const f of Object.keys(prev)) if (!next[f]) del.push(f);
  return { added, mod, del };
}

/* ---------- Écriture du journal ---------- */
// Fusionne les changements du même jour dans UNE seule section.
function updateDoc(date, linesText) {
  let doc;
  try { doc = fs.readFileSync(DOC, "utf8"); } catch { doc = ""; }
  const iStart = doc.indexOf(MARK_START);
  const iEnd = doc.indexOf(MARK_END);
  if (iStart < 0 || iEnd < 0 || iEnd <= iStart) {
    console.error("Marqueurs de journal introuvables dans " + DOC);
    return;
  }
  const innerTop = iStart + MARK_START.length;
  const header = "## " + date;
  const body = linesText.trimEnd() + "\n";

  // Le jour existe déjà dans le journal ?
  const idx = doc.indexOf(header, innerTop);
  if (idx !== -1 && idx < iEnd) {
    // Trouver la fin de la section de ce jour (prochain en-tête "## " ou fin du bloc)
    const afterHeader = idx + header.length;
    const rest = doc.slice(afterHeader, iEnd);
    const nxt = rest.search(/\n## /); // position relative
    const insertPos = nxt === -1 ? iEnd : afterHeader + nxt;
    const newDoc = doc.slice(0, insertPos) + body + doc.slice(insertPos);
    fs.writeFileSync(DOC, newDoc);
    return;
  }

  // Nouveau jour → insérer en tête (le plus récent en premier)
  const newDoc = doc.slice(0, innerTop) + "\n" + header + "\n" + body + doc.slice(innerTop);
  fs.writeFileSync(DOC, newDoc);
}

(async () => {
  const next = await snapshot();
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(STATE, "utf8")).snapshot || {}; } catch {}
  const firstRun = Object.keys(prev).length === 0;
  const date = today();

  if (firstRun) {
    // 1er scan : enregistre la baseline (pas de liste interminable d'« ajoutés »).
    updateDoc(date, "Snapshot initial : " + Object.keys(next).length + " fichiers suivis. **Baseline enregistrée.**");
    fs.writeFileSync(STATE, JSON.stringify({ last_run: date, snapshot: next }, null, 0));
    console.log("✅ Baseline initiale enregistrée (" + date + ") — " + Object.keys(next).length + " fichiers suivis.");
    return;
  }

  const d = diff(prev, next);

  const lines = [];
  if (d.mod.length) lines.push("**Modifiés :** " + d.mod.map((f) => "`" + f + "`").join(", "));
  if (d.added.length) lines.push("**Ajoutés :** " + d.added.map((f) => "`" + f + "`").join(", "));
  if (d.del.length) lines.push("**Supprimés :** " + d.del.map((f) => "`" + f + "`").join(", "));

  const changed = d.mod.length + d.added.length + d.del.length;
  if (changed > 0) {
    updateDoc(date, lines.join("\n"));
    console.log("✅ Journal mis à jour (" + date + ") : " + changed + " changement(s) — "
      + d.added.length + " ajouté(s), " + d.mod.length + " modifié(s), " + d.del.length + " supprimé(s).");
  } else {
    console.log("ℹ️ Aucun changement détecté (" + date + ").");
  }

  fs.writeFileSync(STATE, JSON.stringify({ last_run: date, snapshot: next }, null, 0));
})();
