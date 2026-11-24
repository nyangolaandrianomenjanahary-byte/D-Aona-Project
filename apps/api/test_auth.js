/* =========================================================
   D-aôna — Tests automatisés de l'authentification
   ---------------------------------------------------------
   Vérifie de bout en bout, sur une instance de serveur jetable :
     - que l'ancien trou (« pseudo seul ») est bien fermé ;
     - l'inscription, la connexion, la déconnexion, la révocation ;
     - le stockage : Argon2id, aucun mot de passe ni jeton en clair ;
     - le verrouillage après échecs répétés et la limitation de débit ;
     - l'ajout seul du journal d'audit ;
     - l'authentification WebSocket.

   Le serveur de test écoute sur le port 8099 et utilise LA MÊME base que
   le serveur réel. Les seuls comptes touchés sont ceux créés ici, sous le
   préfixe ZzT… ; ils sont supprimés à la fin. Aucun compte existant n'est
   modifié ni supprimé.

   Usage :  node test_auth.js
   ========================================================= */
"use strict";

const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const { db } = require("./db");

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const PREFIX = "ZzT";
const PWD_OK = "MotDePasse!2026";
const PWD_WEAK = "faible";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK   " : "ECHEC"} ${name}${detail ? "   -> " + detail : ""}`);
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- Client HTTP minimal ---------- */
async function api(path, { method = "GET", body = null, token = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* réponse non JSON */ }
  return { status: res.status, json };
}

/* ---------- Instance de serveur jetable ---------- */
function startServer(env = {}) {
  return spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, D_AONA_PORT: String(PORT), ...env },
    stdio: "ignore",
  });
}

async function waitServer(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + "/api/user");   // 401 attendu : le serveur répond
      if (r.status) return true;
    } catch (e) { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("le serveur de test n'a pas démarré sur le port " + PORT);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} resolve(); }, 2500);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill(); } catch (e) { clearTimeout(t); resolve(); }
  });
}

/* ---------- Sonde WebSocket ----------
   Authentifié -> le serveur répond {type:"matchmaking"}.
   Jeton refusé -> le serveur répond {type:"error"}. */
function wsProbe(token) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.close(); } catch (e) {} resolve(v); } };
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "auth", token }));
      setTimeout(() => socket.send(JSON.stringify({ type: "find_match", format: "blitz", mode: "online" })), 150);
    });
    socket.on("message", (d) => {
      let m = null;
      try { m = JSON.parse(d.toString()); } catch (e) { return; }
      if (m.type === "error") finish({ ok: false, message: m.message });
      else if (m.type === "matchmaking" || m.type === "match_found") finish({ ok: true });
    });
    socket.on("error", () => finish({ ok: false, message: "erreur de connexion" }));
    setTimeout(() => finish({ ok: false, message: "délai dépassé" }), 6000);
  });
}

/* ---------- Nettoyage : uniquement les comptes créés par ce test ---------- */
function cleanup() {
  const rows = db.prepare("SELECT id, pseudo FROM users WHERE pseudo LIKE ?").all(PREFIX + "%");
  for (const r of rows) {
    // ON DELETE CASCADE (clés étrangères activées) supprime auth_credentials
    // et sessions. auth_audit_log est en ajout seul : ses lignes restent,
    // ce qui est exactement le comportement attendu d'un journal d'audit.
    db.prepare("DELETE FROM users WHERE id = ?").run(r.id);
  }
  return rows.length;
}

/* =========================================================
   Phase 1 — Ancien trou fermé, inscription, connexion, sessions
   ========================================================= */
async function phaseFonctionnel() {
  const pseudo = PREFIX + "Compte1";

  section("1. L'ancien mecanisme « pseudo seul » est bien ferme");
  const legacy = await api("/api/auth", { method: "POST", body: { pseudo: PREFIX + "SansMotDePasse" } });
  check("POST /api/auth avec un pseudo seul est REFUSE (aucun jeton, aucun acces)",
    legacy.status !== 200 && !(legacy.json && legacy.json.token), `code ${legacy.status}`);
  check("le message reste generique (aucune indication sur l'existence du compte)",
    !!(legacy.json && legacy.json.error === "Pseudo ou mot de passe incorrect."), legacy.json && legacy.json.error);
  const ghost = db.prepare("SELECT id FROM users WHERE pseudo = ?").get(PREFIX + "SansMotDePasse");
  check("aucun compte n'a ete cree par cette requete", !ghost);

  section("2. Inscription");
  const noPwd = await api("/api/auth/register", { method: "POST", body: { pseudo } });
  check("mot de passe absent -> 400", noPwd.status === 400, `code ${noPwd.status}`);
  const tooWeak = await api("/api/auth/register", { method: "POST", body: { pseudo, password: PWD_WEAK } });
  check("mot de passe faible -> 400", tooWeak.status === 400, tooWeak.json && tooWeak.json.error);
  check("les regles manquantes sont detaillees",
    !!(tooWeak.json && Array.isArray(tooWeak.json.missing) && tooWeak.json.missing.length >= 3),
    tooWeak.json && JSON.stringify(tooWeak.json.missing));

  const reg = await api("/api/auth/register", { method: "POST", body: { pseudo, password: PWD_OK, province: "Antananarivo" } });
  check("inscription valide -> 200 + jeton", reg.status === 200 && !!reg.json.token, `code ${reg.status}`);
  const token1 = reg.json && reg.json.token;
  check("la reponse ne contient ni mot de passe ni empreinte",
    !!(reg.json && !JSON.stringify(reg.json).includes(PWD_OK) && !JSON.stringify(reg.json).includes("argon2")));

  const dup = await api("/api/auth/register", { method: "POST", body: { pseudo, password: PWD_OK } });
  check("pseudo deja pris -> 409", dup.status === 409, `code ${dup.status}`);

  section("3. Connexion");
  const wrong = await api("/api/auth/login", { method: "POST", body: { pseudo, password: "Mauvais!2026" } });
  check("mauvais mot de passe -> 401", wrong.status === 401, `code ${wrong.status}`);
  const unknown = await api("/api/auth/login", { method: "POST", body: { pseudo: PREFIX + "Inexistant", password: PWD_OK } });
  check("message IDENTIQUE pour un pseudo inconnu (anti-enumeration)",
    unknown.status === 401 && unknown.json.error === wrong.json.error,
    `« ${unknown.json && unknown.json.error} »`);

  const ok = await api("/api/auth/login", { method: "POST", body: { pseudo, password: PWD_OK } });
  check("bon mot de passe -> 200 + jeton", ok.status === 200 && !!ok.json.token, `code ${ok.status}`);
  const token2 = ok.json && ok.json.token;

  section("4. Le jeton protege reellement les routes");
  const me = await api("/api/user", { token: token2 });
  check("GET /api/user avec jeton valide -> 200", me.status === 200 && me.json.user.pseudo === pseudo, `code ${me.status}`);
  const bad = await api("/api/user", { token: "jeton-invente-de-trente-deux-octets" });
  check("GET /api/user avec jeton invente -> 401", bad.status === 401, `code ${bad.status}`);
  const none = await api("/api/user");
  check("GET /api/user sans jeton -> 401", none.status === 401, `code ${none.status}`);

  section("5. Deconnexion = revocation cote serveur");
  const out = await api("/api/auth/logout", { method: "POST", token: token2 });
  check("POST /api/auth/logout -> 200", out.status === 200, `code ${out.status}`);
  const after = await api("/api/user", { token: token2 });
  check("le jeton revoque ne fonctionne plus -> 401", after.status === 401, `code ${after.status}`);
  const still = await api("/api/user", { token: token1 });
  check("les AUTRES sessions du compte restent valides", still.status === 200, `code ${still.status}`);

  section("6. Stockage : rien en clair");
  const cred = db.prepare(`SELECT c.password_hash, c.algo FROM auth_credentials c
                           JOIN users u ON u.id = c.user_id WHERE u.pseudo = ?`).get(pseudo);
  check("empreinte au format PHC Argon2id",
    !!cred && cred.password_hash.startsWith("$argon2id$v=19$") && cred.algo === "argon2id",
    cred ? cred.password_hash.slice(0, 22) + "..." : "absente");
  const rawInDb = db.prepare("SELECT COUNT(*) AS c FROM auth_credentials WHERE password_hash LIKE ?").get("%" + PWD_OK + "%").c;
  check("le mot de passe en clair est absent de la base", rawInDb === 0);
  const tokenStored = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE token_hash = ?").get(token1).c;
  check("le jeton n'est PAS stocke en clair (seule son empreinte l'est)", tokenStored === 0);
  const hashRow = db.prepare("SELECT token_hash FROM sessions LIMIT 1").get();
  check("l'empreinte de jeton fait 64 caracteres hexadecimaux",
    !!hashRow && /^[0-9a-f]{64}$/.test(hashRow.token_hash));

  section("7. Journal d'audit : ajout seul");
  const events = db.prepare("SELECT event FROM auth_audit_log ORDER BY id DESC LIMIT 60").all().map((r) => r.event);
  check("les evenements register / login_ok / login_fail / logout sont traces",
    ["register", "login_ok", "login_fail", "logout"].every((e) => events.includes(e)), events.slice(0, 6).join(","));
  let blocked = false;
  try { db.prepare("UPDATE auth_audit_log SET detail = 'falsifie' WHERE id = (SELECT MAX(id) FROM auth_audit_log)").run(); }
  catch (e) { blocked = /ajout seul/i.test(e.message); }
  check("une modification du journal est REFUSEE par la base", blocked);

  section("8. Compte herite : parcours de reclamation SUPPRIME");
  const legacyPseudo = PREFIX + "Herite";
  db.prepare("INSERT INTO users (pseudo, elo, balance) VALUES (?, 1100, 5000)").run(legacyPseudo);
  const beforeLogin = await api("/api/auth/login", { method: "POST", body: { pseudo: legacyPseudo, password: PWD_OK } });
  check("un compte herite ne peut pas se connecter sans mot de passe", beforeLogin.status === 401, `code ${beforeLogin.status}`);
  /* La route supprimée ne doit RIEN créer, quel que soit l'état de la session.
     Sans session, la requête tombe sur le garde « Non authentifié » (401) ;
     avec session, sur la 404 générale : dans les deux cas aucun mot de passe
     n'est écrit et aucun jeton n'est délivré. */
  const claimGone = await api("/api/auth/claim", { method: "POST", body: { pseudo: legacyPseudo, password: PWD_OK } });
  check("reclamation sans session : rien n'est cree (aucun jeton)",
    claimGone.status !== 200 && !(claimGone.json && claimGone.json.token), `code ${claimGone.status}`);
  const claimGoneAuth = await api("/api/auth/claim", { method: "POST", body: { pseudo: legacyPseudo, password: PWD_OK }, token: token1 });
  check("route de reclamation supprimee -> 404 pour un compte connecte", claimGoneAuth.status === 404, `code ${claimGoneAuth.status}`);
  const stillNoPwd = await api("/api/auth/login", { method: "POST", body: { pseudo: legacyPseudo, password: PWD_OK } });
  check("le compte herite n'a toujours aucun mot de passe (impossible a reclamer)", stillNoPwd.status === 401, `code ${stillNoPwd.status}`);

  section("8b. Disponibilite du pseudo : lue dans la BASE, pas dans une liste");
  const freePseudo = await api("/api/auth/available?pseudo=" + encodeURIComponent(PREFIX + "Libre"));
  check("pseudo inconnu -> disponible", freePseudo.status === 200 && freePseudo.json.available === true, JSON.stringify(freePseudo.json));
  const takenPseudo = await api("/api/auth/available?pseudo=" + encodeURIComponent(pseudo));
  check("pseudo deja en base -> indisponible", takenPseudo.status === 200 && takenPseudo.json.available === false, JSON.stringify(takenPseudo.json));
  const shortPseudo = await api("/api/auth/available?pseudo=ab");
  check("pseudo trop court -> invalide", shortPseudo.status === 200 && shortPseudo.json.valid === false, JSON.stringify(shortPseudo.json));

  section("8c. Unicite du telephone / email annoncee par l'interface");
  const dblPhone = await api("/api/auth/register", { method: "POST",
    body: { pseudo: PREFIX + "TelBis", password: PWD_OK, phone: "0340000000" } });
  check("premier compte avec ce telephone -> 200", dblPhone.status === 200, `code ${dblPhone.status}`);
  const dblPhone2 = await api("/api/auth/register", { method: "POST",
    body: { pseudo: PREFIX + "TelTer", password: PWD_OK, phone: "0340000000" } });
  check("meme telephone sur un autre compte -> 409", dblPhone2.status === 409, `code ${dblPhone2.status}`);

  section("9. WebSocket");
  const wsOk = await wsProbe(token1);
  check("jeton valide accepte par le WebSocket", wsOk.ok, wsOk.message || "");
  const wsKo = await wsProbe("jeton-invente-de-trente-deux-octets");
  check("jeton invalide refuse par le WebSocket", !wsKo.ok, wsKo.message || "");

  section("10. Verrouillage progressif apres echecs");
  const lockPseudo = PREFIX + "Verrou";
  await api("/api/auth/register", { method: "POST", body: { pseudo: lockPseudo, password: PWD_OK } });
  let sawLock = false, lastStatus = 0, lastError = "";
  for (let i = 0; i < 6; i++) {
    const r = await api("/api/auth/login", { method: "POST", body: { pseudo: lockPseudo, password: "Mauvais!2026" } });
    lastStatus = r.status; lastError = (r.json && r.json.error) || "";
    if (r.status === 429) { sawLock = true; break; }
  }
  check("le compte se verrouille apres 5 echecs (429)", sawLock, `dernier code ${lastStatus} — ${lastError}`);
  const lockedCorrect = await api("/api/auth/login", { method: "POST", body: { pseudo: lockPseudo, password: PWD_OK } });
  check("meme le BON mot de passe est refuse pendant le verrouillage", lockedCorrect.status === 429, `code ${lockedCorrect.status}`);
}
/* =========================================================
   Phase 2 — Limitation de débit par IP
   ---------------------------------------------------------
   Instance séparée avec un quota volontairement très bas : c'est la seule
   façon de prouver le comportement 429 sans attendre 12 requêtes ni
   perturber les tests fonctionnels (le compteur est en mémoire, donc remis
   à zéro à chaque nouveau processus).
   ========================================================= */
async function phaseLimiteDebit() {
  section("11. Limitation de debit par IP (quota volontairement bas : 3)");
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const r = await api("/api/auth/login", { method: "POST", body: { pseudo: PREFIX + "Limite", password: "Inexistant!2026" } });
    codes.push(r.status);
  }
  check("les 3 premieres tentatives sont traitees", codes.slice(0, 3).every((c) => c === 401), codes.join(","));
  check("les suivantes sont refusees en 429 (limiteur actif)", codes.slice(3).every((c) => c === 429), codes.join(","));
}

/* =========================================================
   Enchaînement
   ========================================================= */
(async () => {
  let child = null;
  const path = require("node:path");
  try {
    console.log("=== D-aona — tests d'authentification ===");
    console.log("Base : " + path.join(__dirname, "d-aona.db"));
    console.log("Port : " + PORT + " (instances jetables, le serveur reel n'est pas touche)");

    child = startServer({ D_AONA_AUTH_RATE_MAX: "200" });
    await waitServer();
    await phaseFonctionnel();
    await stopServer(child);
    child = null;

    child = startServer({ D_AONA_AUTH_RATE_MAX: "3", D_AONA_AUTH_RATE_WINDOW_S: "300" });
    await waitServer();
    await phaseLimiteDebit();
    await stopServer(child);
    child = null;
  } catch (err) {
    failures++;
    console.error("\nERREUR PENDANT LES TESTS : " + err.message);
  } finally {
    await stopServer(child);
    const n = cleanup();
    console.log("\nComptes de test supprimes : " + n + " (prefixe " + PREFIX + ")");
    console.log(failures === 0
      ? "\nRESULTAT : TOUS LES TESTS PASSENT"
      : "\nRESULTAT : " + failures + " ECHEC(S)");
    process.exit(failures === 0 ? 0 : 1);
  }
})();