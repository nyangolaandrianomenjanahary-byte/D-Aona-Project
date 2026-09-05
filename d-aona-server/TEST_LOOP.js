"use strict";
/* =========================================================
   D-aôna — BOUCLE DE TESTS CONTINUE (/loop test et retest)
   Vérifie en boucle : REST API, WebSocket multijoueur,
   partie complète avec coups, base de données, tunnel public.
   Usage : node TEST_LOOP.js [intervalle_sec]   (défaut: 60)
   ========================================================= */
const { execSync } = require("child_process");
const http = require("http");
const path = require("path");

const DIR = __dirname;
const INTERVAL = (parseInt(process.argv[2]) || 60) * 1000;
const LOG = path.join(DIR, "test_loop.log");
const fs = require("fs");

let iteration = 0;
let passTotal = 0, failTotal = 0;

function ts() { return new Date().toLocaleTimeString("fr-FR"); }
function log(line) {
  console.log(line);
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`, "utf8");
}
function httpOk(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? require("https") : http;
    const req = mod.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
  });
}
function runTest(file, label) {
  try {
    execSync(`node "${path.join(DIR, file)}"`, { cwd: DIR, stdio: "pipe", timeout: 260000 });
    log(`  ✓ ${label}`);
    return true;
  } catch (e) {
    log(`  ✗ ${label} — ÉCHEC`);
    const out = (e.stdout || "").toString().slice(-300);
    if (out.trim()) log("    " + out.trim().split("\n").slice(-3).join("\n    "));
    return false;
  }
}

/* Détection dynamique des URLs (IP LAN + tunnel) à chaque itération */
function detectUrls() {
  const os = require("os");
  const urls = { lan: null, tunnel: null };
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.") && !i.address.startsWith("192.168.137.")) {
        urls.lan = i.address;
      }
    }
  }
  try {
    const log1 = fs.existsSync(path.join(DIR, "tunnel_err.log")) ? fs.readFileSync(path.join(DIR, "tunnel_err.log"), "utf8") : "";
    const m = [...log1.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)];
    if (m.length) urls.tunnel = m[m.length - 1][0];
  } catch (e) {}
  return urls;
}

async function oneIteration() {
  iteration++;
  log(`\n================ ITÉRATION #${iteration} — ${ts()} ================`);
  let pass = 0, fail = 0;
  const check = (ok) => { ok ? pass++ : fail++; };
  const urls = detectUrls();

  // 1. Serveur HTTP local
  const local = await httpOk("http://localhost:8080/");
  log(`  ${local ? "✓" : "✗"} Serveur HTTP localhost:8080`);
  check(local);

  // 2. Serveur via IP LAN (détectée dynamiquement)
  if (urls.lan) {
    const lan = await httpOk(`http://${urls.lan}:8080/`);
    log(`  ${lan ? "✓" : "✗"} Serveur via IP LAN (${urls.lan})`);
    check(lan);
  } else { log("  … pas d'IP LAN détectée (test sauté)"); }

  // 3. Serveur via hotspot (192.168.137.1)
  const hot = await httpOk("http://192.168.137.1:8080/");
  log(`  ${hot ? "✓" : "✗"} Serveur via hotspot (192.168.137.1)`);
  check(hot);

  // 4. Tunnel public (URL lue depuis le log cloudflared)
  if (urls.tunnel) {
    const tun = await httpOk(urls.tunnel + "/");
    log(`  ${tun ? "✓" : "✗"} Tunnel public Cloudflare (${urls.tunnel})`);
    check(tun);
  } else { log("  … pas de tunnel détecté (test sauté)"); }

  // 5. API REST complète
  check(runTest("test_api.js", "API REST (auth/user/tournois/skins/wallet)"));

  // 5bis. Règles officielles + tirage au sort pile/face (logique pure)
  check(runTest("test_toss.js", "Règles (22 pions, approche/retrait, chaînes) + tirage au sort"));

  // 6. WebSocket multijoueur
  check(runTest("test_ws.js", "WebSocket matchmaking + jeu temps réel"));

  // 7. Partie complète avec coups + DB
  check(runTest("test_full_game.js", "Partie complète (coups + captures + Elo DB)"));

  // 8. Les DEUX joueurs bougent en alternance + couleurs cohérentes (navigateur réel)
  check(runTest("../test-tools/test_turns.js", "Tours alternés des 2 joueurs (Playwright)"));
  check(runTest("../test-tools/test_colors.js", "Couleurs cohérentes des 2 côtés (Playwright)"));
  check(runTest("../test-tools/test_pov.js", "POV par joueur + aide uniquement IA (Playwright)"));

  // 9. Déconnexion ≠ abandon intempestif (délai de grâce + reconnexion)
  check(runTest("test_disconnect.js", "Grace déconnexion (pas d'abandon intempestif)"));

  passTotal += pass; failTotal += fail;
  log(`  ── Itération #${iteration} : ${pass} réussis, ${fail} échoués | TOTAL: ${passTotal}✓ / ${failTotal}✗`);

  if (fail > 0) {
    log("  ⚠ Des tests ont échoué — nouvelle tentative au prochain cycle.");
  }
}

(async () => {
  log(`\n████ BOUCLE DE TESTS D-AONA démarrée (toutes les ${INTERVAL / 1000}s) ████`);
  // Boucle infinie
  for (;;) {
    try { await oneIteration(); }
    catch (e) { log("  ERREUR itération: " + e.message); }
    log(`  Prochaine vérification dans ${INTERVAL / 1000}s… (Ctrl+C pour arrêter)`);
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
