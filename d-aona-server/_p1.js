/* =========================================================================
   D-aôna — CAMPAGNE DE TESTS SCÉNARIOS (interface réelle, navigateur)
   -------------------------------------------------------------------------
   Chaque scénario reproduit le geste d'un VRAI joueur dans un navigateur
   (clic, saisie, route) contre une instance jetable du serveur. Aucune
   écriture dans la base réelle : elle est copiée (VACUUM INTO) puis
   l'instance de test travaille sur la copie, supprimée en fin de campagne.

   Usage :  node test_ui_scenarios.js          (campagne complète)
            node test_ui_scenarios.js S6       (un seul scénario)
   Sortie : rapport lisible + code de sortie 1 si échec.
   Navigateur : Microsoft Edge ou Chrome installé (aucun téléchargement).
   ========================================================================= */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("playwright");
const game = require("./game.js");

const PORT = Number(process.env.D_AONA_TEST_PORT || 8098);
const BASE = `http://127.0.0.1:${PORT}`;
const REAL_DB = path.join(__dirname, "d-aona.db");
const PWD = "Scenario!2026Zz";
const ONLY = (process.argv[2] || "").toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (n) => Math.floor(Math.random() * 900000 + 100000) + n;

/* ---------- Copie jetable de la base (source ouverte en lecture seule) ---------- */
let tmpDir = null;
function snapshotDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daona-ui-"));
  const dest = path.join(tmpDir, "d-aona.db");
  const src = new DatabaseSync(REAL_DB, { readOnly: true });
  src.exec(`VACUUM INTO '${dest.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  src.close();
  return dest;
}

/* ---------- Instance jetable du serveur, sur la copie ---------- */
function startServer(dbPath) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, D_AONA_PORT: String(PORT), D_AONA_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitServer(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(BASE + "/api/user"); if (r.status) return true; } catch (e) {}
    await sleep(250);
  }
  throw new Error("le serveur de test n'a pas démarré sur le port " + PORT);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill(); } catch (e) { clearTimeout(t); resolve(); }
  });
}

function cleanup() {
  try { if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
}

/* ---------- Préparation de la copie jetable ----------
   La base réelle ne contient que des tournois dont l'heure de début est déjà
   passée (leur statut reste pourtant « inscriptions »). Pour pouvoir tester
   l'inscription côté interface, on ajoute — sur la COPIE uniquement — un
   tournoi réellement ouvert (début dans 30 minutes, rang Bronze, mise 1 000). */
const TID_UI = 9101;
function prepareFixture(dbPath) {
  const d = new DatabaseSync(dbPath);
  d.prepare("DELETE FROM tournament_matches WHERE tournament_id = ?").run(TID_UI);
  d.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ?").run(TID_UI);
  d.prepare("DELETE FROM tournaments WHERE id = ?").run(TID_UI);
  d.prepare(`INSERT INTO tournaments
      (id,name,game,format,entry,max_players,status,min_rank,sponsor,starts_at,results_json,match_duration_min,interval_min)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    TID_UI, "Tournoi UI — Scénarios", "Fanorona", "blitz", 1000, 8, "inscriptions", "Bronze", null,
    new Date(Date.now() + 30 * 60000).toISOString(), null, 5, 5);
  d.close();
}
