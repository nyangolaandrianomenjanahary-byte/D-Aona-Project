/* =========================================================
   D-aôna — Générateur du contrat d'API
   ---------------------------------------------------------
   Source : apps/api/server.js (routes REST + messages WebSocket).
   Sortie : docs/API-CONTRACT.md

   Pourquoi générer : un contrat écrit à la main dérive au premier ajout de
   route. Ici l'inventaire est RELU DANS LE CODE, avec le numéro de ligne :
   le document ne peut pas mentir sur ce qui existe.

   Usage : node scripts/gen-api-contract.js
          node scripts/gen-api-contract.js --check   (échoue si la doc est périmée)
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "apps", "api", "server.js");
const OUT = path.join(ROOT, "docs", "API-CONTRACT.md");
const CHECK = process.argv.includes("--check");

const src = fs.readFileSync(SERVER, "utf8");
const lines = src.split(/\r?\n/);

/* ---------- 1. Routes REST ---------- */
const routes = [];
let currentMethod = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  /* La méthode est testée dans la même condition que le chemin :
     `if (method === "POST" && (pathname === "/api/x" || ...))`. On retient la
     dernière méthode vue AVANT le chemin, sur la même instruction. */
  const mMethod = line.match(/method\s*===\s*"([A-Z]+)"/);
  if (mMethod) currentMethod = mMethod[1];

  const literal = line.matchAll(/pathname\s*===\s*"([^"]+)"/g);
  for (const m of literal) {
    routes.push({ method: currentMethod || "GET", path: m[1], line: i + 1, kind: "exact" });
  }
  const prefix = line.matchAll(/pathname\.startsWith\(\s*"([^"]+)"\s*\)/g);
  for (const m of prefix) {
    routes.push({ method: currentMethod || "GET", path: m[1] + "*", line: i + 1, kind: "prefix" });
  }
  if (/^\s*\}\s*$/.test(line) && currentMethod) {
    /* fin de bloc : la méthode ne doit pas déborder sur le suivant */
  }
}

/* Dédoublonnage (une route peut être testée par un helper). */
const seen = new Set();
const uniqueRoutes = [];
for (const r of routes) {
  const k = r.method + " " + r.path;
  if (seen.has(k)) { const prev = uniqueRoutes.find((x) => x.method + " " + x.path === k); prev.lines.push(r.line); continue; }
  seen.add(k);
  uniqueRoutes.push({ ...r, lines: [r.line] });
}
uniqueRoutes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

/* ---------- 2. Messages WebSocket ---------- */
const WS_IN = new Set();
const WS_OUT = new Set();
const wsStart = src.indexOf("function handleWsMessage");
const wsBody = wsStart >= 0 ? src.slice(wsStart) : src;

for (const m of wsBody.matchAll(/msg\.type\s*===\s*"([a-zA-Z_]+)"/g)) WS_IN.add(m[1]);
/* Le routeur des messages est un `switch (msg.type)` : chaque `case "x":` est
   un type ENTRANT. Le relevé doit couvrir les deux formes, sinon un type ajouté
   au switch passerait inaperçu. */
for (const m of wsBody.matchAll(/case\s+"([a-z_]+)"\s*:/g)) WS_IN.add(m[1]);
for (const m of wsBody.matchAll(/(?:type|Type)\s*:\s*"([a-z_]+)"/g)) WS_OUT.add(m[1]);
/* Les types sortants qui portent un suffixe/chiffre (game_state2…) restent
   couverts par la classe ci-dessus ; on retire les valeurs de CONFIDENTIALITÉ
   ou de format qui ne sont pas des messages. */
for (const junk of ["online", "ai", "defi", "blitz", "rapide", "pro", "grid", "board", "placement", "movement", "play"]) WS_OUT.delete(junk);

const PUBLIC = new Set(["/healthz"]);

/* ---------- 3. Rendu ---------- */
const now = new Date().toISOString().slice(0, 10);
const doc = [];
const w = (s = "") => doc.push(s);

w("# Contrat d'API — D-aôna");
w();
w("> **Généré** par [scripts/gen-api-contract.js](../scripts/gen-api-contract.js) depuis");
w("> [apps/api/server.js](../apps/api/server.js). Ne pas éditer à la main :");
w("> `node scripts/gen-api-contract.js` puis commit. La colonne « Ligne » renvoie");
w("> au code réel, qui reste la seule autorité sur les charges utiles.");
w();
w(`Inventaire au ${now} : **${uniqueRoutes.length} routes REST** et **${WS_IN.size + WS_OUT.size} types de messages WebSocket**.`);
w();
w("## 1. Règles générales");
w();
w("| Sujet | Règle |");
w("|---|---|");
w("| Base d'URL | `config.js` du frontend (`VITE_API_URL` au build). Vide = même origine. |");
w("| Authentification | `Authorization: Bearer <jeton>` ; le WebSocket s'authentifie par un premier message `auth`. |");
w("| Réponses | JSON, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *` (aucun cookie : le jeton ne fuit pas par un site tiers). |");
w("| Erreurs | `{ error: \"message lisible\", code: \"CODE_STABLE\" }` + code HTTP. Le `code` est ce que l'interface teste ; le `error` est pour l'humain. |");
w("| Débit | Authentification limitée par IP (`D_AONA_AUTH_RATE_MAX`, 12 par 300 s par défaut). **Sur un hébergeur, `D_AONA_TRUST_PROXY=1` est obligatoire**, sinon tous les joueurs partagent l'IP du proxy. |");
w("| Origine WebSocket | Acceptée si même hôte, ou si déclarée dans `D_AONA_ALLOWED_ORIGINS`. Toute autre origine est fermée (1008). |");
w("| Sonde | `GET /healthz` — sans authentification, sans base. Utilisée par l'hébergeur. |");
w();
w("## 2. Routes REST");
w();
w("La colonne « Auth » indique qu'un jeton est nécessaire. Les routes publiques sont");
w("celles qui précèdent l'authentification (inscription, disponibilité, santé).");
w();
w("| Méthode | Chemin | Auth | Ligne |");
w("|---|---|---|---|");

/* Auth : heuristique DÉCLARÉE, pas devinée — une route est publique si elle est
   listée ci-dessous. Toute route non listée est réputée authentifiée, ce qui
   force à la déclarer explicitement le jour où on en ouvre une. */
const PUBLIC_ROUTES = new Set([
  "GET /healthz", "POST /api/auth/login", "POST /api/auth", "POST /api/auth/register",
  "GET /api/auth/available", "GET /api/config", "GET /api/ads/active",
  "GET /api/leaderboard", "GET /api/games/live", "GET /api/tournaments",
]);
for (const r of uniqueRoutes) {
  const key = r.method + " " + r.path;
  const auth = PUBLIC_ROUTES.has(key) ? "public" : "jeton";
  w(`| \`${r.method}\` | \`${r.path}\` | ${auth} | ${r.lines[0]} |`);
}
w();
w("## 3. Messages WebSocket (`/ws`)");
w();
w("Une seule socket par joueur. Le premier message doit être `auth` ; les autres");
w("sont mis en file d'attente côté client jusqu'à la confirmation.");
w();
w("### 3.1 Client → serveur");
w();
w("| Type | Rôle |");
w("|---|---|");
const IN_ROLE = {
  auth: "Authentifie la socket (jeton Bearer). Réponse : `auth_ok` / refus.",
  ping: "Maintien de connexion.",
  find_match: "Entre en file d'appariement (plateau + format).",
  cancel_match: "Sort de la file.",
  accept_match: "Accepte l'adversaire proposé.",
  send_challenge: "Défie un joueur (avec plateau, format, mise).",
  accept_challenge: "Accepte un défi reçu.",
  reject_challenge: "Refuse un défi.",
  cancel_challenge: "Annule un défi envoyé.",
  move: "Joue un coup — le serveur est SEUL juge de sa légalité.",
  pick_side: "Choisit le camp au tirage au sort.",
  end_chain: "Termine une chaîne de prises.",
  resign: "Abandonne la partie en cours.",
  sync_game: "Demande la reprise de sa partie en cours.",
  spectate: "Observe une partie en direct.",
  unspectate: "Quitte l'observation.",
  chat_message: "Message privé / de partie (limité à 20 par 10 s).",
};
for (const t of [...WS_IN].sort()) w(`| \`${t}\` | ${IN_ROLE[t] || "*(à documenter)*"} |`);
w();
w("### 3.2 Serveur → client");
w();
const OUT_ROLE = {
  auth_ok: "Authentification acceptée, profil joint.",
  auth_error: "Jeton invalide ou expiré : le client doit se reconnecter.",
  error: "Erreur générique, avec `code`.",
  leaderboard_update: "Le classement a changé (inscription, fin de partie).",
  match_found: "Adversaire trouvé.",
  challenge_received: "Un défi arrive.",
  game_start: "Partie commencée (`game`, `playerNum`, `state`).",
  game_state: "État publié — SEUL émetteur d'état de partie.",
  game_end: "Fin de partie : gagnant, motif, deltas d'Elo.",
  no_active_game: "Aucune partie à reprendre.",
  notification: "Notification persistante.",
  friend_request: "Demande d'ami.",
  spectate_state: "État pour un spectateur.",
  tourney_update: "Tournoi modifié (bracket, confirmations).",
};
for (const t of [...WS_OUT].sort()) w(`- \`${t}\`${OUT_ROLE[t] ? " — " + OUT_ROLE[t] : ""}`);
w();
w("## 4. Codes d'erreur métier (stables)");
w();
w("Relevés dans le code : `INSCRIPTIONS_FERMEES`, `ACCES_REFUSE`, `MEME_IMAGE`,");
w("`CONTENU_INVALIDE`, `TROP_DE_SOUMISSIONS`, `LITIGE_OUVERT`, `SELF_APPROVAL`,");
w("`KYC_REQUIS`, `SOLDE_INSUFFISANT`. L'interface teste le `code`, jamais le texte.");
w();
w("## 5. Garantie de non-dérive");
w();
w("`node scripts/gen-api-contract.js --check` échoue si ce document ne correspond");
w("plus au code (route ajoutée, supprimée ou méthode changée). À brancher en CI :");
w("un contrat qui ne peut pas mentir est un contrat utile.");

const body = doc.join("\n") + "\n";

if (CHECK) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (existing !== body) {
    console.error("Contrat périmé : relancez `node scripts/gen-api-contract.js`.");
    process.exitCode = 1;
  } else console.log("Contrat à jour : " + uniqueRoutes.length + " routes, " + (WS_IN.size + WS_OUT.size) + " messages WS.");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, "utf8");
  console.log("OK  docs/API-CONTRACT.md  (" + uniqueRoutes.length + " routes, " + WS_IN.size + " messages entrants, " + WS_OUT.size + " sortants)");
  const missing = [...WS_IN].filter((t) => !IN_ROLE[t]);
  if (missing.length) console.log("    à documenter : " + missing.join(", "));
}
