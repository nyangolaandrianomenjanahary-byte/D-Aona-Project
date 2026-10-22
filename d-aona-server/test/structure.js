"use strict";
/* Garde-fou structurel : empeche le retour du mono-fichier et des jeux
   incomplets. Bloque (code 1) si un dossier de jeu n est pas conforme ;
   signale sans bloquer la dette de taille connue (PLAN-REFONTE.md). */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const WEB_GAMES = path.join(ROOT, "D-aona", "d-aona-web", "games");
const SRV_GAMES = path.join(__dirname, "..", "games");

const WEB_REQUIRED = ["manifest.json", "engine.js", "ai.js", "board.js", "ui.js", "README.md", "test.js"];
const SRV_REQUIRED = ["manifest.json", "engine.js", "session.js", "index.js"];
const MANIFEST_KEYS = ["id", "family", "name", "board", "players", "phases", "captures", "eloKey", "formats"];
const MAX_LINES = 400;

let checks = 0, fails = 0;
const debt = [];

function check(name, ok, detail) {
  checks++;
  if (!ok) fails++;
  console.log((ok ? "  OK    " : "  ECHEC ") + name + (detail ? "   -> " + detail : ""));
}
function section(t) { console.log("\n=== " + t + " ==="); }
function dirs(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
function lines(f) { return fs.readFileSync(f, "utf8").split(/\r?\n/).length; }

section("Dossiers de jeu cote interface");
const web = dirs(WEB_GAMES);
check("au moins un dossier de jeu", web.length >= 1, web.join(", "));
for (const slug of web) {
  const dir = path.join(WEB_GAMES, slug);
  const missing = WEB_REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  check(slug + " : les 7 fichiers du contrat", missing.length === 0, missing.length ? "manque " + missing.join(", ") : "");
  const mf = path.join(dir, "manifest.json");
  if (!fs.existsSync(mf)) continue;
  let m = null;
  try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch (e) { check(slug + " : manifest.json lisible", false, e.message); continue; }
  const miss = MANIFEST_KEYS.filter((k) => m[k] === undefined);
  check(slug + " : cles du manifeste", miss.length === 0, miss.join(", "));
  check(slug + " : identite coherente", m.id === slug && m.eloKey === slug, "id=" + m.id + " eloKey=" + m.eloKey);
  check(slug + " : plateau decrit", !!(m.board && m.board.rows > 0 && m.board.cols > 0), JSON.stringify(m.board));
  for (const f of WEB_REQUIRED) {
    const fp = path.join(dir, f);
    if (!f.endsWith(".js") || !fs.existsSync(fp)) continue;
    const n = lines(fp);
    if (n <= MAX_LINES) continue;
    /* Un harnais n est pas du code de production : sa taille suit le nombre
       de verifications. Signale, mais ne bloque pas. */
    if (f === "test.js") debt.push(slug + "/test.js : " + n + " lignes (harnais)");
    else check(slug + "/" + f + " : moins de " + MAX_LINES + " lignes", false, n + " lignes");
  }
}

section("Dossiers de jeu cote moteur");
for (const slug of dirs(SRV_GAMES)) {
  const dir = path.join(SRV_GAMES, slug);
  const missing = SRV_REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  check(slug + " : moteur complet", missing.length === 0, missing.join(", "));
  const absent = WEB_REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (absent.length) debt.push("d-aona-server/games/" + slug + " : encore sans " + absent.join(", "));
}

section("Socle");
const facade = path.join(__dirname, "..", "game.js");
check("game.js reste une facade de moins de 40 lignes", lines(facade) < 40, lines(facade) + " lignes");
const srv = path.join(__dirname, "..", "server.js");
if (lines(srv) > 250) debt.push("server.js : " + lines(srv) + " lignes (objectif < 250)");
const shell = path.join(ROOT, "D-aona", "d-aona-web", "index.html");
if (fs.existsSync(shell) && lines(shell) > 200) debt.push("index.html : " + lines(shell) + " lignes (objectif < 200)");

if (debt.length) {
  console.log("\nDETTE CONNUE (non bloquante, ordre de traitement dans PLAN-REFONTE.md) :");
  for (const d of debt) console.log("  - " + d);
}
console.log(fails === 0 ? "\nRESULTAT : TOUS LES TESTS PASSENT" : "\nRESULTAT : " + fails + " ECHEC(S)");
process.exit(fails === 0 ? 0 : 1);