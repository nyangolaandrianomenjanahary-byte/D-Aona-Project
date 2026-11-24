/* =========================================================
   D-aôna — Campagne de SCÉNARIOS de test (bout en bout)
   ---------------------------------------------------------
   Vérifie tous les parcours fonctionnels de l'application sur une
   instance de serveur jetable :

     1. Authentification (inscription, session, refus sans jeton)
     2. Référentiels (config, classement, recherche, profils publics)
     3. Amis (demandes, acceptation, refus, retrait, croisement)
     4. Messagerie (WebSocket + historique REST)
     5. Wallet (dépôt, retrait, bonus non retirable, historique)
     6. Skins (deux catégories de pions : achat, possession, équipement, refus croisé)
     7. Tournois (KYC, solde, inscription, bracket, confirmation)
     8. Notifications (création, lecture unitaire, tout lire)
     9. Temps réel (matchmaking, tirage au sort, coups, spectateur,
        entraînement IA, défis avec mise, remboursement)
        — dont les apparences de pions des DEUX joueurs dans l'état diffusé :
          le plateau se peint par PROPRIÉTAIRE, pas par couleur

   ISOLATION : la base utilisée est une COPIE cohérente à chaud
   (VACUUM INTO) de `d-aona.db`, placée dans un dossier temporaire et
   supprimée à la fin. Aucune écriture dans la base réelle, aucun
   compte réel touché, aucun fichier du dossier uploads/ modifié.

   Usage :  node test_scenarios.js
   Sortie   : rapport ligne par ligne + code de sortie 1 si échec
   ========================================================= */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const WebSocket = require("ws");
const { legalMoves, GameSession } = require("./game");
const DATA = require("./data");
/* Images KYC réelles + attribution du rôle d'administration sur la copie
   jetable : deux besoins partagés avec test_ui_scenarios.js. */
const KYCX = require("./test/kyc_fixtures");

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PREFIX = "ZzS";
const PWD = "Scenarios!2026";
const TID = 9001;                    // tournoi de test (4 places, entrée 5000)
const TID2 = 9002;                   // tournoi de test (entrée libre, valeur historique « Or » sur min_rank)
const TID3 = 9003;                   // tournoi de test (entrée 20 000 Ar : solde insuffisant)
const REAL_DB = path.join(__dirname, "d-aona.db");

let checks = 0, failures = 0;
const failed = [];
function check(name, ok, detail = "") {
  checks++;
  if (!ok) { failures++; failed.push(name + (detail ? "  -> " + detail : "")); }
  console.log(`  ${ok ? "OK   " : "ECHEC"} ${name}${detail ? "   -> " + detail : ""}`);
}
function section(t) { console.log("\n=== " + t + " ==="); }
/* Observation sans jugement (comportement à confirmer, hors périmètre du test). */
function note(t) { console.log("  NOTE  " + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Client HTTP minimal ---------- */
async function api(p, { method = "GET", body = null, token = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (e) { /* réponse non JSON */ }
  /* Les en-têtes sont conservés : le test du cache (Cache-Control) se juge là. */
  return { status: res.status, json, headers: Object.fromEntries(res.headers) };
}
/* ---------- Vérification d'identité d'un compte de test ----------
   Même parcours qu'un vrai joueur : dossier recto + verso (deux images PNG
   réelles), puis approbation par le compte ADMINISTRATEUR — jamais par le
   compte lui-même, la règle d'auto-validation l'interdisant. */
async function verifyKyc(token) {
  const sub = await api("/api/kyc/submit", { method: "POST", token, body: { recto: KYCX.recto(), verso: KYCX.verso() } });
  if (sub.status !== 200) return sub;
  return api(`/api/admin/kyc/${sub.json.caseId}/approve`, { method: "POST", token: users.Admin.token, body: {} });
}

/* ---------- Client WebSocket : boîte aux lettres + attente par prédicat ---------- */
function wsClient(token) {
  const socket = new WebSocket(WS_URL);
  const inbox = [];
  const waiters = [];
  socket.on("message", (raw) => {
    let m = null;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    inbox.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); }
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.once("open", () => { socket.send(JSON.stringify({ type: "auth", token })); resolve(); });
    socket.once("error", reject);
  });
  return {
    socket, inbox, ready,
    send(obj) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); },
    /* Attend le premier message (déjà reçu ou à venir) satisfaisant le prédicat. */
    wait(pred, ms = 8000) {
      const found = inbox.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.timer === timer);
          if (i >= 0) waiters.splice(i, 1);
          resolve(null);
        }, ms);
        waiters.push({ pred, resolve, timer });
      });
    },
    close() { try { socket.close(); } catch (e) {} },
  };
}

/* ---------- Copie jetable de la base (VACUUM INTO, source en lecture seule) ---------- */
let tmpDir = null;
function snapshotDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daona-scenarios-"));
  const dest = path.join(tmpDir, "d-aona.db");
  const src = new DatabaseSync(REAL_DB, { readOnly: true });
  src.exec(`VACUUM INTO '${dest.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  src.close();
  return dest;
}

/* ---------- Instance de serveur jetable, sur la copie ---------- */
function startServer(dbPath) {
  return spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      D_AONA_PORT: String(PORT),
      D_AONA_DB_PATH: dbPath,
      /* Le quota d'authentification est mesuré par test_auth.js, sur le serveur
         réel. Ici, la campagne inscrit une dizaine de comptes depuis la même IP :
         sans cette marge, elle se limitait elle-même en 429 et le scénario en
         cours échouait pour une raison qui n'a rien à voir avec le produit. */
      D_AONA_AUTH_RATE_MAX: process.env.D_AONA_AUTH_RATE_MAX || "400",
    },
    stdio: "ignore",
  });
}
async function waitServer(timeoutMs = 25000) {
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
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} resolve(); }, 2500);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill(); } catch (e) { clearTimeout(t); resolve(); }
  });
}

/* ---------- Préparation de la copie : tournoi de test dédié ---------- */
function prepareFixture(dbPath) {
  const d = new DatabaseSync(dbPath);
  const ins = d.prepare(`INSERT INTO tournaments
      (id,name,game,format,entry,max_players,status,min_rank,sponsor,starts_at,results_json,match_duration_min,interval_min)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const id of [TID, TID2, TID3]) {
    d.prepare("DELETE FROM tournament_matches WHERE tournament_id = ?").run(id);
    d.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ?").run(id);
    d.prepare("DELETE FROM tournaments WHERE id = ?").run(id);
  }
  const soon = new Date(Date.now() + 15 * 60000).toISOString();
  ins.run(TID, "Tournoi Scénarios", "Fanorona", "rapide", 5000, 4, "inscriptions", "Bronze", null, soon, null, 5, 0);
  ins.run(TID2, "Tournoi Scénarios Or", "Fanorona", "rapide", 0, 4, "inscriptions", "Or", null, soon, null, 5, 0);
  ins.run(TID3, "Tournoi Scénarios Cher", "Fanorona", "rapide", 20000, 4, "inscriptions", "Bronze", null, soon, null, 5, 0);
  d.close();
}

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}
/* =========================================================
   PHASE 1 — Comptes, session et référentiels
   ========================================================= */
const users = {};   // nom court -> { pseudo, token, id }

async function phaseComptes() {
  section("1. Comptes, session et référentiels");
  /* « Admin » n'est pas un joueur de la campagne : c'est le compte qui portera
     le rôle d'administration (file KYC). Il est inscrit comme tout le monde —
     aucun compte privilégié n'est fabriqué en base à la main. */
  for (const n of ["Ari", "Bema", "Cora", "Doda", "Efa", "Admin"]) {
    const pseudo = PREFIX + n;
    const r = await api("/api/auth/register", { method: "POST", body: { pseudo, password: PWD, province: "Antananarivo" } });
    const u = r.json && r.json.user;
    users[n] = { pseudo, token: r.json && r.json.token, id: u && u.id };
    check(`inscription de ${pseudo} -> jeton`, r.status === 200 && !!users[n].token, `code ${r.status}`);
  }

  const anon = await api("/api/user");
  check("GET /api/user sans jeton -> 401", anon.status === 401, `code ${anon.status}`);

  const me = await api("/api/user", { token: users.Ari.token });
  check("GET /api/user avec jeton -> profil du bon compte",
    me.status === 200 && me.json.user.pseudo === users.Ari.pseudo, me.json && me.json.user && me.json.user.pseudo);
  /* Règle PRD : un compte NEUF démarre à 0 et reçoit le seul BONUS DE
     BIENVENUE de 1 000 Ar, NON RETIRABLE (`bonus_lock`). Il est écrit au grand
     livre (une ligne « Bonus de bienvenue »), donc l'invariant « solde =
     Σ écritures » tient dès la première seconde. */
  check("profil neuf : bonus de 1 000 Ar, verrouillé, UNE écriture « Bonus de bienvenue »",
    me.json.user.balance === 1000 && me.json.user.bonus_lock === 1000 &&
    Array.isArray(me.json.transactions) && me.json.transactions.length === 1 &&
    /bienvenue/i.test(me.json.transactions[0].label || ""),
    `solde ${me.json.user.balance}, verrouillé ${me.json.user.bonus_lock}, écritures ${(me.json.transactions || []).length}`);
  check("profil : place au classement et badge renvoyés", !!me.json.user.rank && !!me.json.user.badge);
  check("profil : aucun secret exposé",
    !("password_hash" in me.json.user) && !("password" in me.json.user));

  /* ---------- Profil déclaré (migration 030) : cinq champs obligatoires ----------
     Le serveur borne la FORME (le KYC juge la conformité au CIN). Un profil n'est
     « complet » qu'avec la photo : ces contrôles portent donc sur les champs et
     sur l'état calculé, pas sur une supposition du client. */
  const profBioVide = await api("/api/user/profile", { method: "POST", token: users.Ari.token, body: { bio: "" } });
  check("profil : une bio vide est refusée (400)", profBioVide.status === 400, JSON.stringify(profBioVide.json));
  const profNomCourt = await api("/api/user/profile", { method: "POST", token: users.Ari.token, body: { first_name: "X" } });
  check("profil : un prénom d'une lettre est refusé (400)", profNomCourt.status === 400, JSON.stringify(profNomCourt.json));
  const profDateFuture = await api("/api/user/profile", { method: "POST", token: users.Ari.token, body: { birth_date: "2099-01-01" } });
  check("profil : une date de naissance future est refusée (400)", profDateFuture.status === 400, JSON.stringify(profDateFuture.json));
  const profOk = await api("/api/user/profile", { method: "POST", token: users.Ari.token,
    body: { first_name: "Ari", last_name: "Rakoto", birth_date: "1996-04-12", bio: "Joueur de Fanorona.", phone: "0341234567" } });
  check("profil : les cinq champs sont enregistrés (profil encore incomplet SANS photo)",
    profOk.status === 200 && profOk.json.user.first_name === "Ari" &&
    profOk.json.user.last_name === "Rakoto" && profOk.json.user.birth_date === "1996-04-12" &&
    profOk.json.user.bio === "Joueur de Fanorona." && profOk.json.user.phone === "0341234567" &&
    profOk.json.user.profile_complete === false,
    JSON.stringify(profOk.json.user && { first: profOk.json.user.first_name, complete: profOk.json.user.profile_complete }));

  const bad = await api("/api/auth/login", { method: "POST", body: { pseudo: users.Ari.pseudo, password: "Mauvais!2026xyz" } });
  check("connexion avec un mauvais mot de passe -> refus", bad.status === 401 || bad.status === 429, `code ${bad.status}`);

  const cfg = await api("/api/config", { token: users.Ari.token });
  check("GET /api/config : 3 formats, 3 opérateurs, plus aucun référentiel de rang",
    cfg.status === 200 && cfg.json.formats.length === 3 && cfg.json.operators.length === 3 &&
    cfg.json.ranks === undefined);
  check("GET /api/config : catalogue de jeux (Fanorona MVP + 2 à venir)",
    cfg.json.games.length === 3 && cfg.json.games[0].id === "fanorona");
}

/* =========================================================
   PHASE 2 — Classement, recherche, profils publics, listes vides
   ========================================================= */
async function phaseReferentiels() {
  section("2. Classement, recherche et profils publics");
  const lb = await api("/api/leaderboard", { token: users.Ari.token });
  /* La base est VIERGE par défaut (le seed est désactivé, voir D_AONA_SEED) :
     exiger « plus de 20 » entrées supposait la base peuplée de comptes de
     démonstration. On vérifie ce qui doit être vrai quelle que soit la base :
     le classement contient au moins les comptes créés par cette campagne. */
  check("GET /api/leaderboard -> liste classée (au moins les comptes du test)",
    lb.status === 200 && Array.isArray(lb.json.leaderboard) && lb.json.leaderboard.length >= 5,
    `entrées ${lb.json.leaderboard && lb.json.leaderboard.length}`);
  check("leaderboard : chaque entrée porte sa place, son pseudo, son Elo, son badge",
    lb.json.leaderboard.every((e) => e.rank >= 1 && !!e.pseudo && typeof e.elo === "number" && !!e.badge));
  check("leaderboard : mon compte est marqué me=true",
    lb.json.leaderboard.some((e) => e.me === true && e.pseudo === users.Ari.pseudo));

  const search = await api("/api/users/search?q=" + PREFIX + "Cor", { token: users.Ari.token });
  check("GET /api/users/search retrouve les comptes de test",
    search.status === 200 && search.json.users.some((u) => u.pseudo === users.Cora.pseudo));

  const pub = await api("/api/users/" + users.Bema.id, { token: users.Ari.token });
  check("GET /api/users/:id -> profil public sans données privées",
    pub.status === 200 && pub.json.user.pseudo === users.Bema.pseudo &&
    !("balance" in pub.json.user) && !("kyc" in pub.json.user));
  check("profil public : statut d'amitié initial = none", pub.json.user.friendStatus === "none");

  const prof404 = await api("/api/users/999999", { token: users.Ari.token });
  check("profil d'un joueur inexistant -> 404", prof404.status === 404, `code ${prof404.status}`);

  const hist = await api("/api/games/history", { token: users.Ari.token });
  check("GET /api/games/history -> tableau vide pour un compte neuf",
    hist.status === 200 && Array.isArray(hist.json.games) && hist.json.games.length === 0);

  const live = await api("/api/games/live", { token: users.Ari.token });
  check("GET /api/games/live -> aucune partie en cours au démarrage",
    live.status === 200 && Array.isArray(live.json.live) && live.json.live.length === 0);

  const notifs = await api("/api/notifications", { token: users.Ari.token });
  check("GET /api/notifications -> vide et 0 non lu",
    notifs.status === 200 && notifs.json.notifications.length === 0 && notifs.json.unread === 0);

  const tour = await api("/api/tournaments", { token: users.Ari.token });
  const t = tour.json.tournaments.find((x) => parseInt(x.id) === TID);
  check("GET /api/tournaments contient le tournoi de test, non inscrit",
    tour.status === 200 && !!t && t.isRegistered === false, `tournoi ${TID} trouvé : ${!!t}`);
  check("tournoi de test : 4 places, entrée 5000 Ar, statut inscriptions",
    !!t && t.maxPlayers === 4 && t.entry === 5000 && t.status === "inscriptions");

  const mine = await api("/api/tournaments/my", { token: users.Ari.token });
  check("GET /api/tournaments/my -> vide avant inscription",
    mine.status === 200 && Array.isArray(mine.json.tournaments) && mine.json.tournaments.length === 0);

  const tr = await api("/api/transactions", { token: users.Ari.token });
  check("GET /api/transactions -> une seule ligne, le bonus de bienvenue",
    tr.status === 200 && tr.json.transactions.length === 1 &&
    /bienvenue/i.test(tr.json.transactions[0].label || ""),
    JSON.stringify((tr.json.transactions || []).map((t) => t.label)));
}
/* =========================================================
   PHASE 3 — Amis : demandes, acceptation, refus, retrait
   ========================================================= */
async function phaseAmis() {
  section("3. Amis");
  const A = users.Ari.token, B = users.Bema.token, C = users.Cora.token, D = users.Doda.token, E = users.Efa.token;

  const self = await api("/api/friends/request", { method: "POST", body: { pseudo: users.Ari.pseudo }, token: A });
  check("demande d'ami à soi-même -> refusée", self.status === 400, `code ${self.status}`);

  const ghost = await api("/api/friends/request", { method: "POST", body: { pseudo: "ZzSInconnu" }, token: A });
  check("demande d'ami à un pseudo inexistant -> 404", ghost.status === 404, `code ${ghost.status}`);

  const sent = await api("/api/friends/request", { method: "POST", body: { pseudo: users.Bema.pseudo }, token: A });
  check("demande d'ami envoyée", sent.status === 200 && sent.json.status === "sent", JSON.stringify(sent.json));

  const dup = await api("/api/friends/request", { method: "POST", body: { pseudo: users.Bema.pseudo }, token: A });
  check("demande en doublon -> refusée", dup.status === 400, `code ${dup.status} ${dup.json && dup.json.error}`);

  const incoming = await api("/api/friends", { token: B });
  check("Bema voit la demande entrante dans /api/friends",
    incoming.json.incoming.some((r) => r.pseudo === users.Ari.pseudo), JSON.stringify(incoming.json.incoming));
  const outgoing = await api("/api/friends", { token: A });
  check("Ari voit sa demande sortante",
    outgoing.json.outgoing.some((r) => r.pseudo === users.Bema.pseudo));

  const midStatus = await api("/api/users/" + users.Bema.id, { token: A });
  check("profil public : friendStatus = sent après envoi", midStatus.json.user.friendStatus === "sent", midStatus.json.user.friendStatus);

  const wrongUser = await api("/api/friends/respond", { method: "POST", body: { id: incoming.json.incoming[0].id, action: "accept" }, token: C });
  check("répondre à une demande qui ne m'est pas adressée -> 403", wrongUser.status === 403, `code ${wrongUser.status}`);

  const accepted = await api("/api/friends/respond", { method: "POST", body: { id: incoming.json.incoming[0].id, action: "accept" }, token: B });
  check("acceptation de la demande", accepted.status === 200 && accepted.json.status === "accepted", JSON.stringify(accepted.json));

  const friendsA = await api("/api/friends", { token: A });
  const friendsB = await api("/api/friends", { token: B });
  check("amitié créée dans les DEUX sens (Ari, Bema)",
    friendsA.json.friends.some((f) => f.pseudo === users.Bema.pseudo) &&
    friendsB.json.friends.some((f) => f.pseudo === users.Ari.pseudo));

  const thread = await api("/api/chat/" + users.Bema.pseudo, { token: A });
  const auto = (thread.json.messages || []).find((m) => (m.text || "") === "De aona ? Masahy amiko ?");
  check("message automatique « De aona ? Masahy amiko ? » créé à l'acceptation", !!auto,
    JSON.stringify((thread.json.messages || []).slice(0, 2)));
  /* L'auteur est celui qui a DEMANDÉ (Ari) : côté Ari le fil montre un message
     « me », côté Bema (celui qui a accepté) le même message vient « d'eux ». */
  check("message automatique écrit par le DEMANDEUR (côté Ari : « me »)",
    !!auto && auto.direction === "me", auto ? `direction ${auto.direction}` : "message introuvable");
  const threadB = await api("/api/chat/" + users.Ari.pseudo, { token: B });
  const autoB = (threadB.json.messages || []).find((m) => (m.text || "") === "De aona ? Masahy amiko ?");
  check("côté accepteur (Bema), le message vient de l'expéditeur (« them »)",
    !!autoB && autoB.direction === "them", autoB ? `direction ${autoB.direction}` : "message introuvable");

  const again = await api("/api/friends/respond", { method: "POST", body: { id: incoming.json.incoming[0].id, action: "accept" }, token: B });
  check("acceptation en double -> 400", again.status === 400, `code ${again.status}`);

  const already = await api("/api/friends/request", { method: "POST", body: { pseudo: users.Ari.pseudo }, token: B });
  check("nouvelle demande entre amis -> refusée (Déjà amis)", already.status === 400, `code ${already.status} ${already.json && already.json.error}`);

  /* Refus : Cora -> Doda, Doda refuse */
  await api("/api/friends/request", { method: "POST", body: { pseudo: users.Doda.pseudo }, token: C });
  const dInbox = await api("/api/friends", { token: D });
  const declined = await api("/api/friends/respond", { method: "POST", body: { id: dInbox.json.incoming[0].id, action: "decline" }, token: D });
  check("refus d'une demande", declined.status === 200 && declined.json.status === "declined", JSON.stringify(declined.json));
  const dFriends = await api("/api/friends", { token: D });
  check("un refus ne crée pas d'amitié", !dFriends.json.friends.some((f) => f.pseudo === users.Cora.pseudo));

  /* Croisement : Doda -> Efa puis Efa -> Doda = acceptation mutuelle directe */
  await api("/api/friends/request", { method: "POST", body: { pseudo: users.Efa.pseudo }, token: D });
  const crossed = await api("/api/friends/request", { method: "POST", body: { pseudo: users.Doda.pseudo }, token: E });
  check("demandes croisées -> acceptation mutuelle immédiate",
    crossed.status === 200 && crossed.json.status === "accepted", JSON.stringify(crossed.json));
  const eFriends = await api("/api/friends", { token: E });
  check("amitié croisée visible côté Efa", eFriends.json.friends.some((f) => f.pseudo === users.Doda.pseudo));
  const threadD = await api("/api/chat/" + users.Efa.pseudo, { token: D });
  check("demande croisée : le message automatique est aussi écrit par le demandeur (Doda)",
    (threadD.json.messages || []).some((m) => (m.text || "") === "De aona ? Masahy amiko ?" && m.direction === "me"),
    JSON.stringify((threadD.json.messages || []).slice(0, 2)));

  /* Retrait */
  const removed = await api("/api/friends/" + users.Bema.pseudo, { method: "DELETE", token: A });
  check("retrait d'un ami", removed.status === 200);
  const after = await api("/api/friends", { token: A });
  check("ami retiré effectivement absent", !after.json.friends.some((f) => f.pseudo === users.Bema.pseudo));
  const removedGhost = await api("/api/friends/ZzSInconnu", { method: "DELETE", token: A });
  check("retrait d'un pseudo inexistant -> 404", removedGhost.status === 404, `code ${removedGhost.status}`);

  /* On refait l'amitié Ari <-> Bema pour la suite */
  await api("/api/friends/request", { method: "POST", body: { pseudo: users.Bema.pseudo }, token: A });
  const re = await api("/api/friends", { token: B });
  const rid = re.json.incoming.find((r) => r.pseudo === users.Ari.pseudo).id;
  await api("/api/friends/respond", { method: "POST", body: { id: rid, action: "accept" }, token: B });
  const restored = await api("/api/friends", { token: A });
  check("amitié rétablie pour la suite des scénarios", restored.json.friends.some((f) => f.pseudo === users.Bema.pseudo));
}
/* =========================================================
   PHASE 4 — Messagerie (WebSocket + historique REST)
   ========================================================= */
async function phaseMessagerie() {
  section("4. Messagerie");
  const a = wsClient(users.Ari.token), b = wsClient(users.Bema.token);
  await Promise.all([a.ready, b.ready]);
  await sleep(200);

  a.send({ type: "chat_message", toPseudo: users.Bema.pseudo, text: "Scénario : bonjour !" });
  const received = await b.wait((m) => m.type === "chat_message" && m.text === "Scénario : bonjour !");
  check("le destinataire reçoit le message en direct", !!received, received ? "" : "délai dépassé");

  const echo = await a.wait((m) => m.type === "chat_message" && m.direction === "me");
  check("l'expéditeur reçoit son propre écho (direction me)", !!echo);

  const thread = await api("/api/chat/" + users.Bema.pseudo, { token: users.Ari.token });
  check("le message est conservé dans l'historique REST",
    (thread.json.messages || []).some((m) => m.text === "Scénario : bonjour !"));
  check("l'historique marque bien les directions me/them",
    (thread.json.messages || []).some((m) => m.direction === "me" && m.text === "Scénario : bonjour !"));

  const contacts = await api("/api/chat/contacts", { token: users.Ari.token });
  check("Bema apparaît dans les contacts de messagerie",
    (contacts.json.contacts || []).some((c) => c.pseudo === users.Bema.pseudo));
  check("les joueurs connectés sont signalés en ligne",
    (contacts.json.onlineUsers || []).some((u) => u.pseudo === users.Bema.pseudo));

  const ghost = await api("/api/chat/ZzSInconnu", { token: users.Ari.token });
  check("fil avec un pseudo inexistant -> 404", ghost.status === 404, `code ${ghost.status}`);

  a.send({ type: "chat_message", toPseudo: "ZzSInconnu", text: "test" });
  const err = await a.wait((m) => m.type === "error" && /introuvable/i.test(m.message || ""));
  check("message à un pseudo inexistant -> erreur serveur", !!err, err ? err.message : "aucune erreur");

  a.close(); b.close();
  await sleep(150);
}
/* =========================================================
   PHASE 5 — Portefeuille : dépôt, retrait, bonus, KYC
   ========================================================= */
async function phasePortefeuille() {
  section("5. Portefeuille (wallet)");
  const A = users.Ari.token, E = users.Efa.token;

  const before = await api("/api/user", { token: A });
  check("bonus de bienvenue : 1 000 Ar, verrouillés (non retirables)",
    before.json.user.balance === 1000 && before.json.user.bonus_lock === 1000,
    JSON.stringify({ balance: before.json.user.balance, lock: before.json.user.bonus_lock }));

  const dep1 = await api("/api/deposit", { method: "POST", body: { amount: 10000, operator: "MVola" }, token: A });
  check("dépôt de 10 000 Ar -> crédité, SANS second bonus (déjà reçu à l'inscription)",
    dep1.status === 200 && dep1.json.balance === 11000 && dep1.json.bonusLock === 1000, JSON.stringify(dep1.json));

  const dep2 = await api("/api/deposit", { method: "POST", body: { amount: 2000, operator: "Orange Money" }, token: A });
  check("2e dépôt : PAS de nouveau bonus de bienvenue (une seule fois par compte)",
    dep2.status === 200 && dep2.json.balance === 13000 && dep2.json.bonusLock === 1000, JSON.stringify(dep2.json));

  const low = await api("/api/withdraw", { method: "POST", body: { amount: 500 }, token: A });
  check("retrait sous le minimum de 1 000 Ar -> refusé", low.status === 400, `code ${low.status}`);

  const bonusOnly = await api("/api/withdraw", { method: "POST", body: { amount: 13000 }, token: A });
  check("impossible de retirer le montant total : les 1 000 Ar de bonus sont verrouillés",
    bonusOnly.status === 400, `code ${bonusOnly.status} ${bonusOnly.json && bonusOnly.json.error}`);

  /* Depuis la refonte, un retrait est une DEMANDE : rien n'est débité, le
     montant devient RÉSERVÉ. Solde 13 000, demandé 12 000 (le disponible),
     réservé = 1 000 de bonus + 12 000 = 13 000, disponible 0. */
  const ok = await api("/api/withdraw", { method: "POST", body: { amount: 12000, method: "MVola", phone: "0341234567" }, token: A });
  check("demande de retrait du disponible (12 000 Ar) acceptée, SANS débit",
    ok.status === 200 && ok.json.request && ok.json.request.status === "pending" &&
    ok.json.request.method === "MVola" && ok.json.request.phone === "0341234567" &&
    ok.json.balance === 13000 && ok.json.reserved === 13000 && ok.json.withdrawable === 0,
    JSON.stringify(ok.json));

  const again = await api("/api/withdraw", { method: "POST", body: { amount: 1000, operator: "MVola" }, token: A });
  check("une seconde demande est refusée tant que la première est en cours (409)",
    again.status === 409 && again.json.code === "DEMANDE_EN_COURS", JSON.stringify(again.json));

  const tx = await api("/api/transactions", { token: A });
  const labels = tx.json.transactions.map((t) => t.label);
  check("historique : un seul « Crédit de bienvenue »",
    labels.filter((l) => /bienvenue/i.test(l)).length === 1, JSON.stringify(labels));
  check("historique : la DEMANDE de retrait est visible, marquée « en attente »",
    labels.some((l) => /Dépôt MVola/i.test(l)) && labels.some((l) => /Orange Money/i.test(l)) &&
    labels.some((l) => /Retrait MVola \(en attente\)/i.test(l)), JSON.stringify(labels));
  check("historique : chaque ligne porte une date", tx.json.transactions.every((t) => !!t.created_at));

  /* Historique PAGINÉ et FILTRÉ côté serveur — l'écran Wallet s'appuie dessus
     (page, famille, recherche au clavier, export CSV, plafond du jour). */
  const page1 = await api("/api/transactions?size=2&page=1", { token: A });
  check("historique paginé : 2 lignes sur 4, total annoncé",
    page1.status === 200 && page1.json.transactions.length === 2 && page1.json.total === 4,
    JSON.stringify(page1.json));

  /* Aucun mouvement de retrait n'existe encore (la demande n'est pas payée) :
     c'est précisément ce que la refonte garantit. On vérifie donc la famille
     des dépôts, et l'absence de retrait est déjà couverte plus haut. */
  const byKind = await api("/api/transactions?kind=deposit", { token: A });
  check("filtre par famille : seuls les dépôts, chacun étiqueté",
    byKind.json.total === 2 && byKind.json.transactions.every((t) => t.kind === "deposit"),
    JSON.stringify(byKind.json));

  const byQ = await api("/api/transactions?q=orange", { token: A });
  check("recherche « orange » : le dépôt Orange Money seul",
    byQ.json.total === 1 && /Orange Money/i.test(byQ.json.transactions[0].label),
    JSON.stringify(byQ.json));

  const csvRes = await fetch(BASE + "/api/transactions/export", { headers: { Authorization: "Bearer " + A } });
  const csvText = await csvRes.text();
  check("export CSV : en-tête français et une ligne par mouvement",
    csvRes.status === 200 && /"Opération";"Type";"Moyen"/.test(csvText) && /"Dépôt MVola"/.test(csvText) && csvText.split("\r\n").length === 5,
    "code " + csvRes.status + " · " + csvText.slice(0, 80));

  const cap = await api("/api/withdraw", { method: "POST", body: { amount: 500001, operator: "MVola" }, token: A });
  check("plafond quotidien : retrait refusé au-delà de 500 000 Ar/jour",
    cap.status === 400 && /Plafond/i.test(cap.json.error || ""), JSON.stringify(cap.json));

  const meCap = await api("/api/user", { token: A });
  check("le profil expose le total retiré du jour (12 000 Ar, demande en cours comprise)",
    meCap.json.user.withdrawn_today === 12000, JSON.stringify(meCap.json.user.withdrawn_today));

  /* ---------- KYC v2 : dossier recto + verso, revue manuelle ----------
     L'ancienne route « /api/kyc/verify » mettait kyc = 1 sans recevoir d'image :
     elle répond désormais 410. Le parcours réel est vérifié ici de bout en bout,
     refus compris. */
  const legacy = await api("/api/kyc/verify", { method: "POST", token: A });
  check("vérification immédiate supprimée (410 KYC_SUBMIT_REQUIRED)",
    legacy.status === 410 && legacy.json.code === "KYC_SUBMIT_REQUIRED", `code ${legacy.status}`);

  const sansVerso = await api("/api/kyc/submit", { method: "POST", token: A, body: { recto: KYCX.recto() } });
  check("dossier sans verso -> 400 VERSO_REQUIRED",
    sansVerso.status === 400 && sansVerso.json.code === "VERSO_REQUIRED", JSON.stringify(sansVerso.json));

  const memesFaces = await api("/api/kyc/submit", { method: "POST", token: A, body: { recto: KYCX.recto(), verso: KYCX.recto() } });
  check("recto et verso identiques -> 400 MEME_IMAGE",
    memesFaces.status === 400 && memesFaces.json.code === "MEME_IMAGE", JSON.stringify(memesFaces.json));

  const fauxPng = await api("/api/kyc/submit", { method: "POST", token: A,
    body: { recto: "data:image/png;base64," + Buffer.from("<html>pas une image</html>").toString("base64"), verso: KYCX.verso() } });
  check("fichier HTML renommé .png -> 400 CONTENU_INVALIDE",
    fauxPng.status === 400 && fauxPng.json.code === "CONTENU_INVALIDE", JSON.stringify(fauxPng.json));

  const dossier = await api("/api/kyc/submit", { method: "POST", token: A,
    body: { recto: KYCX.recto(), verso: KYCX.verso() } });
  check("dossier complet accepté -> en attente de revue",
    dossier.status === 200 && dossier.json.kyc_status === "pending" && !!dossier.json.caseId, JSON.stringify(dossier.json));

  const enAttente = await api("/api/user", { token: A });
  check("un dossier en attente n'ouvre PAS les transactions (kyc reste faux)",
    enAttente.json.user.kyc === false && enAttente.json.user.kyc_status === "pending",
    JSON.stringify({ kyc: enAttente.json.user.kyc, statut: enAttente.json.user.kyc_status }));

  /* Un joueur sans rôle ne voit pas la file de revue (refus générique : ne rien
     révéler de l'existence du dossier d'autrui). */
  const sansRole = await api("/api/admin/kyc", { token: E });
  check("file de revue KYC fermée à un joueur sans rôle (403)", sansRole.status === 403, `code ${sansRole.status}`);

  const sansRoleKyc = await api(`/api/admin/kyc/${dossier.json.caseId}/approve`, { method: "POST", token: A, body: {} });
  check("revue KYC refusée à un joueur sans rôle (403)", sansRoleKyc.status === 403, JSON.stringify(sansRoleKyc.json));

  /* L'administrateur est un AUTRE compte : on ne valide pas son propre dossier. */
  const autoAdmin = await api("/api/kyc/submit", { method: "POST", token: users.Admin.token,
    body: { recto: KYCX.recto(), verso: KYCX.verso() } });
  check("le compte administrateur peut déposer son propre dossier", autoAdmin.status === 200, JSON.stringify(autoAdmin.json));
  const autoAdminApprove = await api(`/api/admin/kyc/${autoAdmin.json.caseId}/approve`,
    { method: "POST", token: users.Admin.token, body: {} });
  check("un administrateur ne peut pas valider SA propre identité (403 SELF_APPROVAL)",
    autoAdminApprove.status === 403, JSON.stringify(autoAdminApprove.json));

  /* Un nouvel envoi REMPLACE le dossier ouvert (un seul dossier ouvert/joueur) :
     deux envois de plus, puis le quatrième de la journée est refusé. */
  const r1 = await api("/api/kyc/submit", { method: "POST", token: users.Admin.token,
    body: { recto: KYCX.verso(), verso: KYCX.recto() } });
  const r2 = await api("/api/kyc/submit", { method: "POST", token: users.Admin.token,
    body: { recto: KYCX.recto(), verso: KYCX.verso() } });
  const r4 = await api("/api/kyc/submit", { method: "POST", token: users.Admin.token,
    body: { recto: KYCX.recto(), verso: KYCX.verso() } });
  check("un nouvel envoi remplace le dossier en cours (toujours un seul ouvert)",
    r1.status === 200 && r2.status === 200 && r1.json.caseId !== r2.json.caseId, JSON.stringify([r1.json, r2.json]));
  check("4e envoi en 24 h -> 429 TROP_DE_SOUMISSIONS",
    r4.status === 429 && r4.json.code === "TROP_DE_SOUMISSIONS", JSON.stringify(r4.json));

  const appro = await api(`/api/admin/kyc/${dossier.json.caseId}/approve`,
    { method: "POST", token: users.Admin.token, body: {} });
  check("approbation par un administrateur -> dossier vérifié",
    appro.status === 200 && appro.json.status === "verified", JSON.stringify(appro.json));
  const after = await api("/api/user", { token: A });
  check("KYC visible dans le profil après approbation",
    after.json.user.kyc === true && after.json.user.kyc_status === "verified",
    JSON.stringify({ kyc: after.json.user.kyc, statut: after.json.user.kyc_status }));

  /* La pièce n'est lisible que par la route d'administration auditée, jamais par
     le serveur de fichiers : `private/kyc` n'est pas servi. */
  const fuite = await fetch(BASE + "/private/kyc/1/recto.png");
  check("les pièces d'identité ne sont pas servies par le serveur statique (404)",
    fuite.status === 404, "code " + fuite.status);

  /* Efa sert de compte sans KYC pour les scénarios suivants : on ne lui laisse
     qu'un solde faible (retrait autorisé sans KYC par le serveur — voir note). */
  const w = await api("/api/withdraw", { method: "POST", body: { amount: 4000, operator: "MVola" }, token: E });
  note("retrait sans KYC : le serveur l'accepte (code " + w.status + ") alors que le PRD exige un KYC pour toute transaction réelle.");
}

/* =========================================================
   PHASE 5bis — Espace d'administration : droits, modules, pubs, comptabilité
   ---------------------------------------------------------
   Ce que cette phase prouve, et qui ne se voit pas à l'œil :
     · un joueur SANS rôle n'entre pas (401/403), et un rôle ne donne que ce
       qu'il doit donner (observateur : lecture, pas d'écriture) ;
     · le module éteint refuse TOUT LE MONDE, super-administrateur compris ;
     · une bannière désactivée disparaît de l'API publique sans être supprimée ;
     · la comptabilité ne calcule rien d'inventé : elle relit `transactions` ;
     · toute action sensible laisse une trace dans `admin_audit`.
   ========================================================= */
async function phaseAdministration() {
  section("5bis. Espace d'administration");
  const ADM = users.Admin.token, A = users.Ari.token, E = users.Efa.token;

  const me = await api("/api/admin/me", { token: ADM });
  check("/api/admin/me expose le rôle et les permissions du super administrateur",
    me.status === 200 && me.json.roles.includes("super_admin") && me.json.permissions.includes("kyc.review"),
    JSON.stringify({ roles: me.json && me.json.roles, n: me.json && me.json.permissions && me.json.permissions.length }));

  const noRole = await api("/api/admin/me", { token: A });
  check("/api/admin/me refusé sans rôle (403)", noRole.status === 403, `code ${noRole.status}`);

  const anon = await api("/api/admin/me");
  check("/api/admin/me refuse aussi sans session (401)", anon.status === 401, `code ${anon.status}`);

  /* ---------- Publicités ---------- */
  const pubs = await api("/api/admin/ads", { token: ADM });
  check("les bannières existantes sont reprises (au moins 2, dont Yas)",
    pubs.status === 200 && pubs.json.ads.length >= 2 && pubs.json.ads.some((a) => /yas/i.test(a.slug || a.image)),
    JSON.stringify(pubs.json && pubs.json.ads && pubs.json.ads.map((a) => a.slug)));

  const created = await api("/api/admin/ads", { method: "POST", token: ADM,
    body: { titre: "Campagne scénarios", image: "assets/ad/d-aona-maison.svg", lien: "https://example.mg", ordre: 9 } });
  check("création d'une bannière par l'administration",
    created.status === 200 && !!created.json.ad && created.json.ad.actif === true, JSON.stringify(created.json));

  const activeAfterCreate = await api("/api/ads/active", { token: A });
  check("la nouvelle bannière apparaît dans le carrousel public",
    activeAfterCreate.status === 200 && activeAfterCreate.json.pubs.some((p) => p.id === created.json.ad.id),
    JSON.stringify(activeAfterCreate.json.pubs && activeAfterCreate.json.pubs.map((p) => p.id)));

  const off = await api(`/api/admin/ads/${created.json.ad.id}`, { method: "POST", token: ADM, body: { actif: false } });
  const activeAfterOff = await api("/api/ads/active", { token: A });
  check("désactiver une bannière la retire du carrousel SANS la supprimer",
    off.status === 200 && off.json.ad.actif === false &&
    !activeAfterOff.json.pubs.some((p) => p.id === created.json.ad.id), JSON.stringify(activeAfterOff.json.pubs));

  const badImage = await api("/api/admin/ads", { method: "POST", token: ADM,
    body: { titre: "Injection", image: "../../etc/passwd" } });
  check("chemin d'image hors de assets/ refusé (400)", badImage.status === 400, JSON.stringify(badImage.json));

  const del = await api(`/api/admin/ads/${created.json.ad.id}`, { method: "DELETE", token: ADM });
  check("suppression d'une bannière par l'administration", del.status === 200 && del.json.ok === true, JSON.stringify(del.json));

  /* ---------- Comptabilité ---------- */
  const acc = await api("/api/admin/accounting", { token: ADM });
  check("comptabilité : totaux cohérents avec les transactions de la campagne",
    acc.status === 200 && acc.json.totals.out.amount > 0 && acc.json.players.total > 0 &&
    Array.isArray(acc.json.byKind) && acc.json.byKind.some((k) => k.key === "deposit"),
    JSON.stringify({ totals: acc.json && acc.json.totals, players: acc.json && acc.json.players }));

  const csv = await fetch(BASE + "/api/admin/accounting?format=csv", { headers: { Authorization: "Bearer " + ADM } });
  /* Les OCTETS, pas le texte : `Response.text()` retire le BOM en décodant, or
     c'est justement le BOM qui fait ouvrir le fichier correctement par Excel. */
  const csvBuf = Buffer.from(await csv.arrayBuffer());
  const csvText = csvBuf.toString("utf8");
  check("export CSV de la comptabilité : type CSV, BOM UTF-8 et en-tête français",
    csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") &&
    csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf &&
    /"Date";"Heure";"Opération";"Type";"Moyen";"Statut"/.test(csvText),
    "code " + csv.status + " · " + csvText.slice(0, 60));

  const csvNoAuth = await fetch(BASE + "/api/admin/accounting?format=csv");
  check("export CSV sans session -> 401", csvNoAuth.status === 401, "code " + csvNoAuth.status);

  /* ---------- Joueurs, Elo, badges (lecture) ---------- */
  const search = await api(`/api/admin/users?q=${users.Ari.pseudo}`, { token: ADM });
  check("recherche d'un joueur par pseudo depuis le back-office",
    search.status === 200 && search.json.users.length === 1 && search.json.users[0].kyc_status === "verified",
    JSON.stringify(search.json.users && search.json.users.map((u) => [u.pseudo, u.kyc_status])));

  const elo = await api("/api/admin/elo", { token: ADM });
  const badges = await api("/api/admin/badges", { token: ADM });
  check("Elo et badges : instantanés en lecture seule, cohérents",
    elo.status === 200 && elo.json.stats.players > 0 && elo.json.bands.length === 4 &&
    badges.status === 200 && badges.json.badges.length === 6,
    JSON.stringify({ joueurs: elo.json && elo.json.stats && elo.json.stats.players,
      badges: badges.json && badges.json.badges && badges.json.badges.length }));

  /* ---------- Rôles, modules, attributions ---------- */
  const roles = await api("/api/admin/roles", { token: ADM });
  check("catalogue des rôles livré avec leurs droits",
    roles.status === 200 && roles.json.roles.length === 7 &&
    roles.json.roles.find((r) => r.id === "super_admin").protected === true &&
    roles.json.roles.find((r) => r.id === "marketing").rights.campaigns.delete === true,
    JSON.stringify(roles.json.roles && roles.json.roles.map((r) => r.id)));

  const protect = await api("/api/admin/roles/super_admin", { method: "POST", token: ADM,
    body: { changes: [{ module: "campaigns", action: "delete", allowed: false }] } });
  check("le rôle protégé n'est pas modifiable (409 ROLE_PROTEGE)",
    protect.status === 409 && protect.json.code === "ROLE_PROTEGE", JSON.stringify(protect.json));

  const grant = await api("/api/admin/assignments", { method: "POST", token: ADM,
    body: { pseudo: users.Efa.pseudo, role: "observer" } });
  check("attribution du rôle « observateur » à un joueur", grant.status === 200 && grant.json.roles.includes("observer"),
    JSON.stringify(grant.json));

  const viewerRead = await api("/api/admin/ads", { token: E });
  const viewerWrite = await api("/api/admin/ads", { method: "POST", token: E,
    body: { titre: "Observateur", image: "assets/ad/d-aona-maison.svg" } });
  check("un observateur LIT mais n'ÉCRIT pas (403 sur la création)",
    viewerRead.status === 200 && viewerWrite.status === 403,
    JSON.stringify({ lecture: viewerRead.status, ecriture: viewerWrite.status }));

  const revoke = await api("/api/admin/assignments", { method: "POST", token: ADM,
    body: { pseudo: users.Efa.pseudo, role: "observer", action: "revoke" } });
  const afterRevoke = await api("/api/admin/ads", { token: E });
  check("le rôle retiré ferme immédiatement l'accès (403)",
    revoke.status === 200 && afterRevoke.status === 403, `code ${afterRevoke.status}`);

  const offModule = await api("/api/admin/modules/campaigns", { method: "POST", token: ADM, body: { enabled: false } });
  const modClosed = await api("/api/admin/ads", { token: ADM });
  check("module « publicités » éteint : refus pour TOUT LE MONDE, super-admin compris",
    offModule.status === 200 && modClosed.status === 403 && modClosed.json.code === "MODULE_DESACTIVE",
    JSON.stringify(modClosed.json));
  await api("/api/admin/modules/campaigns", { method: "POST", token: ADM, body: { enabled: true } });
  const modBack = await api("/api/admin/ads", { token: ADM });
  check("module rallumé : l'accès revient", modBack.status === 200, `code ${modBack.status}`);

  /* Les modules SOCLES portent la capacité de se gouverner : les éteindre
     laisserait le back-office sans moyen de se rallumer. Le refus est un 409
     explicite, pas un 403 (ce n'est pas un droit qui manque). */
  const coreOff = await api("/api/admin/modules/roles", { method: "POST", token: ADM, body: { enabled: false } });
  check("un module socle refuse d'être éteint (409 MODULE_SOCLE)",
    coreOff.status === 409 && coreOff.json.code === "MODULE_SOCLE", JSON.stringify(coreOff.json));
  const coreStill = await api("/api/admin/roles", { token: ADM });
  check("le module socle reste allumé après le refus", coreStill.status === 200, `code ${coreStill.status}`);

  /* ---------- Retraits : demande -> instruction -> paiement ----------
     Le parcours complet, dans l'ordre où un opérateur le vit. Ce que cette
     série prouve et qui ne se voit pas à l'œil : le refus exige un motif, le
     paiement exige une référence de transfert, et le BONUS n'est jamais
     consommé par un retrait (il n'est pas retirable). */
  const wq = await api("/api/admin/withdrawals?status=pending", { token: ADM });
  const wPending = (wq.json && wq.json.withdrawals || [])[0];
  check("le back-office voit la demande de retrait en attente",
    wq.status === 200 && !!wPending && wPending.amount === 12000 && wPending.method === "MVola" &&
    wPending.phone === "0341234567" && !!wPending.pseudo,
    JSON.stringify(wq.json && wq.json.withdrawals));

  const wNoReason = wPending ? await api(`/api/admin/withdrawals/${wPending.id}/review`,
    { method: "POST", token: ADM, body: { decision: "reject" } }) : { status: 0, json: {} };
  check("un refus de retrait sans motif est refusé (400 MOTIF_MANQUANT)",
    wNoReason.status === 400 && wNoReason.json.code === "MOTIF_MANQUANT", JSON.stringify(wNoReason.json));

  const wApprove = wPending ? await api(`/api/admin/withdrawals/${wPending.id}/review`,
    { method: "POST", token: ADM, body: { decision: "approve" } }) : { status: 0, json: {} };
  check("une demande peut être approuvée",
    wApprove.status === 200 && wApprove.json.request && wApprove.json.request.status === "approved",
    JSON.stringify(wApprove.json));

  const wNoRef = wPending ? await api(`/api/admin/withdrawals/${wPending.id}/pay`,
    { method: "POST", token: ADM, body: {} }) : { status: 0, json: {} };
  check("un paiement sans référence de transfert est refusé (400 REFERENCE_MANQUANTE)",
    wNoRef.status === 400 && wNoRef.json.code === "REFERENCE_MANQUANTE", JSON.stringify(wNoRef.json));

  const wPay = wPending ? await api(`/api/admin/withdrawals/${wPending.id}/pay`,
    { method: "POST", token: ADM, body: { reference: "PAIEMENT-ADM-001" } }) : { status: 0, json: {} };
  check("le paiement clôt la demande avec sa référence",
    wPay.status === 200 && wPay.json.request && wPay.json.request.status === "paid" &&
    wPay.json.request.reference === "PAIEMENT-ADM-001", JSON.stringify(wPay.json));

  const afterPay = await api("/api/user", { token: A });
  check("après paiement : 12 000 Ar débités, bonus de 1 000 Ar INTACT",
    afterPay.json.user.balance === 1000 && afterPay.json.user.bonus_lock === 1000 &&
    afterPay.json.user.reserved === 1000 && afterPay.json.user.withdrawable === 0,
    JSON.stringify(afterPay.json.user));

  const wTx = await api("/api/transactions", { token: A });
  check("le grand livre porte le paiement et sa référence",
    wTx.json.transactions.some((t) => /Retrait MVola · PAIEMENT-ADM-001/.test(t.label || "")),
    JSON.stringify(wTx.json.transactions.slice(0, 3)));

  const wPaidTwice = wPending ? await api(`/api/admin/withdrawals/${wPending.id}/review`,
    { method: "POST", token: ADM, body: { decision: "reject", reason: "déjà payée" } }) : { status: 0, json: {} };
  check("une demande payée ne peut plus être instruite (409 ETAT_INVALIDE)",
    wPaidTwice.status === 409 && wPaidTwice.json.code === "ETAT_INVALIDE", JSON.stringify(wPaidTwice.json));

  /* ---------- Règles métier de la RÉFÉRENCE (§2 du cahier des charges) ----------
     Chacune de ces règles est mesurée, pas supposée : elles viennent du
     golden file `reference/REFERENCE-DEMO.json` et du plan de comparaison. */
  const rolesApi = await api("/api/admin/roles", { token: ADM });
  const matrix = rolesApi.json.roles || [];
  const allowedCount = (id) => {
    const r = matrix.find((x) => x.id === id);
    if (!r) return -1;
    return Object.values(r.rights || {})
      .reduce((s, acts) => s + Object.values(acts || {}).filter(Boolean).length, 0);
  };
  check("matrice de permissions : 15 modules × 6 actions × 7 rôles = 630 lignes",
    matrix.length === 7 && allowedCount("super_admin") === 90 && allowedCount("admin") === 70 &&
    allowedCount("observer") === 15 && allowedCount("finance") === 6 && allowedCount("tournaments") === 11,
    `super=${allowedCount("super_admin")} admin=${allowedCount("admin")} obs=${allowedCount("observer")} ` +
    `fin=${allowedCount("finance")} tour=${allowedCount("tournaments")}`);

  const adminRole = matrix.find((r) => r.id === "admin") || { rights: {} };
  const adminOnRoles = Object.values(adminRole.rights.roles || {}).filter(Boolean).length;
  check("l'administrateur n'a AUCUN droit sur les rôles (comme la référence)",
    adminOnRoles === 0, adminOnRoles + " droit(s) sur roles");

  /* Capacité d'un bracket : PUISSANCE DE 2, pas seulement « pair ». */
  const cap6 = await api("/api/admin/tournaments", { method: "POST", token: ADM,
    body: { name: "Capacité invalide", format: "rapide", entry: 0, maxPlayers: 6,
      startsAt: new Date(Date.now() + 6 * 3600000).toISOString() } });
  check("capacité de tournoi hors puissance de 2 refusée (6)",
    cap6.status === 400 && /puissance de 2/i.test(cap6.json.error || ""), JSON.stringify(cap6.json));

  /* Barème de badges : partition 1 -> ∞, sans trou ni chevauchement. */
  const gapBadges = await api("/api/admin/badges", { method: "POST", token: ADM,
    body: { badges: [{ name: "Rang A", minRank: 1, maxRank: 2 }, { name: "Rang B", minRank: 5, maxRank: null }] } });
  check("badges : un TROU dans le barème est refusé (400 INTERVALLE_INVALIDE)",
    gapBadges.status === 400 && gapBadges.json.code === "INTERVALLE_INVALIDE", JSON.stringify(gapBadges.json));

  /* Un litige OUVERT interdit de valider le résultat (scénario S6 de l'oracle). */
  const finishedList = await api("/api/admin/matches?status=finished&limit=5", { token: ADM });
  const targetMatch = ((finishedList.json && finishedList.json.matches) || [])
    .find((m) => typeof m.id === "number");
  if (targetMatch) {
    const opened = await api("/api/admin/disputes", { method: "POST", token: ADM,
      body: { matchId: targetMatch.id, category: "Résultat contesté",
        reason: "Contestation de contrôle : vérification du classement." } });
    check("un litige peut être ouvert sur une partie terminée", opened.status === 200, JSON.stringify(opened.json));
    const blocked = await api(`/api/admin/matches/${targetMatch.id}/result`, { method: "POST", token: ADM,
      body: { decision: "confirm", reason: "Tentative de validation sous litige." } });
    check("un litige OUVERT bloque la validation du résultat (409 LITIGE_OUVERT)",
      blocked.status === 409 && blocked.json.code === "LITIGE_OUVERT", JSON.stringify(blocked.json));
  }

  /* Ouverture d'une pièce d'identité : lecture autorisée, mais JOURNALISÉE. */
  const kycAny = await api("/api/admin/kyc?status=verified&limit=1", { token: ADM });
  const anyCase = ((kycAny.json && kycAny.json.cases) || [])[0];
  if (anyCase) {
    const op = await api(`/api/admin/kyc/${anyCase.id}/open`, { method: "POST", token: ADM, body: {} });
    check("l'ouverture d'un dossier d'identité est acceptée",
      op.status === 200 && op.json.ok === true, JSON.stringify(op.json));
    const aud = await api("/api/admin/audit?limit=200", { token: ADM });
    check("le journal porte l'action kyc.open (ouverture tracée)",
      (aud.json.entries || []).some((e) => e.action === "kyc.open"),
      JSON.stringify((aud.json.entries || []).slice(0, 5).map((e) => e.action)));
  }

  /* ---------- Tournois ---------- */
  const tCreate = await api("/api/admin/tournaments", { method: "POST", token: ADM,
    body: { name: "Tournoi administration", format: "blitz", entry: 1000, maxPlayers: 4,
      startsAt: new Date(Date.now() + 3 * 3600000).toISOString() } });
  check("création d'un tournoi depuis le back-office",
    tCreate.status === 200 && tCreate.json.tournament && tCreate.json.tournament.status === "inscriptions",
    JSON.stringify(tCreate.json));

  const tId = tCreate.json.tournament && tCreate.json.tournament.id;
  const tOdd = await api("/api/admin/tournaments", { method: "POST", token: ADM,
    body: { name: "Bracket impair", format: "blitz", entry: 0, maxPlayers: 3,
      startsAt: new Date(Date.now() + 3 * 3600000).toISOString() } });
  check("bracket impair refusé (400) — le bracket exige un nombre pair",
    tOdd.status === 400, JSON.stringify(tOdd.json));

  const tCancel = await api(`/api/admin/tournaments/${tId}`, { method: "POST", token: ADM, body: { action: "cancel" } });
  const listAfter = await api("/api/admin/tournaments", { token: ADM });
  check("annulation d'un tournoi (aucun inscrit à rembourser)",
    tCancel.status === 200 && tCancel.json.status === "annule" &&
    listAfter.json.tournaments.find((t) => t.id === tId).status === "annule",
    JSON.stringify(tCancel.json));

  /* ---------- Journal ---------- */
  const audit = await api("/api/admin/audit?limit=200", { token: ADM });
  const actions = (audit.json && audit.json.entries || []).map((e) => e.action);
  check("le journal d'administration trace les actions ET les refus",
    audit.status === 200 && actions.includes("campaigns.create") && actions.includes("acces.refuse") &&
    actions.includes("roles.grant"),
    JSON.stringify(actions.slice(0, 12)));
}
// ZONE_PHASES
/* =========================================================
   PHASE 6 — Tournois : conditions d'accès, inscription, bracket
   ========================================================= */
async function phaseTournois() {
  section("6. Tournois");
  const A = users.Ari.token, B = users.Bema.token, C = users.Cora.token, D = users.Doda.token, E = users.Efa.token;

  /* 6.1 Conditions d'accès — le SYSTÈME DE RANG n'existe plus. La colonne
     `min_rank` reste en base (valeur historique « Or » sur TID2) mais ne
     conditionne plus l'inscription : c'est précisément ce que vérifie ce test —
     une valeur historique non vide ne doit plus bloquer personne. */
  const freeJoin = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID2 }, token: A });
  check("tournoi gratuit : plus aucune condition de rang, inscription acceptée (200)",
    freeJoin.status === 200, `code ${freeJoin.status} ${freeJoin.json && freeJoin.json.error}`);

  /* 6.1 bis — « Je participe » côté DONNÉES : la section lit `isRegistered`, donc
     l'entrée comme la sortie sont automatiques. On vérifie que la valeur entre à
     l'inscription, puis qu'un RETRAIT la fait basculer toute seule. */
  const mine = await api("/api/tournaments", { token: A });
  const myT2 = (mine.json.tournaments || []).find((x) => Number(x.id) === TID2);
  check("le tournoi rejoint « Je participe » : isRegistered = true pour l'inscrit",
    !!myT2 && myT2.isRegistered === true, JSON.stringify(myT2));

  const copy = new DatabaseSync(path.join(tmpDir, "d-aona.db"));
  const removed = copy.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ? AND user_id = ?").run(TID2, users.Ari.id);
  copy.close();
  const mine2 = await api("/api/tournaments", { token: A });
  const myT2b = (mine2.json.tournaments || []).find((x) => Number(x.id) === TID2);
  check("inscription retirée : isRegistered = false — la section se vide d'elle-même",
    removed.changes === 1 && !!myT2b && myT2b.isRegistered === false, JSON.stringify(myT2b));

  await api("/api/deposit", { method: "POST", body: { amount: 6000, operator: "MVola" }, token: D });
  const noKyc = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID }, token: D });
  check("tournoi payant sans KYC vérifié -> 403 KYC requis",
    noKyc.status === 403, `code ${noKyc.status} ${noKyc.json && noKyc.json.error}`);

  const broke = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID3 }, token: D });
  check("solde insuffisant pour la mise d'entrée (20 000 Ar) -> 400",
    broke.status === 400, `code ${broke.status} ${broke.json && broke.json.error}`);

  const ghostJoin = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: 987654 }, token: A });
  check("inscription à un tournoi inexistant -> 404", ghostJoin.status === 404, `code ${ghostJoin.status}`);

  /* 6.2 Inscription du 1er joueur (Ari : KYC fait). Son solde libre est à 0
     après le paiement de son retrait (seul le bonus de 1 000 Ar reste,
     verrouillé) : on le réalimente comme le ferait un joueur avant de
     s'inscrire — le montant du dépôt n'est pas l'objet de ce test. */
  await api("/api/deposit", { method: "POST", body: { amount: 10000, operator: "MVola" }, token: A });
  const beforeAri = await api("/api/user", { token: A });
  const join1 = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID }, token: A });
  check("inscription payante acceptée", join1.status === 200, JSON.stringify(join1.json));
  const afterAri = await api("/api/user", { token: A });
  check("la mise d'entrée est débitée (5 000 Ar)",
    afterAri.json.user.balance === beforeAri.json.user.balance - 5000,
    `${beforeAri.json.user.balance} -> ${afterAri.json.user.balance}`);

  const join1bis = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID }, token: A });
  check("double inscription -> refusée (Deja inscrit)", join1bis.status === 400, `code ${join1bis.status}`);

  const nAfterJoin = await api("/api/notifications", { token: A });
  check("notification « inscription » créée au moment de l'inscription",
    nAfterJoin.json.notifications.some((n) => n.type === "inscription" && n.payload.text.includes("Tournoi Scénarios")),
    JSON.stringify(nAfterJoin.json.notifications.map((n) => n.type)));

  const regs1 = await api("/api/tournaments/" + TID, { token: A });
  check("Ari enregistré et visible dans le détail du tournoi",
    regs1.json.meRegistered === true && regs1.json.registrations.some((r) => r.pseudo === users.Ari.pseudo));

  /* 6.3 Les 3 autres joueurs complètent le tournoi */
  await verifyKyc(D);
  const joinDoda = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID }, token: D });
  check("inscription acceptée après vérification KYC", joinDoda.status === 200, JSON.stringify(joinDoda.json));

  for (const [who, label] of [[B, users.Bema.pseudo], [C, users.Cora.pseudo]]) {
    await api("/api/deposit", { method: "POST", body: { amount: 6000, operator: "MVola" }, token: who });
    await verifyKyc(who);
    const r = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID }, token: who });
    check(`inscription de ${label}`, r.status === 200, `code ${r.status} ${r.json && r.json.error}`);
  }

  const full = await api("/api/tournaments/join", { method: "POST", body: { tournamentId: TID }, token: E });
  check("tournoi complet (4/4) -> 5e inscription refusée",
    full.status === 400 && /complet/i.test(full.json.error || ""), `code ${full.status} ${full.json && full.json.error}`);
  return checkBracket();
}
/* =========================================================
   PHASE 7 — Boutique de skins : pions CLAIRS et pions SOMBRES
   ========================================================= */
async function phaseSkins() {
  section("7. Boutique de skins");
  const A = users.Ari.token, E = users.Efa.token;
  await api("/api/deposit", { method: "POST", body: { amount: 10000, operator: "MVola" }, token: A });

  const cat = await api("/api/skins", { token: A });
  const pions = cat.json.skins.filter((s) => s.kind === "pions");
  check("GET /api/skins : catalogue de 11 skins + possédés + équipés",
    cat.status === 200 && cat.json.skins.length === 11 && Array.isArray(cat.json.owned) && !!cat.json.equipped);
  check("chaque skin de pions annonce son TYPE (LIGHT / DARK)",
    pions.length === 8 && pions.every((s) => s.type === "LIGHT" || s.type === "DARK"),
    JSON.stringify(pions.map((s) => s.id + ":" + s.type)));
  check("les autres skins (plateau, effets) ne portent pas de type de pion",
    cat.json.skins.filter((s) => s.kind !== "pions").every((s) => !s.type));
  check("identifiants uniques ET prix individuel par skin",
    new Set(cat.json.skins.map((s) => s.id)).size === cat.json.skins.length && pions.every((s) => typeof s.price === "number"));
  check("les DEUX skins de pions gratuits sont possédés et équipés dès l'inscription",
    cat.json.owned.includes("pions-clair-classique") && cat.json.owned.includes("pions-sombre-classique")
    && cat.json.equipped.pions_light === "pions-clair-classique"
    && cat.json.equipped.pions_dark === "pions-sombre-classique",
    JSON.stringify({ owned: cat.json.owned, equipped: cat.json.equipped }));

  const ghost = await api("/api/skins/buy", { method: "POST", body: { skinId: "skin-inexistant" }, token: A });
  check("achat d'un skin inexistant -> 404", ghost.status === 404, `code ${ghost.status}`);

  const poor = await api("/api/skins/buy", { method: "POST", body: { skinId: "anim-flamme" }, token: E });
  check("achat sans solde suffisant -> 400", poor.status === 400, `code ${poor.status} ${poor.json && poor.json.error}`);

  const notOwned = await api("/api/skins/equip", { method: "POST", body: { skinId: "plateau-anosy" }, token: E });
  check("équiper un skin non possédé -> 403", notOwned.status === 403, `code ${notOwned.status}`);

  /* --- Achat d'un skin CLAIR : il ne débloque QUE celui-là --- */
  const b0 = await api("/api/user", { token: A });
  const buyLight = await api("/api/skins/buy", { method: "POST", body: { skinId: "pions-clair-dragon" }, token: A });
  check("achat d'un skin clair à 1 800 Ar -> débité",
    buyLight.status === 200 && buyLight.json.balance === b0.json.user.balance - 1800, JSON.stringify(buyLight.json));

  const afterLight = await api("/api/skins", { token: A });
  check("le skin clair acheté apparaît dans les skins possédés",
    afterLight.json.owned.includes("pions-clair-dragon"), JSON.stringify(afterLight.json.owned));
  check("l'achat d'un skin CLAIR ne débloque PAS la version sombre du thème",
    !afterLight.json.owned.includes("pions-sombre-ombres") && !afterLight.json.owned.includes("pions-sombre-emeraude"),
    JSON.stringify(afterLight.json.owned));

  const buyAgain = await api("/api/skins/buy", { method: "POST", body: { skinId: "pions-clair-dragon" }, token: A });
  check("rachat d'un skin déjà possédé -> refusé (pas de double débit)",
    buyAgain.status === 400, `code ${buyAgain.status} ${buyAgain.json && buyAgain.json.error}`);

  /* --- Achat du pendant SOMBRE : seconde transaction, second débit --- */
  const b1 = await api("/api/user", { token: A });
  const buyDark = await api("/api/skins/buy", { method: "POST", body: { skinId: "pions-sombre-ombres" }, token: A });
  check("le pendant sombre est un ACHAT SÉPARÉ (second débit, même prix)",
    buyDark.status === 200 && buyDark.json.balance === b1.json.user.balance - 1800, JSON.stringify(buyDark.json));

  /* --- Compatibilité : un skin sombre ne va pas sur les pions clairs --- */
  const cross = await api("/api/skins/equip", { method: "POST", body: { skinId: "pions-sombre-ombres", slot: "pions_light" }, token: A });
  check("équiper un skin SOMBRE sur l'emplacement des pions clairs -> refusé (400)",
    cross.status === 400 && /incompatible/i.test(cross.json.error || ""), `code ${cross.status} ${cross.json && cross.json.error}`);
  const crossType = await api("/api/skins/equip", { method: "POST", body: { skinId: "pions-clair-dragon", type: "DARK" }, token: A });
  check("équiper un skin CLAIR en déclarant le type DARK -> refusé (400)",
    crossType.status === 400, `code ${crossType.status} ${crossType.json && crossType.json.error}`);
  const intact = await api("/api/skins", { token: A });
  check("un équipement refusé ne modifie AUCUN emplacement",
    intact.json.equipped.pions_light === "pions-clair-classique" && intact.json.equipped.pions_dark === "pions-sombre-classique",
    JSON.stringify(intact.json.equipped));

  /* --- Équipement normal : les deux emplacements coexistent --- */
  const eqLight = await api("/api/skins/equip", { method: "POST", body: { skinId: "pions-clair-dragon" }, token: A });
  check("équipement d'un skin clair possédé accepté, dans l'emplacement clair",
    eqLight.status === 200 && eqLight.json.slot === "pions_light", JSON.stringify(eqLight.json));
  const eqDark = await api("/api/skins/equip", { method: "POST", body: { skinId: "pions-sombre-ombres" }, token: A });
  check("équipement d'un skin sombre possédé accepté, dans l'emplacement sombre",
    eqDark.status === 200 && eqDark.json.slot === "pions_dark", JSON.stringify(eqDark.json));
  const afterEquip = await api("/api/skins", { token: A });
  check("les DEUX emplacements coexistent (un skin clair ET un skin sombre)",
    afterEquip.json.equipped.pions_light === "pions-clair-dragon"
    && afterEquip.json.equipped.pions_dark === "pions-sombre-ombres", JSON.stringify(afterEquip.json.equipped));
  check("plateau et effet équipés restent intacts après les achats de pions",
    afterEquip.json.equipped.plateau === cat.json.equipped.plateau
    && afterEquip.json.equipped.effet === cat.json.equipped.effet);
}

/* =========================================================
   PHASE 7bis — Apparence des pions : COULEUR × MOTIF, PAR CAMP
   ---------------------------------------------------------
   Deux axes indépendants (couleur, motif) et DEUX CAMPS ÉTANCHES : `light` (les
   pions du joueur) n'accepte que les couleurs claires, `dark` (les pions de
   l'adversaire) que les sombres. Le serveur valide chaque identifiant contre son
   catalogue, contrôle l'appartenance au groupe du camp et stocke `color` et
   `pattern` SÉPARÉMENT — une ligne par camp, aucune combinaison.
   ========================================================= */
async function phasePionStyle() {
  section("7bis. Apparence des pions (couleur × motif, deux camps)");
  const A = users.Ari.token, E = users.Efa.token;

  const cat = await api("/api/skins", { token: A });
  check("GET /api/skins expose les 16 couleurs et les 9 motifs",
    cat.status === 200 && Array.isArray(cat.json.colors) && cat.json.colors.length === 16
    && Array.isArray(cat.json.patterns) && cat.json.patterns.length === 9,
    `couleurs ${cat.json.colors && cat.json.colors.length}, motifs ${cat.json.patterns && cat.json.patterns.length}`);
  check("les couleurs sont réparties en 8 claires + 8 sombres",
    cat.json.colors.filter((c) => c.group === "clair").length === 8
    && cat.json.colors.filter((c) => c.group === "sombre").length === 8,
    JSON.stringify(cat.json.colors.reduce((a, c) => (a[c.group] = (a[c.group] || 0) + 1, a), {})));
  check("« Aucun motif » fait partie du catalogue (une couleur seule est utilisable)",
    cat.json.patterns.some((p) => p.id === "aucun"));
  check("les DEUX camps sont exposés, chacun rattaché à son groupe de couleurs",
    Array.isArray(cat.json.camps) && cat.json.camps.length === 2
    && cat.json.camps.find((c) => c.id === "light").group === "clair"
    && cat.json.camps.find((c) => c.id === "dark").group === "sombre",
    JSON.stringify(cat.json.camps));
  check("chaque compte part avec une apparence par camp (blanc clair / noir sombre)",
    cat.json.pionStyles && cat.json.pionStyles.light.color === "blanc"
    && cat.json.pionStyles.dark.color === "noir"
    && cat.json.pionStyles.light.pattern === "aucun" && cat.json.pionStyles.dark.pattern === "aucun",
    JSON.stringify(cat.json.pionStyles));
  check("`pionStyle` (compatibilité) reste l'apparence des pions DU JOUEUR",
    cat.json.pionStyle && cat.json.pionStyle.color === cat.json.pionStyles.light.color
    && cat.json.pionStyle.pattern === cat.json.pionStyles.light.pattern,
    JSON.stringify(cat.json.pionStyle));

  /* --- Camp clair : les deux axes se combinent librement --- */
  const set1 = await api("/api/pion/style", { method: "POST", body: { camp: "light", color: "rouge_clair", pattern: "lemurien" }, token: A });
  check("enregistrer les pions CLAIRS (rouge clair + lémurien) -> 200",
    set1.status === 200 && set1.json.pionStyles.light.color === "rouge_clair"
    && set1.json.pionStyles.light.pattern === "lemurien",
    JSON.stringify(set1.json));
  check("cet enregistrement n'a PAS touché le camp sombre",
    set1.json.pionStyles.dark.color === "noir" && set1.json.pionStyles.dark.pattern === "aucun",
    JSON.stringify(set1.json.pionStyles.dark));

  /* --- Camp sombre : même mécanique, autres couleurs --- */
  const set2 = await api("/api/pion/style", { method: "POST", body: { camp: "dark", color: "bleu_marine", pattern: "crocodile" }, token: A });
  check("enregistrer les pions SOMBRES (bleu marine + crocodile) -> 200",
    set2.status === 200 && set2.json.pionStyles.dark.color === "bleu_marine"
    && set2.json.pionStyles.dark.pattern === "crocodile",
    JSON.stringify(set2.json));
  check("les deux camps sont INDÉPENDANTS (le camp clair garde rouge clair + lémurien)",
    set2.json.pionStyles.light.color === "rouge_clair" && set2.json.pionStyles.light.pattern === "lemurien",
    JSON.stringify(set2.json.pionStyles.light));

  /* --- ÉTANCHÉITÉ : une couleur ne va que dans le camp de son groupe --- */
  const croise1 = await api("/api/pion/style", { method: "POST", body: { camp: "light", color: "noir", pattern: "aucun" }, token: A });
  check("couleur SOMBRE pour les pions clairs -> 400 (aucun mélange possible)",
    croise1.status === 400, `${croise1.status} ${croise1.json && croise1.json.error}`);
  const croise2 = await api("/api/pion/style", { method: "POST", body: { camp: "dark", color: "blanc", pattern: "aucun" }, token: A });
  check("couleur CLAIRE pour les pions sombres -> 400",
    croise2.status === 400, `${croise2.status} ${croise2.json && croise2.json.error}`);
  const campInconnu = await api("/api/pion/style", { method: "POST", body: { camp: "gauche", color: "blanc", pattern: "aucun" }, token: A });
  check("camp inconnu -> 400 (aucune écriture possible hors des deux camps)",
    campInconnu.status === 400, `${campInconnu.status} ${campInconnu.json && campInconnu.json.error}`);

  /* --- Identifiants inconnus : refusés, et rien n'est écrit --- */
  const ghostColor = await api("/api/pion/style", { method: "POST", body: { camp: "light", color: "rose_fluo", pattern: "aucun" }, token: A });
  check("couleur hors catalogue -> 400", ghostColor.status === 400, `${ghostColor.status} ${ghostColor.json && ghostColor.json.error}`);
  const ghostPattern = await api("/api/pion/style", { method: "POST", body: { camp: "dark", color: "noir", pattern: "dragon_de_komodo" }, token: A });
  check("motif hors catalogue -> 400", ghostPattern.status === 400, `${ghostPattern.status} ${ghostPattern.json && ghostPattern.json.error}`);
  const vide = await api("/api/pion/style", { method: "POST", body: {}, token: A });
  check("champs vides -> 400", vide.status === 400, `${vide.status}`);
  const apres = await api("/api/skins", { token: A });
  check("les six refus n'ont modifié AUCUN des deux camps",
    apres.json.pionStyles.light.color === "rouge_clair" && apres.json.pionStyles.light.pattern === "lemurien"
    && apres.json.pionStyles.dark.color === "bleu_marine" && apres.json.pionStyles.dark.pattern === "crocodile",
    JSON.stringify(apres.json.pionStyles));

  /* --- Compatibilité : un appel SANS camp écrit là où écrivait l'ancienne version --- */
  const sansCamp = await api("/api/pion/style", { method: "POST", body: { color: "jaune", pattern: "aucun" }, token: A });
  check("un appel SANS camp retombe sur les pions du joueur (compatibilité client)",
    sansCamp.status === 200 && sansCamp.json.camp === "light"
    && sansCamp.json.pionStyles.light.color === "jaune" && sansCamp.json.pionStyles.light.pattern === "aucun",
    JSON.stringify(sansCamp.json));

  /* --- Persistance et isolation par compte --- */
  const relu = await api("/api/skins", { token: A });
  check("les deux apparences sont persistées et relues séparément",
    relu.json.pionStyles.light.color === "jaune" && relu.json.pionStyles.light.pattern === "aucun"
    && relu.json.pionStyles.dark.color === "bleu_marine" && relu.json.pionStyles.dark.pattern === "crocodile",
    JSON.stringify(relu.json.pionStyles));
  const autre = await api("/api/skins", { token: E });
  check("l'apparence est PROPRE au compte (les deux camps de l'autre joueur sont intacts)",
    autre.json.pionStyles.light.color === "blanc" && autre.json.pionStyles.dark.color === "noir",
    JSON.stringify(autre.json.pionStyles));

  /* --- Une couleur seule (sans motif) reste un état valide --- */
  const seul = await api("/api/pion/style", { method: "POST", body: { camp: "dark", color: "grenat", pattern: "aucun" }, token: A });
  check("une couleur SANS motif est acceptée (le motif est optionnel)",
    seul.status === 200 && seul.json.pionStyles.dark.color === "grenat"
    && seul.json.pionStyles.dark.pattern === "aucun",
    JSON.stringify(seul.json));

  /* --- FORME du pion : ronde / carrée / triangulaire (migration 014) ---
     Troisième axe, indépendant des deux autres, validé par le même catalogue
     serveur. Le défaut est « ronde » — la silhouette d'avant, donc une base
     migrée ne change pas d'apparence. */
  check("GET /api/skins expose les 3 formes (ronde, carrée, triangulaire)",
    Array.isArray(cat.json.shapes) && cat.json.shapes.length === 3
    && ["ronde", "carree", "triangulaire"].every((id) => cat.json.shapes.some((s) => s.id === id)),
    JSON.stringify(cat.json.shapes));
  check("chaque camp démarre en forme RONDE (le pion d'avant la migration)",
    cat.json.pionStyles.light.shape === "ronde" && cat.json.pionStyles.dark.shape === "ronde",
    JSON.stringify(cat.json.pionStyles));
  const forme1 = await api("/api/pion/style", { method: "POST", body: { camp: "light", shape: "triangulaire", color: "jaune", pattern: "aucun" }, token: A });
  check("enregistrer une FORME pour les pions clairs (triangulaire) -> 200",
    forme1.status === 200 && forme1.json.pionStyles.light.shape === "triangulaire",
    JSON.stringify(forme1.json.pionStyles && forme1.json.pionStyles.light));
  check("la forme n'a pas touché le camp sombre",
    forme1.json.pionStyles.dark.shape === "ronde", JSON.stringify(forme1.json.pionStyles.dark));
  const forme2 = await api("/api/pion/style", { method: "POST", body: { camp: "dark", shape: "carree", color: "grenat", pattern: "aucun" }, token: A });
  check("enregistrer une FORME pour les pions sombres (carrée) -> 200",
    forme2.status === 200 && forme2.json.pionStyles.dark.shape === "carree"
    && forme2.json.pionStyles.light.shape === "triangulaire",
    JSON.stringify(forme2.json.pionStyles));
  const formeFantome = await api("/api/pion/style", { method: "POST", body: { camp: "light", shape: "losange", color: "jaune", pattern: "aucun" }, token: A });
  check("forme hors catalogue -> 400", formeFantome.status === 400, `${formeFantome.status} ${formeFantome.json && formeFantome.json.error}`);
  /* Compatibilité : un client d'avant la 014 (qui n'envoie que couleur et motif)
     ne doit pas REMETTRE la silhouette à zéro — elle est conservée. La couleur
     reste « jaune », celle que la phase du temps réel attend pour ce compte. */
  const sansForme = await api("/api/pion/style", { method: "POST", body: { camp: "light", color: "jaune", pattern: "aucun" }, token: A });
  check("un appel SANS forme CONSERVE la forme enregistrée (compatibilité client)",
    sansForme.status === 200 && sansForme.json.pionStyles.light.color === "jaune"
    && sansForme.json.pionStyles.light.shape === "triangulaire",
    JSON.stringify(sansForme.json.pionStyles && sansForme.json.pionStyles.light));
  const apresForme = await api("/api/skins", { token: A });
  check("les formes des deux camps sont persistées (et relues) séparément",
    apresForme.json.pionStyles.light.shape === "triangulaire" && apresForme.json.pionStyles.dark.shape === "carree",
    JSON.stringify(apresForme.json.pionStyles));
  const autreForme = await api("/api/skins", { token: E });
  check("la forme est PROPRE au compte (l'autre joueur reste en ronde)",
    autreForme.json.pionStyles.light.shape === "ronde" && autreForme.json.pionStyles.dark.shape === "ronde",
    JSON.stringify(autreForme.json.pionStyles));
  /* L'état de PARTIE porte la forme : le plateau se peint par propriétaire. */
  const etatPions = await api("/api/skins", { token: A });
  check("l'état d'apparence relayé au plateau contient les trois axes",
    ["shape", "color", "pattern"].every((k) => k in etatPions.json.pionStyles.light)
    && ["shape", "color", "pattern"].every((k) => k in etatPions.json.pionStyles.dark),
    JSON.stringify(etatPions.json.pionStyles));
}

/* =========================================================
   PHASE 8 — Notifications
   ========================================================= */
async function phaseNotifications() {
  section("8. Notifications");
  const A = users.Ari.token;
  const n = await api("/api/notifications", { token: A });
  check("historique de notifications non vide avec compteur de non-lus",
    n.json.notifications.length > 0 && n.json.unread > 0,
    `total ${n.json.notifications.length}, non-lus ${n.json.unread}`);
  check("notifications triées du plus récent au plus ancien",
    n.json.notifications.every((x, i, arr) => i === 0 || arr[i - 1].created_at >= x.created_at));
  check("types attendus couverts (inscription, tournoi_debut, confirmation_requise, confirmation, match_lance)",
    ["inscription", "tournoi_debut", "confirmation_requise", "confirmation", "match_lance"]
      .every((t) => n.json.notifications.some((x) => x.type === t)),
    JSON.stringify([...new Set(n.json.notifications.map((x) => x.type))]));
  check("chaque notification porte un texte lisible",
    n.json.notifications.every((x) => x.payload && typeof x.payload.text === "string" && x.payload.text.length > 0));

  const first = n.json.notifications.find((x) => !x.read) || n.json.notifications[0];
  const before = n.json.unread;
  const read1 = await api(`/api/notifications/${first.id}/read`, { method: "POST", token: A });
  const expected = first.read ? before : before - 1;
  check("marquer une notification comme lue décrémente le compteur",
    read1.status === 200 && read1.json.unread === expected, `${before} -> ${read1.json.unread}`);

  const all = await api("/api/notifications/read-all", { method: "POST", token: A });
  check("tout marquer comme lu -> compteur à 0", all.status === 200 && all.json.unread === 0, JSON.stringify(all.json));
  const n2 = await api("/api/notifications", { token: A });
  check("toutes les notifications sont lues après read-all",
    n2.json.unread === 0 && n2.json.notifications.every((x) => x.read === true));
}
/* =========================================================
   PHASE 9 — Temps réel : WebSocket, matchmaking, partie, spectateur
   ========================================================= */
async function phaseTempsReel() {
  section("9. Temps réel (WebSocket)");

  /* 9.1 Authentification WebSocket */
  const bad = wsClient("jeton-invalide-xyz");
  const badErr = await bad.wait((m) => m.type === "error", 6000);
  check("jeton invalide rejeté par le WebSocket", !!badErr, badErr ? badErr.message : "aucune erreur");
  bad.close();

  const a = wsClient(users.Ari.token), b = wsClient(users.Bema.token), e = wsClient(users.Efa.token);
  await Promise.all([a.ready, b.ready, e.ready]);
  await sleep(250);
  a.send({ type: "ping" });
  const pong = await a.wait((m) => m.type === "pong", 4000);
  check("ping -> pong (canal ouvert)", !!pong);

  /* 9.2 Matchmaking classé */
  a.send({ type: "find_match", format: "blitz", mode: "online" });
  const searching = await a.wait((m) => m.type === "matchmaking" && m.status === "searching", 5000);
  check("recherche de partie annoncée au 1er joueur en file", !!searching);
  b.send({ type: "find_match", format: "blitz", mode: "online" });
  const foundA = await a.wait((m) => m.type === "match_found", 6000);
  const foundB = await b.wait((m) => m.type === "match_found", 6000);
  check("match trouvé pour les deux joueurs", !!foundA && !!foundB, foundA ? "" : "Ari sans match");
  check("même partie des deux côtés (clé identique) et adversaires corrects",
    !!foundA && !!foundB && foundA.matchKey === foundB.matchKey &&
    foundA.opponent.pseudo === users.Bema.pseudo && foundB.opponent.pseudo === users.Ari.pseudo,
    foundA && foundB ? `${foundA.matchKey} / ${foundB.matchKey}` : "");

  /* 9.3 Acceptation puis tirage au sort */
  a.send({ type: "accept_match", matchKey: foundA.matchKey });
  b.send({ type: "accept_match", matchKey: foundA.matchKey });
  const startA = await a.wait((m) => m.type === "game_start", 8000);
  const startB = await b.wait((m) => m.type === "game_start", 8000);
  check("la partie démarre chez les deux joueurs", !!startA && !!startB);
  check("plateau initial complet transmis : 44 pions (22 par joueur), 5 lignes x 9 colonnes",
    !!startA && startA.state.grid.length === 5 && startA.state.grid[0].length === 9 &&
    startA.state.grid.flat().filter(Boolean).length === 44,
    startA ? `${startA.state.grid.flat().filter(Boolean).length} pions` : "");
  check("phase de tirage au sort au démarrage", !!startA && startA.state.phase === "choose", startA && startA.state.phase);
  const sid = startA && startA.sessionId;
  /* Rôles réels : le serveur attribue « joueur 1 » au SECOND joueur entré en
     file (handleWsMessage → find_match). On lit donc playerNum au lieu de
     présumer qu'Ari (socket « a ») est joueur 1. */
  const aNum = startA && startA.playerNum, bNum = startB && startB.playerNum;
  check("numéros de joueurs distincts attribués (1 et 2)",
    !!aNum && !!bNum && aNum !== bNum && [aNum, bNum].sort().join("") === "12", `${aNum} / ${bNum}`);
  const wsP1 = aNum === 1 ? a : b, wsP2 = aNum === 1 ? b : a;

  /* 9.3bis — Les apparences de pions des DEUX comptes voyagent avec l'état. Le
     plateau se peint par PROPRIÉTAIRE (mes skins ne doivent pas habiller les pions
     de l'adversaire) : le client a donc besoin des DEUX, et l'état est le seul
     endroit où celle de l'adversaire existe. Les deux comptes ont des apparences
     DIFFÉRENTES (voir 7bis : Ari = jaune / grenat, Bema = les pions Vato) : si
     l'état n'en portait qu'une, elle serait forcément fausse pour l'autre joueur —
     c'est exactement ce que le test rend impossible. */
  const appAri = { light: "jaune", dark: "grenat" }, appVato = { light: "blanc", dark: "noir" };
  const att1 = aNum === 1 ? appAri : appVato, att2 = aNum === 1 ? appVato : appAri;
  const stP1 = startA && startA.state.player1, stP2 = startA && startA.state.player2;
  const lire = (p) => (p && p.pionStyles
    ? `${p.pionStyles.light.color}/${p.pionStyles.dark.color}` : "absent");
  const meme = (p, att) => !!p && !!p.pionStyles
    && p.pionStyles.light.color === att.light && p.pionStyles.dark.color === att.dark;
  check("l'état du match porte les apparences de pions des DEUX joueurs",
    meme(stP1, att1) && meme(stP2, att2),
    `joueur 1 = ${lire(stP1)} (attendu ${att1.light}/${att1.dark}) · ` +
    `joueur 2 = ${lire(stP2)} (attendu ${att2.light}/${att2.dark})`);
  /* Chaque joueur garde la SIENNE jusque dans l'état diffusé aux deux : c'est ce
     qui permet au plateau de peindre deux propriétaires distincts. */
  check("chaque joueur garde SON apparence dans l'état (aucune ne sert l'autre)",
    !!stP1 && !!stP2 && stP1.pionStyles && stP2.pionStyles &&
    stP1.pionStyles.light.color !== stP2.pionStyles.light.color &&
    stP1.pionStyles.dark.color !== stP2.pionStyles.dark.color,
    `clair : ${lire(stP1)} vs ${lire(stP2)}`);
  /* Le MÊME état part vers les deux joueurs — apparences comprises : le plateau ne
     peut donc pas diverger entre les deux écrans, et aucun des deux ne reçoit
     l'apparence de l'autre à la place de la sienne. */
  const stB = startB && startB.state;
  check("les deux joueurs reçoivent le même état, apparences comprises",
    !!stB && JSON.stringify(stB.player1) === JSON.stringify(startA.state.player1) &&
    JSON.stringify(stB.player2) === JSON.stringify(startA.state.player2),
    stB ? `J1 ${lire(stB.player1)} · J2 ${lire(stB.player2)}` : "aucun game_start");

  wsP1.send({ type: "pick_side", sessionId: sid, side: "pile" });
  const picked = await wsP1.wait((m) => m.type === "game_state" && m.state.choices && m.state.choices["1"] === "pile", 5000);
  check("le choix de face du joueur 1 est enregistré", !!picked);

  wsP2.send({ type: "pick_side", sessionId: sid, side: "pile" });
  const forcedB = await wsP2.wait((m) => m.type === "error" && /prise/i.test(m.message || ""), 5000);
  check("choisir la face déjà prise par l'adversaire -> refusée (face restante imposée)", !!forcedB,
    forcedB ? forcedB.message : "aucune erreur");

  wsP2.send({ type: "pick_side", sessionId: sid, side: "face" });
  const playA = await a.wait((m) => m.type === "game_state" && m.state.phase === "play", 6000);
  const playB = await b.wait((m) => m.type === "game_state" && m.state.phase === "play", 6000);
  check("les deux faces posées -> la pièce est lancée, la partie commence", !!playA && !!playB);
  check("le tirage désigne le joueur qui commence",
    !!playA && !!playA.state.toss && (playA.state.turn === 1 || playA.state.turn === 2),
    playA ? JSON.stringify(playA.state.toss) : "");
  /* 9.4 Coups : refus d'un coup illégal, acceptation d'un coup légal */
  const st = playA.state;
  const turn = st.turn;
  const meWs = turn === 1 ? wsP1 : wsP2, otherWs = turn === 1 ? wsP2 : wsP1;
  meWs.send({ type: "move", sessionId: sid, move: { from: [0, 0], to: [0, 0], dir: [0, 0], kind: "paika", cap: [] } });
  const badRes = await meWs.wait((m) => m.type === "error" && /invalide/i.test(m.message || ""), 5000);
  check("coup illégal refusé par le serveur", !!badRes, badRes ? badRes.message : "aucune erreur");

  const legal = legalMoves(st.grid, turn, null);
  check("le plateau initial comporte des coups légaux", legal.length > 0, `${legal.length} coups légaux`);
  meWs.send({ type: "move", sessionId: sid, move: legal[0] });
  const after = await meWs.wait((m) => m.type === "game_state" && (m.state.moves || []).length === 1, 6000);
  check("coup légal accepté", !!after, after ? `type ${legal[0].kind}` : "aucun état reçu");
  const mirror = await otherWs.wait((m) => m.type === "game_state" && (m.state.moves || []).length === 1, 4000);
  check("l'état est diffusé à l'adversaire, identique",
    !!mirror && !!after && JSON.stringify(mirror.state.grid) === JSON.stringify(after.state.grid));

  /* 9.4b Anti-triche : on ne joue que pendant SON tour. Le « mauvais » joueur
     envoie un coup pourtant légal de la position — il doit être refusé et
     aucun coup ne doit être appliqué. */
  if (after && after.state.turn) {
    const chAfter = after.state.chain
      ? { pos: after.state.chain.pos, visited: new Set(after.state.chain.visited), lastDir: after.state.chain.lastDir }
      : null;
    const legalAfter = legalMoves(after.state.grid, after.state.turn, chAfter);
    if (legalAfter.length) {
      const wrongWs = after.state.turn === 1 ? wsP2 : wsP1;
      const movesBefore = (after.state.moves || []).length;
      wrongWs.send({ type: "move", sessionId: sid, move: legalAfter[0] });
      const refused = await wrongWs.wait((m) => m.type === "error" && /votre tour/i.test(m.message || ""), 5000);
      check("un joueur qui joue hors de son tour est refusé", !!refused, refused ? refused.message : "aucune erreur");
      const applied = await wrongWs.wait((m) => m.type === "game_state" && (m.state.moves || []).length > movesBefore, 1200);
      check("aucun coup n'est appliqué par le joueur hors tour", !applied);
    }
  }

  if (after && after.state.chain) {
    meWs.send({ type: "end_chain", sessionId: sid });
    const ended = await meWs.wait((m) => m.type === "game_state" && !m.state.chain, 5000);
    check("fin de prise en chaîne -> la main passe à l'adversaire", !!ended);
  }

  /* 9.5 Mode spectateur */
  e.send({ type: "spectate", sessionId: sid });
  const spec = await e.wait((m) => m.type === "spectate_state", 6000);
  check("un spectateur reçoit l'état du match en direct", !!spec, spec ? "" : "aucun état reçu");
  /* Le spectateur ne peut connaître AUCUNE des deux apparences par lui-même (il
     n'est ni l'un ni l'autre joueur) : l'état doit les porter, sinon son plateau
     peindrait les deux camps avec sa propre apparence — la fuite, en pire. */
  check("l'état du spectateur porte les apparences des deux joueurs du match",
    !!spec && !!spec.state.player1 && !!spec.state.player2 &&
    !!spec.state.player1.pionStyles && !!spec.state.player2.pionStyles &&
    spec.state.player1.pionStyles.light.color !== spec.state.player2.pionStyles.light.color,
    spec ? `${lire(spec.state.player1)} vs ${lire(spec.state.player2)}` : "aucun état");
  a.send({ type: "spectate", sessionId: sid });
  const selfSpec = await a.wait((m) => m.type === "error" && /joueur de ce match/i.test(m.message || ""), 5000);
  check("un joueur du match ne peut pas le spectater", !!selfSpec, selfSpec ? selfSpec.message : "aucune erreur");

  /* 9.5b Reprendre le visionnage (bouton « Reprendre » → « Regarder »).
     Le client quitte le plateau (changement d'onglet) : l'abonnement survit, et
     un nouveau « spectate » — ce qu'envoie resumeWatching() — doit renvoyer un
     état FRAIS sans créer de doublon.
     On compte les états reçus (et non le premier présent dans la boîte) : un
     simple rappel du message précédent ne doit pas suffire à valider le test. */
  const specBefore = e.inbox.filter((m) => m.type === "spectate_state").length;
  e.send({ type: "spectate", sessionId: sid });
  await sleep(500);
  const specAfter = e.inbox.filter((m) => m.type === "spectate_state").length;
  check("reprendre le visionnage renvoie un état frais",
    specAfter > specBefore, `${specBefore} état(s) avant, ${specAfter} après`);
  const lastState = e.inbox.filter((m) => m.type === "spectate_state").pop();
  check("l'état renvoyé contient bien le plateau et les joueurs",
    !!lastState && !!lastState.state && !!lastState.state.grid && !!lastState.state.player1);

  /* Arrêt explicite (« Arrêter de regarder ») puis reprise : on doit pouvoir
     partir ET revenir. */
  e.send({ type: "unspectate", sessionId: sid });
  await sleep(150);
  const specResume = e.inbox.filter((m) => m.type === "spectate_state").length;
  e.send({ type: "spectate", sessionId: sid });
  await sleep(500);
  check("après arrêt explicite puis reprise, l'état revient",
    e.inbox.filter((m) => m.type === "spectate_state").length > specResume);

  const live = await api("/api/games/live", { token: users.Ari.token });
  check("GET /api/games/live expose le match en cours aux connaissances",
    (live.json.live || []).some((l) => l.sessionId === sid),
    JSON.stringify((live.json.live || []).map((l) => l.sessionId)));

  /* 9.5a Le fil « En direct » annonce les pions restants de chaque camp : c'est
     la seule mesure de « score » que le serveur puisse prouver (aucun compteur de
     manches n'existe). On la confronte au plateau réellement reçu par le
     spectateur — même état, donc mêmes pions, sinon l'écran mentirait. */
  const vuEnDirect = (live.json.live || []).find((l) => l.sessionId === sid);
  const pions = (grid, qui) => (grid || []).flat().filter((v) => v === qui).length;
  check("le fil en direct annonce les pions restants des deux camps",
    !!vuEnDirect && Number.isInteger(vuEnDirect.pieces1) && Number.isInteger(vuEnDirect.pieces2) &&
    vuEnDirect.pieces1 >= 0 && vuEnDirect.pieces2 >= 0 && vuEnDirect.pieces1 + vuEnDirect.pieces2 <= 44,
    vuEnDirect ? `annoncé ${vuEnDirect.pieces1} / ${vuEnDirect.pieces2}` : "partie absente du fil");
  check("les pions annoncés sont ceux du plateau du spectateur",
    !!vuEnDirect && !!lastState &&
    vuEnDirect.pieces1 === pions(lastState.state.grid, 1) && vuEnDirect.pieces2 === pions(lastState.state.grid, 2),
    `fil ${vuEnDirect && vuEnDirect.pieces1}/${vuEnDirect && vuEnDirect.pieces2} — plateau ${lastState && pions(lastState.state.grid, 1)}/${lastState && pions(lastState.state.grid, 2)}`);

  /* 9.5c Filtre de portée de l'écran Match (« Vos contacts » / « Toutes les
     parties ») : la portée est décidée par le serveur, le client ne fait que
     l'afficher. Cora n'est ni amie ni en contact avec les joueurs du match. */
  const liveDefault = await api("/api/games/live", { token: users.Cora.token });
  check("fil « contacts » : portée annoncée et match hors périmètre absent",
    liveDefault.status === 200 && liveDefault.json.scope === "contacts" &&
    !(liveDefault.json.live || []).some((l) => l.sessionId === sid),
    JSON.stringify((liveDefault.json.live || []).map((l) => l.sessionId)));
  const liveAll = await api("/api/games/live?scope=all", { token: users.Cora.token });
  check("fil « toutes les parties » : le même match devient visible",
    liveAll.status === 200 && liveAll.json.scope === "all" &&
    (liveAll.json.live || []).some((l) => l.sessionId === sid),
    JSON.stringify((liveAll.json.live || []).map((l) => l.sessionId)));
  check("le fil public reste plafonné et sans partie d'entraînement",
    (liveAll.json.live || []).length <= 60 && (liveAll.json.live || []).every((l) => l.mode !== "ai"),
    `${(liveAll.json.live || []).length} entrée(s)`);

  /* 9.6 Abandon d'Ari : fin de partie, Elo, historique */
  const histBefore = await api("/api/games/history", { token: users.Ari.token });
  const eloBefore = (await api("/api/user", { token: users.Ari.token })).json.user.elo;
  const winnerNum = aNum === 1 ? 2 : 1;
  a.send({ type: "resign", sessionId: sid });
  const endA = await a.wait((m) => m.type === "game_end" && m.sessionId === sid, 6000);
  const endB = await b.wait((m) => m.type === "game_end" && m.sessionId === sid, 6000);
  check("abandon -> fin de partie annoncée aux deux joueurs", !!endA && !!endB);
  check("le résultat désigne le gagnant par abandon",
    !!endA && endA.result.winner === winnerNum && endA.result.reason === "abandon",
    endA ? JSON.stringify(endA.result) : "");
  check("le perdant voit son Elo baisser", !!endA && endA.result.delta < 0, endA ? String(endA.result.delta) : "");
  const eloAfter = (await api("/api/user", { token: users.Ari.token })).json.user.elo;
  check("l'Elo est bien mis à jour en base", eloAfter < eloBefore, `${eloBefore} -> ${eloAfter}`);
  const histAfter = await api("/api/games/history", { token: users.Ari.token });
  const abandon = histAfter.json.games.find((g) => g.reason === "abandon");
  check("la partie terminée est archivée avec ses Elo et ses coups",
    !!abandon && abandon.delta1 !== null && abandon.delta2 !== null && abandon.moves_json !== null,
    `${histBefore.json.games.length} partie(s) avant, ${histAfter.json.games.length} après`);
  check("l'historique enregistre le vainqueur",
    !!abandon && abandon.winner_id === users.Bema.id);
  const specEnd = await e.wait((m) => m.type === "spectate_end", 5000);
  check("le spectateur est prévenu de la fin du match", !!specEnd);

  a.close(); b.close(); e.close();
  await sleep(200);
}
/* =========================================================
   PHASE 2b — Moteur : déplacement libre (unités, sans réseau)
   ========================================================= */
function phaseMoteur() {
  section("2b. Moteur — déplacement libre (unités)");
  const newSession = () => {
    const s = new GameSession("unit-" + Math.random().toString(16).slice(2),
      { id: 901, pseudo: "Unit1", elo: 1100 }, { id: 902, pseudo: "Unit2", elo: 1100 },
      "ai", { id: "blitz", time: 600 }, 0);
    s.phase = "play"; s.turn = 1;
    return s;
  };
  const blank = () => Array.from({ length: 5 }, () => Array(9).fill(0));
  /* Plateau : mon pion (2,4) PEUT prendre vers la droite (adversaire en (2,6),
     case (2,5) vide devant) ; un AUTRE de mes pions (0,0) n'a qu'un pas simple. */
  const s1 = newSession();
  s1.grid = blank();
  s1.grid[2][4] = 1; s1.grid[0][0] = 1; s1.grid[2][6] = 2;
  const lm1 = legalMoves(s1.grid, 1, null);
  const cap1 = lm1.find((m) => m.from[0] === 2 && m.from[1] === 4 && m.cap.length);
  const paika1 = lm1.find((m) => m.from[0] === 0 && m.from[1] === 0 && m.to[0] === 0 && m.to[1] === 1 && !m.cap.length);
  check("déplacement libre : la prise reste proposée quand elle existe", !!cap1, cap1 ? `cap ${cap1.cap.length}` : "aucune prise listée");
  check("déplacement libre : un pas simple reste proposé MÊME quand une prise existe", !!paika1, `${lm1.length} coup(s) listé(s)`);
  if (paika1) {
    const r1 = s1.applyMove(paika1);
    check("le moteur ACCEPTE un coup non capturant alors qu'une prise était possible", r1.ok === true, r1.error || "");
  }
  /* Case d'arrivée occupée par un pion ADVERSE : pas interdit dans cette
     direction — et un coup forgé vers cette case est refusé par le moteur. */
  const s2 = newSession();
  s2.grid = blank();
  s2.grid[2][4] = 1; s2.grid[0][0] = 1; s2.grid[2][6] = 2; s2.grid[2][3] = 2;
  const lm2 = legalMoves(s2.grid, 1, null);
  check("case d'arrivée occupée par un pion adverse : aucun pas dans cette direction",
    !lm2.some((m) => m.to[0] === 2 && m.to[1] === 3),
    lm2.filter((m) => m.from[0] === 2 && m.from[1] === 4).map((m) => JSON.stringify(m.to)).join(" "));
  const forged = s2.applyMove({ from: [2, 4], to: [2, 3], dir: [0, -1], kind: "paika", cap: [] });
  check("coup forgé vers case occupée : REFUSÉ par le moteur", forged.ok === false, forged.error || "accepté !");
}

/* =========================================================
   PHASE 10 — Entraînement contre l'IA et défis entre joueurs
   ========================================================= */
async function phaseIaEtDefis() {
  section("10. Entraînement IA et défis");
  const d = wsClient(users.Doda.token), c = wsClient(users.Cora.token), x = wsClient(users.Efa.token);
  await Promise.all([d.ready, c.ready, x.ready]);
  await sleep(200);

  /* 10.1 Entraînement contre l'IA (aucun enjeu) */
  d.send({ type: "find_match", format: "blitz", mode: "ai" });
  const aiStart = await d.wait((m) => m.type === "game_start" && m.mode === "ai", 8000);
  check("entraînement IA : partie lancée sans adversaire en ligne", !!aiStart);
  check("l'adversaire IA vient du pool interne (pas un compte réel)",
    !!aiStart && aiStart.opponent.id === 0 && !!aiStart.opponent.pseudo,
    aiStart ? JSON.stringify(aiStart.opponent) : "");
  check("partie d'entraînement sans mise", !!aiStart && aiStart.wager === 0);
  const aiSid = aiStart && aiStart.sessionId;

  d.send({ type: "pick_side", sessionId: aiSid, side: "pile" });
  const aiPlay = await d.wait((m) => m.type === "game_state" && m.state.phase === "play", 6000);
  check("l'IA prend automatiquement la face restante et la partie démarre", !!aiPlay);
  let sent = 0;
  if (aiPlay && aiPlay.state.turn === 1) {
    const lm = legalMoves(aiPlay.state.grid, 1, null);
    if (lm.length) { d.send({ type: "move", sessionId: aiSid, move: lm[0] }); sent = 1; }
  }
  const aiMoved = await d.wait((m) => m.type === "game_state" && (m.state.moves || []).length > sent, 12000);
  check("l'IA joue son coup automatiquement", !!aiMoved,
    aiMoved ? `${aiMoved.state.moves.length} coup(s)` : "aucun coup de l'IA");

  /* 10.1b L'entraînement ne touche NI l'Elo NI les compteurs — l'écran l'annonce
     noir sur blanc (« aucun impact Elo ni wallet »). Le camp du joueur était
     pourtant mis à jour sans condition : une partie contre l'IA faisait perdre
     19 points d'Elo, et l'historique l'affichait comme une vraie partie. */
  const aiEloAvant = (await api("/api/user", { token: users.Doda.token })).json.user;
  d.send({ type: "resign", sessionId: aiSid });
  const aiFin = await d.wait((m) => m.type === "game_end" && m.sessionId === aiSid, 8000);
  check("abandon en entraînement : la fin de partie est annoncée", !!aiFin);
  check("l'entraînement annonce un delta nul", !!aiFin && aiFin.result.delta === 0,
    aiFin ? String(aiFin.result.delta) : "");
  await sleep(700);
  const aiEloApres = (await api("/api/user", { token: users.Doda.token })).json.user;
  check("l'Elo et les compteurs sont inchangés après une partie d'entraînement",
    aiEloApres.elo === aiEloAvant.elo && aiEloApres.wins === aiEloAvant.wins && aiEloApres.losses === aiEloAvant.losses,
    `elo ${aiEloAvant.elo} -> ${aiEloApres.elo} · ${aiEloAvant.wins}V/${aiEloAvant.losses}D -> ${aiEloApres.wins}V/${aiEloApres.losses}D`);
  const aiHist = (await api("/api/games/history", { token: users.Doda.token })).json.games
    .find((g) => g.mode === "ai" && g.winner_id !== null);
  check("la partie d'entraînement est archivée avec un écart nul et sans Elo d'adversaire",
    !aiHist || (aiHist.delta1 === 0 && aiHist.delta2 === 0 && aiHist.elo1_after === aiHist.elo1_before && aiHist.elo2_before === null),
    aiHist ? JSON.stringify({ d1: aiHist.delta1, d2: aiHist.delta2, a1: aiHist.elo1_after, b1: aiHist.elo1_before, b2: aiHist.elo2_before }) : "aucune ligne IA");

  /* 10.2 Défis : KYC, mise minimale, mise débitée */
  x.send({ type: "send_challenge", toPseudo: users.Ari.pseudo, wager: 500, format: "blitz" });
  const kycErr = await x.wait((m) => m.type === "error" && /KYC/i.test(m.message || ""), 5000);
  check("défi avec mise sans KYC -> refusé", !!kycErr, kycErr ? kycErr.message : "aucune erreur");

  d.send({ type: "send_challenge", toPseudo: users.Cora.pseudo, wager: 100, format: "blitz" });
  const minErr = await d.wait((m) => m.type === "error" && /500/.test(m.message || ""), 5000);
  check("défi sous la mise minimale (500 Ar) -> refusé", !!minErr, minErr ? minErr.message : "aucune erreur");

  const balD0 = (await api("/api/user", { token: users.Doda.token })).json.user.balance;
  d.send({ type: "send_challenge", toPseudo: users.Cora.pseudo, wager: 500, format: "blitz" });
  const recv = await c.wait((m) => m.type === "challenge_received", 6000);
  check("le destinataire reçoit le défi avec sa mise",
    !!recv && recv.challenge.wager === 500, recv ? JSON.stringify(recv.challenge) : "");
  /* L'identifiant de l'expéditeur voyage AVEC le défi : sans lui, l'interface ne
     peut pas ouvrir son profil (un pseudo n'est pas une clé). */
  check("le défi reçu porte l'identifiant de son auteur (lien vers son profil)",
    !!recv && recv.challenge.fromId === users.Doda.id,
    recv ? `fromId ${recv.challenge.fromId} (attendu ${users.Doda.id})` : "");
  const sentMsg = await d.wait((m) => m.type === "challenge_sent", 5000);
  check("l'expéditeur est informé de l'envoi", !!sentMsg);
  const balD1 = (await api("/api/user", { token: users.Doda.token })).json.user.balance;
  check("la mise du défi est débitée de l'expéditeur", balD1 === balD0 - 500, `${balD0} -> ${balD1}`);

  /* 10.2b L'onglet « Défis » lit les deux listes d'un seul appel : reçus (en
     attente) et envoyés (avec leur statut). */
  const chC = await api("/api/challenges", { token: users.Cora.token });
  check("GET /api/challenges : le destinataire voit le défi reçu en attente",
    chC.status === 200 && (chC.json.received || []).some((c) => c.id === recv.challenge.id && c.status === "pending"),
    JSON.stringify((chC.json.received || []).map((c) => c.id)));
  check("GET /api/challenges : aucun défi envoyé côté destinataire",
    Array.isArray(chC.json.sent) && chC.json.sent.length === 0,
    JSON.stringify(chC.json.sent));
  const chD = await api("/api/challenges", { token: users.Doda.token });
  check("GET /api/challenges : l'expéditeur voit son défi envoyé et le pseudo visé",
    chD.status === 200 && (chD.json.sent || []).some((c) => c.id === recv.challenge.id && c.toPseudo === users.Cora.pseudo),
    JSON.stringify((chD.json.sent || []).slice(0, 2)));

  /* 10.2c Les deux dates du défi sont normalisées en ISO-UTC. La carte de défi
     s'en sert pour sa jauge de temps de réponse : une date SQLite brute
     (« 2026-09-17 12:00:00 ») serait lue comme heure LOCALE par le navigateur et
     la jauge mentirait du décalage de fuseau. */
  const isoUtc = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v);
  const recu = (chC.json.received || []).find((c) => c.id === recv.challenge.id);
  const envoye = (chD.json.sent || []).find((c) => c.id === recv.challenge.id);
  check("GET /api/challenges : le défi reçu porte ses dates ISO-UTC",
    !!recu && isoUtc(recu.createdAt) && isoUtc(recu.expiresAt),
    recu ? `${recu.createdAt} -> ${recu.expiresAt}` : "défi reçu absent");
  check("la fenêtre de réponse annoncée est bien de 15 minutes",
    !!recu && isoUtc(recu.createdAt) && isoUtc(recu.expiresAt) &&
    Date.parse(recu.expiresAt) - Date.parse(recu.createdAt) === 15 * 60 * 1000,
    recu ? String((Date.parse(recu.expiresAt) - Date.parse(recu.createdAt)) / 1000) + " s" : "");
  check("GET /api/challenges : le défi envoyé porte aussi ses dates ISO-UTC",
    !!envoye && isoUtc(envoye.createdAt) && isoUtc(envoye.expiresAt),
    envoye ? `${envoye.createdAt} -> ${envoye.expiresAt}` : "défi envoyé absent");

  /* 10.3 Refus -> remboursement intégral */
  c.send({ type: "reject_challenge", challengeId: recv.challenge.id });
  const refund = await d.wait((m) => m.type === "wallet_update" && m.balance === balD0, 6000);
  check("défi refusé -> mise remboursée", !!refund, refund ? `solde ${refund.balance}` : "aucun remboursement");
  const rejStatus = await d.wait((m) => m.type === "challenge_status" && m.status === "rejected", 5000);
  check("l'expéditeur est informé du refus", !!rejStatus);
  /* Le suivi : un défi refusé sort des « reçus » mais reste dans les « envoyés ». */
  const chD2 = await api("/api/challenges", { token: users.Doda.token });
  check("un défi refusé reste dans les défis envoyés, avec son statut",
    (chD2.json.sent || []).some((c) => c.id === recv.challenge.id && c.status === "rejected"),
    JSON.stringify((chD2.json.sent || []).map((c) => c.id + ":" + c.status)));
  const chC2 = await api("/api/challenges", { token: users.Cora.token });
  check("un défi refusé quitte la liste des défis en attente",
    !(chC2.json.received || []).some((c) => c.id === recv.challenge.id),
    JSON.stringify((chC2.json.received || []).map((c) => c.id)));

  /* 10.4 Acceptation -> partie de défi lancée chez les deux */
  d.send({ type: "send_challenge", toPseudo: users.Cora.pseudo, wager: 500, format: "blitz" });
  const recv2 = await c.wait((m) => m.type === "challenge_received" && (!recv || m.challenge.id !== recv.challenge.id), 6000);
  check("un second défi peut être envoyé après un refus", !!recv2);
  c.send({ type: "accept_challenge", challengeId: recv2 && recv2.challenge.id });
  const acc = await d.wait((m) => m.type === "challenge_accepted", 6000);
  const gsD = await d.wait((m) => m.type === "game_start" && m.mode === "defi", 8000);
  const gsC = await c.wait((m) => m.type === "game_start" && m.mode === "defi", 8000);
  check("défi accepté -> partie de défi lancée pour les deux joueurs", !!acc && !!gsD && !!gsC);
  check("la mise est rappelée dans l'état de la partie", !!gsD && gsD.wager === 500, gsD ? String(gsD.wager) : "");

  c.send({ type: "accept_challenge", challengeId: "DF-INEXISTANT" });
  const invalid = await c.wait((m) => m.type === "error" && /invalide/i.test(m.message || ""), 5000);
  check("accepter un défi inexistant -> refusé", !!invalid, invalid ? invalid.message : "aucune erreur");

  /* 10.6 Annulation par l'EXPÉDITEUR (bouton « Annuler le défi » de l'onglet
     Défis) : miroir du refus — la mise revient tout de suite, le défi sort des
     « en attente » des deux côtés, et le destinataire est prévenu sans recharger
     (poussée `challenges_update`, la même qu'à la reconnexion). */
  const balAvantAnnul = (await api("/api/user", { token: users.Doda.token })).json.user.balance;
  /* Attente d'un message NOUVEAU uniquement : `wait()` fouille toute la boîte,
     donc un ancien défi encore présent dedans ferait passer le test à côté. Le
     point de départ se prend AVANT l'action qui déclenche les messages, sinon un
     message déjà arrivé entre-temps serait manqué. */
  const waitNew = async (client, pred, ms = 6000, from = client.inbox.length) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = client.inbox.slice(from).find(pred);
      if (hit) return hit;
      await sleep(120);
    }
    return null;
  };
  d.send({ type: "send_challenge", toPseudo: users.Cora.pseudo, wager: 500, format: "blitz" });
  const recv3 = await waitNew(c, (m) => m.type === "challenge_received", 6000);
  const id3 = recv3 && recv3.challenge.id;
  check("un troisième défi peut être envoyé après une partie lancée", !!id3, id3 || "aucun défi reçu");
  const balEngagee = (await api("/api/user", { token: users.Doda.token })).json.user.balance;
  check("la mise du défi est engagée à l'envoi", balEngagee === balAvantAnnul - 500, `${balAvantAnnul} -> ${balEngagee}`);

  /* L'annulation est réservée à l'expéditeur : le destinataire qui la tente ne
     doit RIEN changer (autorisation, pas seulement interface). */
  c.send({ type: "cancel_challenge", challengeId: id3 });
  await sleep(500);
  const apresTentative = await api("/api/challenges", { token: users.Cora.token });
  check("seul l'expéditeur peut annuler son défi",
    (apresTentative.json.received || []).some((x) => x.id === id3 && x.status === "pending"),
    JSON.stringify((apresTentative.json.received || []).map((x) => x.id + ":" + x.status)));

  const majAvant = c.inbox.filter((m) => m.type === "challenges_update").length;
  const markAnnul = d.inbox.length;
  d.send({ type: "cancel_challenge", challengeId: id3 });
  const refund2 = await waitNew(d, (m) => m.type === "wallet_update" && m.balance === balAvantAnnul, 6000, markAnnul);
  check("défi annulé -> mise rendue à l'expéditeur", !!refund2, refund2 ? `solde ${refund2.balance}` : "aucun remboursement");
  const annule = await waitNew(d, (m) => m.type === "challenge_status" && m.status === "cancelled", 5000, markAnnul);
  check("l'expéditeur est informé de sa propre annulation", !!annule, annule ? annule.status : "aucun message");
  await sleep(600);
  const majC = c.inbox.filter((m) => m.type === "challenges_update").slice(majAvant)
    .find((m) => !(m.challenges || []).some((x) => x.id === id3));
  check("le destinataire voit le défi annulé disparaître (poussée serveur)", !!majC,
    majC ? `${(majC.challenges || []).length} défi(s) restant(s)` : "aucune poussée reçue");
  const chD3 = await api("/api/challenges", { token: users.Doda.token });
  check("un défi annulé reste dans les envoyés, avec son statut",
    (chD3.json.sent || []).some((x) => x.id === id3 && x.status === "cancelled"),
    JSON.stringify((chD3.json.sent || []).slice(0, 3).map((x) => x.id + ":" + x.status)));
  const chC3 = await api("/api/challenges", { token: users.Cora.token });
  check("un défi annulé quitte les défis en attente du destinataire",
    !(chC3.json.received || []).some((x) => x.id === id3),
    JSON.stringify((chC3.json.received || []).map((x) => x.id)));

  d.close(); c.close(); x.close();
  await sleep(200);
}
/* ---------------------------------------------------------
   6.4 Bracket, « mes tournois », confirmations, match lancé
   --------------------------------------------------------- */
async function checkBracket() {
  const A = users.Ari.token;
  const list = await api("/api/tournaments", { token: A });
  const t = list.json.tournaments.find((x) => parseInt(x.id) === TID);
  check("le tournoi passe en « en_cours » dès qu'il est complet", t.status === "en_cours", t.status);
  check("les 4 joueurs sont enregistrés", t.registeredCount === 4 && t.registered.length === 4, `count ${t.registeredCount}`);

  const det = await api("/api/tournaments/" + TID, { token: A });
  const m = det.json.matches || [];
  const r1 = m.filter((x) => x.round === 1), r2 = m.filter((x) => x.round === 2);
  check("bracket : 3 matchs (2 demi-finales + 1 finale)", m.length === 3, `matchs ${m.length}`);
  check("bracket : 2 matchs au 1er tour et 1 finale", r1.length === 2 && r2.length === 1);
  const placed = r1.flatMap((x) => [x.p1_id, x.p2_id]);
  check("bracket : les 4 joueurs sont placés au 1er tour, sans doublon",
    placed.length === 4 && new Set(placed).size === 4 && placed.every((p) => p !== null));
  check("bracket : la finale reste vide avant les demi-finales", !r2[0].p1_id && !r2[0].p2_id);
  check("bracket : chaque demi-finale pointe vers la finale",
    r1.every((x) => x.next_match_id === r2[0].id), JSON.stringify(r1.map((x) => x.next_match_id)));
  check("bracket : chaque match a une date et une fenêtre de confirmation",
    m.every((x) => !!x.starts_at && !!x.confirm_deadline));

  const mine = await api("/api/tournaments/my", { token: A });
  const myT = mine.json.tournaments.find((x) => x.id === TID);
  check("GET /api/tournaments/my liste le tournoi et mon prochain match",
    !!myT && myT.matchesTotal === 1 && !!myT.nextMatch, JSON.stringify(mine.json.tournaments.map((x) => x.id)));
  check("le prochain match indique l'adversaire", !!myT && !!myT.nextMatch.opponent);

  const notifs = await api("/api/notifications", { token: A });
  check("notification « tournoi_debut » envoyée aux inscrits",
    notifs.json.notifications.some((n) => n.type === "tournoi_debut"),
    JSON.stringify(notifs.json.notifications.map((n) => n.type)));

  /* Laisse la boucle serveur ouvrir la fenêtre de confirmation (1 s de tick) */
  await sleep(1500);
  const notifsReq = await api("/api/notifications", { token: A });
  check("notification « confirmation_requise » envoyée à l'ouverture de la fenêtre",
    notifsReq.json.notifications.some((n) => n.type === "confirmation_requise"),
    JSON.stringify(notifsReq.json.notifications.map((n) => n.type)));

  /* Confirmation de présence : Ari puis son adversaire -> le match démarre */
  const myMatch = m.find((x) => x.p1_id === users.Ari.id || x.p2_id === users.Ari.id);
  const oppId = myMatch.p1_id === users.Ari.id ? myMatch.p2_id : myMatch.p1_id;
  const sched = await api(`/api/tournaments/${TID}/confirm`, { method: "POST", token: A });
  check("confirmation d'un match encore « a_venir » acceptée (lancement libre)",
    sched.status === 200 && sched.json.ok === true, JSON.stringify(sched.json));
  const notifs2 = await api("/api/notifications", { token: A });
  check("notification « confirmation » créée", notifs2.json.notifications.some((n) => n.type === "confirmation"));

  const oppToken = oppId === users.Bema.id ? users.Bema.token
    : oppId === users.Cora.id ? users.Cora.token : users.Doda.token;
  const conf2 = await api(`/api/tournaments/${TID}/confirm`, { method: "POST", token: oppToken });
  check("l'adversaire confirme à son tour", conf2.status === 200, JSON.stringify(conf2.json));
  await sleep(2500);

  const det2 = await api("/api/tournaments/" + TID, { token: A });
  const m2 = det2.json.matches.find((x) => x.id === myMatch.id);
  check("les deux confirmations lancent le match (statut en_cours)", m2.status === "en_cours", m2.status);
  const notifs3 = await api("/api/notifications", { token: A });
  check("notification « match_lance » annonçant la partie",
    notifs3.json.notifications.some((n) => n.type === "match_lance"),
    JSON.stringify(notifs3.json.notifications.map((n) => n.type)));

  const unreg = await api(`/api/tournaments/${TID}/confirm`, { method: "POST", token: users.Efa.token });
  check("confirmation sans match à jouer -> 404", unreg.status === 404, `code ${unreg.status}`);
}

/* =========================================================
   PHASE 11 — Correctifs de données : badge Amis, classement
   vivant, identifiants dans les charges utiles, instantané d'Elo
   =========================================================
   Chaque vérification confronte l'API à ce que la BASE contient
   réellement, jamais à ce que l'interface voudrait croire. */
async function phaseCorrectifs() {
  section("11. Correctifs de données (badge Amis, classement, identifiants, Elo)");
  const R = Math.floor(Math.random() * 900 + 100);
  /* 11.1 Un compte NEUF entre dans le classement, sans intervention manuelle */
  const pseudoNew = PREFIX + "Ifehi" + R;
  const reg = await api("/api/auth/register",
    { method: "POST", body: { pseudo: pseudoNew, password: PWD, province: "Antananarivo" } });
  check("un compte neuf s'inscrit (joueur de contrôle)", reg.status === 200 && !!reg.json.token, `code ${reg.status}`);
  const newU = (reg.json || {}).user || {};
  const lb = await api("/api/leaderboard", { token: users.Ari.token });
  const row = (lb.json.leaderboard || []).find((p) => p.id === newU.id);
  check(`le nouveau joueur « ${pseudoNew} » figure au classement`,
    !!row, row ? "" : `${(lb.json.leaderboard || []).length} joueur(s) listés — id ${newU.id} absent`);
  check("sa ligne annonce son pseudo, son Elo et son rang",
    !!row && row.pseudo === pseudoNew && row.elo === 1100 && Number.isInteger(row.rank),
    row ? JSON.stringify({ pseudo: row.pseudo, elo: row.elo, rank: row.rank, avatar: row.avatar }) : "");
  check("aucune photo inventée : la ligne reste sur l'avatar par défaut",
    !!row && (row.avatar === null || row.avatar === undefined), row ? String(row.avatar) : "");
  check("les réponses d'API interdisent la mise en cache (Cache-Control: no-store)",
    /no-store/i.test(lb.headers["cache-control"] || ""),
    `en-tête reçu : « ${lb.headers["cache-control"] || "aucun"} »`);

  /* 11.2 La photo déposée est la MÊME partout (classement, profil, header) */
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const av = await api("/api/user/avatar", { method: "POST", token: reg.json.token, body: { avatar: png } });
  check("le dépôt d'une photo de profil réussit",
    av.status === 200 && /^\/uploads\/avatars\//.test((av.json || {}).avatar || ""), JSON.stringify(av.json));
  const lb2 = await api("/api/leaderboard", { token: users.Ari.token });
  const row2 = (lb2.json.leaderboard || []).find((p) => p.id === newU.id);
  check("le classement sert la photo déposée (et non un instantané périmé)",
    !!row2 && row2.avatar === av.json.avatar, `classement « ${row2 && row2.avatar} » · dépôt « ${av.json.avatar} »`);
  const me2 = await api("/api/user", { token: reg.json.token });
  check("le profil personnel renvoie EXACTEMENT la même photo (source unique)",
    me2.json.user.avatar === av.json.avatar, `${me2.json.user.avatar}`);
  /* 11.3 Badge Amis : filigrane PERSISTANT (il survit à un rechargement) */
  const g1 = await api("/api/auth/register", { method: "POST", body: { pseudo: PREFIX + "Badge1" + R, password: PWD, province: "Antananarivo" } });
  const g2 = await api("/api/auth/register", { method: "POST", body: { pseudo: PREFIX + "Badge2" + R, password: PWD, province: "Antananarivo" } });
  const t1 = g1.json.token, t2 = g2.json.token;
  let f2 = await api("/api/friends", { token: t2 });
  check("aucune demande nouvelle au départ : badge éteint", f2.json.newIncoming === 0, String(f2.json.newIncoming));
  const req = await api("/api/friends/request", { method: "POST", token: t1, body: { pseudo: g2.json.user.pseudo } });
  check("la demande d'ami part", req.status === 200 && !!req.json.requestId, JSON.stringify(req.json));
  f2 = await api("/api/friends", { token: t2 });
  check("une demande reçue allume le badge (1)", f2.json.newIncoming === 1, String(f2.json.newIncoming));
  check("la demande reste visible dans la liste reçue", (f2.json.incoming || []).length === 1, `${(f2.json.incoming || []).length} demande(s)`);
  const seen = await api("/api/friends/seen", { method: "POST", token: t2 });
  check("POST /api/friends/seen éteint le badge", seen.status === 200 && seen.json.newIncoming === 0, JSON.stringify(seen.json));
  f2 = await api("/api/friends", { token: t2 });
  check("après relecture (ce que fait un rechargement de page), il reste éteint",
    f2.json.newIncoming === 0, String(f2.json.newIncoming));
  check("la demande, elle, n'a pas disparu de l'écran Amis", (f2.json.incoming || []).length === 1, "");
  /* Refus puis relance : la relance est une demande NOUVELLE (identifiant neuf) */
  const rid = f2.json.incoming[0].id;
  await api("/api/friends/respond", { method: "POST", token: t2, body: { id: rid, action: "decline" } });
  const rel = await api("/api/friends/request", { method: "POST", token: t1, body: { pseudo: g2.json.user.pseudo } });
  check("une demande relancée après refus repart d'un identifiant neuf",
    rel.status === 200 && rel.json.requestId !== rid, `id ${rid} -> ${rel.json.requestId}`);
  f2 = await api("/api/friends", { token: t2 });
  check("la relance rallume le badge (ce n'est pas un doublon invisible)",
    f2.json.newIncoming === 1, String(f2.json.newIncoming));
  await api("/api/friends/seen", { method: "POST", token: t2 });
  f2 = await api("/api/friends", { token: t2 });
  check("le filigrane ne recule jamais : deuxième consultation, badge toujours éteint",
    f2.json.newIncoming === 0, String(f2.json.newIncoming));
  /* 11.4 Les listes de tournoi portent des IDENTIFIANTS (noms cliquables) */
  const tl = await api("/api/tournaments", { token: users.Ari.token });
  const tReg = (tl.json.tournaments || []).find((t) => (t.registeredUsers || []).length > 0);
  check("chaque tournoi expose ses inscrits avec leur identifiant",
    (tl.json.tournaments || []).every((t) => Array.isArray(t.registeredUsers) &&
      t.registeredUsers.length === (t.registered || []).length &&
      t.registeredUsers.every((u) => Number.isInteger(u.id) && !!u.pseudo)),
    tReg ? `exemple : ${JSON.stringify(tReg.registeredUsers.slice(0, 2))}` : "aucun tournoi avec inscrit");
  check("les pseudos historiques et les identifiants concordent (aucune divergence)",
    !tReg || tReg.registered.join("|") === tReg.registeredUsers.map((u) => u.pseudo).join("|"),
    tReg ? `${tReg.registered.join(",")} contre ${tReg.registeredUsers.map((u) => u.pseudo).join(",")}` : "");

  /* 11.5 Instantané d'Elo : avant / après, signes, cohérence avec le joueur.
     Le camp (joueur 1 / joueur 2) n'est PAS fixe : il dépend de l'ordre de mise
     en file. On ne présume donc d'aucune place — on lit les colonnes du camp
     réellement occupé par chaque joueur. */
  const hA = await api("/api/games/history", { token: users.Ari.token });
  const gA = (hA.json.games || []).find((g) => g.reason === "abandon");
  const mySide = (g, uid) => (g.player1_id === uid ? 1 : g.player2_id === uid ? 2 : 0);
  const before = (g, s) => (s === 1 ? g.elo1_before : g.elo2_before);
  const after = (g, s) => (s === 1 ? g.elo1_after : g.elo2_after);
  const delta = (g, s) => (s === 1 ? g.delta1 : g.delta2);
  const sA = gA ? mySide(gA, users.Ari.id) : 0;
  const sB = gA ? mySide(gA, users.Bema.id) : 0;
  check("la partie classée terminée porte l'Elo AVANT et APRÈS des deux camps",
    !!gA && Number.isInteger(gA.elo1_before) && Number.isInteger(gA.elo1_after) &&
    Number.isInteger(gA.elo2_before) && Number.isInteger(gA.elo2_after),
    gA ? JSON.stringify({ b1: gA.elo1_before, a1: gA.elo1_after, b2: gA.elo2_before, a2: gA.elo2_after }) : "partie absente");
  check("l'instantané est cohérent avec les écarts enregistrés (après = avant + delta)",
    !!gA && gA.elo1_after === gA.elo1_before + gA.delta1 && gA.elo2_after === gA.elo2_before + gA.delta2,
    gA ? `1 : ${gA.elo1_before}+${gA.delta1}=${gA.elo1_after} · 2 : ${gA.elo2_before}+${gA.delta2}=${gA.elo2_after}` : "");
  check("chaque joueur de la partie y est retrouvé (identifiants, pas pseudos)",
    !!gA && sA !== 0 && sB !== 0 && sA !== sB, gA ? `Ari en p${sA}, Bema en p${sB}` : "");
  check("le vainqueur gagne de l'Elo, le perdant en perd (signes justes)",
    !!gA && mySide(gA, gA.winner_id) !== 0 && delta(gA, mySide(gA, gA.winner_id)) > 0 &&
    delta(gA, mySide(gA, gA.winner_id) === 1 ? 2 : 1) < 0,
    gA ? `vainqueur p${mySide(gA, gA.winner_id)} : ${delta(gA, mySide(gA, gA.winner_id))} · perdant : ${delta(gA, mySide(gA, gA.winner_id) === 1 ? 2 : 1)}` : "");
  const uA = (await api("/api/user", { token: users.Ari.token })).json.user;
  const uB = (await api("/api/user", { token: users.Bema.token })).json.user;
  check("l'Elo courant de chaque joueur correspond au dernier instantané enregistré",
    !!gA && uA.elo === after(gA, sA) && uB.elo === after(gA, sB),
    gA ? `Ari ${uA.elo}/${after(gA, sA)} · Bema ${uB.elo}/${after(gA, sB)}` : "");
  check("l'instantané suit la VRAIE partie du joueur (avant = état d'avant la partie)",
    !!gA && before(gA, sA) !== after(gA, sA) && before(gA, sA) > 0,
    gA ? `Ari ${before(gA, sA)} -> ${after(gA, sA)}` : "");
  /* Le camp « IA » n'a pas de compte : ses colonnes restent vides, et l'interface
     doit le DIRE (« Données indisponibles ») plutôt qu'afficher un zéro inventé. */
  const hD = await api("/api/games/history", { token: users.Doda.token });
  const gAi = (hD.json.games || []).find((g) => g.mode === "ai" && g.winner_id !== null);
  check("une partie d'entraînement n'invente pas d'Elo pour l'adversaire IA",
    !gAi || (gAi.elo1_before !== null && gAi.elo1_after === gAi.elo1_before + gAi.delta1 &&
      gAi.elo2_before === null && gAi.elo2_after === null),
    gAi ? JSON.stringify({ b1: gAi.elo1_before, a1: gAi.elo1_after, b2: gAi.elo2_before, a2: gAi.elo2_after })
      : "aucune partie IA terminée dans cette campagne");
}

/* =========================================================
   Exécution de la campagne
   ========================================================= */
async function main() {
  console.log("D-aôna — CAMPAGNE DE SCÉNARIOS DE TEST");
  console.log("=====================================");
  let child = null;
  try {
    /* Garde-fou anti-collision : la campagne ne doit JAMAIS travailler contre
       un serveur étranger. Si quelque chose écoute déjà sur le port de test
       (autre campagne lancée en parallèle, serveur oublié), ce serveur
       répondrait aux requêtes de la campagne — et s'il utilise la base
       réelle, les comptes de test y seraient écrits. On refuse de démarrer. */
    let portBusy = false;
    try { await fetch(BASE + "/api/user", { signal: AbortSignal.timeout(1500) }); portBusy = true; } catch (e) {}
    if (portBusy) throw new Error("port " + PORT + " déjà occupé — arrêtez l'autre serveur de test (test_auth.js ?) et relancez la campagne.");
    const dbPath = snapshotDb();
    console.log("Base de travail (copie jetable) : " + dbPath);
    prepareFixture(dbPath);
    child = startServer(dbPath);
    await waitServer();
    console.log("Serveur de test prêt sur " + BASE + "\n");

    await phaseComptes();
    /* Rôle d'administration, attribué APRÈS l'inscription du compte hôte et
       APRÈS le démarrage : `admin_grant.js` ne connaît que la base, il lui faut
       donc le pseudo déjà créé. C'est le MÊME chemin que celui de l'exploitant
       (aucun lien d'invitation n'existe), et il écrit dans admin_audit. */
    const grant = KYCX.grantAdmin(dbPath, users.Admin && users.Admin.pseudo);
    check("rôle super_admin attribué par le script hôte (admin_grant.js)", grant.ok, grant.out.slice(0, 120));
    await phaseReferentiels();

    phaseMoteur();
    await phaseAmis();
    await phaseMessagerie();
    await phasePortefeuille();
    await phaseAdministration();
    await phaseTournois();
    await phaseSkins();
    await phasePionStyle();
    await phaseNotifications();
    await phaseTempsReel();
    await phaseIaEtDefis();
    await phaseCorrectifs();
  } catch (e) {
    failures++;
    failed.push("exception : " + ((e && e.stack) || e));
    console.error("\nERREUR FATALE :", e);
  } finally {
    await stopServer(child);
    cleanup();
  }

  console.log("\n=====================================");
  console.log(`RÉSULTAT : ${checks - failures}/${checks} vérifications réussies`);
  if (failures) {
    console.log(`\n${failures} ÉCHEC(S) :`);
    for (const f of failed) console.log("  - " + f);
    process.exitCode = 1;
  } else {
    console.log("Tous les scénarios passent.");
  }
}

main();

