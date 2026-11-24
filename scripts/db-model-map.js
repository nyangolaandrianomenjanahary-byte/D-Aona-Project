/* =========================================================
   D-aôna — Décisions de modèle de données (source unique)
   ---------------------------------------------------------
   Ce fichier est la SEULE définition de :
     · ce que contient chaque domaine fonctionnel ;
     · les colonnes converties en boolean / timestamptz / date ;
     · les clés étrangères décidées et leur comportement à la suppression ;
     · les colonnes sensibles (secrets, données personnelles).

   Il est consommé par :
     · scripts/gen-db-model.js      → schéma Postgres + docs/DATA-MODEL.md
     · scripts/migrate-sqlite-to-pg.js → conversion des valeurs à l'import
     · scripts/verify-parity.js     → comparaison des deux bases

   Pourquoi ici et pas dans chacun des trois : trois copies d'une même règle
   finissent toujours par diverger, et c'est la plus faible qui gagne.
   ========================================================= */
"use strict";

/* ---------- Domaines, description, colonnes sensibles ---------- */
const DOMAINS = {
  "Identité & accès": {
    users: ["Compte joueur : profil public, Elo, solde, état KYC.", []],
    auth_credentials: ["Empreinte Argon2id, verrouillage progressif par échecs. Remplacé par Supabase Auth (lot L7).", ["password_hash"]],
    sessions: ["Jetons de session opaques, stockés HACHÉS (jamais en clair). Remplacé par les JWT Supabase (lot L7).", ["token_hash"]],
    auth_audit_log: ["Journal d'authentification : connexions, échecs, révocations.", []],
  },
  Administration: {
    admin_roles: ["Rôles d'administration (super_admin, admin, observer…).", []],
    admin_assignments: ["Qui détient quel rôle, et depuis quand.", []],
    admin_grants: ["Matrice rôle × module × action (le droit effectif).", []],
    admin_modules: ["Modules du back-office et leur interrupteur global.", []],
    admin_games: ["Fiche des plateaux exposés par l'administration.", []],
    admin_audit: ["Journal des actions sensibles du back-office.", []],
    platform_settings: ["Réglages globaux clé/valeur (inscriptions ouvertes, etc.).", []],
    user_sanctions: ["Sanctions appliquées à un compte (avertissement, suspension).", []],
  },
  Jeu: {
    games: ["Historique des parties terminées : camps, Elo avant/après, motif.", []],
    game_sessions: ["Instantané sérialisé d'une partie en cours (reprise après redémarrage).", []],
    challenges: ["Défi d'un joueur à un autre, avec mise et échéance.", []],
  },
  Tournois: {
    tournaments: ["Tournoi : format, droits d'entrée, horaires de matchs.", []],
    tournament_matches: ["Bracket d'élimination directe : rounds, confirmations, forfaits.", []],
    tournament_registrations: ["Inscriptions d'un joueur à un tournoi.", []],
  },
  Social: {
    chat_messages: ["Messages privés entre deux joueurs.", []],
    friends: ["Relations d'amitié (deux lignes par paire, une par sens).", []],
    friend_requests: ["Demandes d'ami en attente / acceptées.", []],
    notifications: ["Notifications persistantes d'un compte.", []],
  },
  Contenu: {
    ads: ["Bannières publicitaires du carrousel (actif, période, ordre).", []],
  },
  Classement: {
    badges: ["Paliers de classement (nom, icône, rang min/max).", []],
  },
  Personnalisation: {
    user_skins: ["Skins possédés par un joueur.", []],
    equipped_skins: ["Skins équipés (plateau, pions clairs, pions sombres).", []],
    pion_style: ["Apparence du pion par camp (couleur, motif, forme).", []],
  },
  Économie: {
    transactions: ["Grand livre du portefeuille : chaque mouvement d'ariary, avec son état.", ["amount"]],
    withdrawals: ["Demandes de retrait instruites par le back-office.", ["phone"]],
    disputes: ["Litiges ouverts sur une partie, avec issue et résolution.", []],
  },
  Conformité: {
    kyc_cases: ["Dossiers d'identité (recto/verso/visage). DONNÉES PERSONNELLES SENSIBLES : chemins privés, jamais servis en statique.", ["recto_path", "verso_path", "face_path", "recto_sha", "verso_sha", "face_sha"]],
  },
  Infrastructure: {
    schema_migrations: ["Registre des migrations SQLite déjà appliquées. Remplacé par supabase/migrations.", []],
  },
};

/* Colonnes publiques portant une donnée personnelle. */
const PII = {
  users: ["phone", "email", "first_name", "last_name", "birth_date"],
  withdrawals: ["phone"],
};

/* Colonnes converties en BOOLEAN : SQLite stocke 0/1, Postgres attend true/false. */
const BOOLEANS = new Set([
  "users.kyc", "users.bonus_lock", "users.bonus_used",
  "notifications.read",
  "tournament_matches.confirmed_p1", "tournament_matches.confirmed_p2",
  "admin_grants.allowed", "admin_modules.enabled", "admin_modules.core",
  "admin_roles.protected", "admin_games.ranked", "ads.actif",
  "kyc_cases.face_required",
]);

/* Dates civiles (pas des instants) : `date` et non `timestamptz`. */
const DATES = new Set(["users.birth_date"]);

/* Colonnes d'horodatage : `timestamptz`. Liste explicite — une heuristique
   sur le suffixe `_at` attraperait `birth_date`, et oublierait `at`. */
const TIMESTAMPS = new Set([
  "admin_assignments.granted_at", "admin_audit.at", "admin_games.created_at", "admin_games.updated_at",
  "admin_modules.updated_at", "ads.debut", "ads.fin", "ads.created_at", "ads.updated_at",
  "auth_audit_log.at", "auth_credentials.password_changed_at", "auth_credentials.last_failed_at",
  "auth_credentials.locked_until", "auth_credentials.created_at", "auth_credentials.updated_at",
  "challenges.created_at", "challenges.expires_at", "chat_messages.created_at", "disputes.created_at",
  "disputes.resolved_at", "friend_requests.created_at", "friend_requests.responded_at", "friends.created_at",
  "game_sessions.created_at", "game_sessions.updated_at", "games.created_at", "kyc_cases.submitted_at",
  "kyc_cases.reviewed_at", "kyc_cases.face_captured_at", "kyc_cases.face_consent_at", "kyc_cases.retention_until",
  "notifications.created_at", "platform_settings.updated_at", "schema_migrations.applied_at",
  "sessions.created_at", "sessions.last_used_at", "sessions.expires_at", "sessions.revoked_at",
  "tournament_matches.starts_at", "tournament_matches.confirm_deadline", "tournament_matches.created_at",
  "tournament_registrations.registered_at", "tournaments.starts_at", "tournaments.created_at",
  "transactions.created_at", "user_sanctions.created_at", "user_sanctions.lifted_at",
  "user_skins.acquired_at", "users.last_seen", "users.created_at", "users.last_decay",
  "withdrawals.created_at", "withdrawals.reviewed_at", "withdrawals.paid_at",
]);

/* Clés étrangères : décidées, pas devinées. `onDelete` explicite.
   CASCADE  = la ligne n'a aucun sens sans le compte (profil, préférences).
   SET NULL = référence facultative (gagnant, acteur, réviseur).
   NO ACTION= historique : on ne supprime pas un compte qui a des parties.
   `transactions.user_id` est volontairement ABSENTE : 66 lignes de la base
   réelle pointent vers des comptes supprimés (246 000 Ar). La contrainte
   s'activera après nettoyage — jamais en silence (voir DATA-MODEL.md §6). */
const FK = [
  ["auth_credentials", "user_id", "users", "id", "CASCADE"],
  ["sessions", "user_id", "users", "id", "CASCADE"],
  ["equipped_skins", "user_id", "users", "id", "CASCADE"],
  ["pion_style", "user_id", "users", "id", "CASCADE"],
  ["user_skins", "user_id", "users", "id", "CASCADE"],
  ["friends", "user_id", "users", "id", "CASCADE"],
  ["friends", "friend_id", "users", "id", "CASCADE"],
  ["friend_requests", "from_id", "users", "id", "CASCADE"],
  ["friend_requests", "to_id", "users", "id", "CASCADE"],
  ["chat_messages", "from_user_id", "users", "id", "CASCADE"],
  ["chat_messages", "to_user_id", "users", "id", "CASCADE"],
  ["notifications", "user_id", "users", "id", "CASCADE"],
  ["user_sanctions", "user_id", "users", "id", "CASCADE"],
  ["user_sanctions", "actor_id", "users", "id", "SET NULL"],
  ["withdrawals", "user_id", "users", "id", "NO ACTION"],
  ["withdrawals", "reviewed_by", "users", "id", "SET NULL"],
  ["withdrawals", "paid_by", "users", "id", "SET NULL"],
  ["kyc_cases", "user_id", "users", "id", "CASCADE"],
  ["kyc_cases", "reviewer_id", "users", "id", "SET NULL"],
  ["challenges", "from_id", "users", "id", "CASCADE"],
  ["challenges", "to_id", "users", "id", "CASCADE"],
  ["games", "player1_id", "users", "id", "NO ACTION"],
  ["games", "player2_id", "users", "id", "NO ACTION"],
  ["games", "winner_id", "users", "id", "SET NULL"],
  ["game_sessions", "player1_id", "users", "id", "CASCADE"],
  ["game_sessions", "player2_id", "users", "id", "CASCADE"],
  ["game_sessions", "winner_id", "users", "id", "SET NULL"],
  ["game_sessions", "game_record_id", "games", "id", "SET NULL"],
  ["disputes", "match_id", "games", "id", "CASCADE"],
  ["disputes", "user_id", "users", "id", "SET NULL"],
  ["disputes", "resolved_by", "users", "id", "SET NULL"],
  ["admin_assignments", "user_id", "users", "id", "CASCADE"],
  ["admin_assignments", "role_id", "admin_roles", "id", "CASCADE"],
  ["admin_assignments", "granted_by", "users", "id", "SET NULL"],
  ["admin_grants", "role_id", "admin_roles", "id", "CASCADE"],
  ["admin_grants", "module", "admin_modules", "id", "CASCADE"],
  ["admin_audit", "actor_id", "users", "id", "SET NULL"],
  /* `tournaments.game` N'EST PAS une clé étrangère : la colonne contient un
     LIBELLÉ (« Fanorona », « fanorana »), pas un slug de `admin_games`. Mesuré :
     8 tournois sur 8 ne correspondent à aucun slug. La normaliser (stocker
     `fanoron-tsivy`) est une migration de données, pas une contrainte de schéma. */
  ["tournament_registrations", "tournament_id", "tournaments", "id", "CASCADE"],
  ["tournament_registrations", "user_id", "users", "id", "CASCADE"],
  ["tournament_matches", "tournament_id", "tournaments", "id", "CASCADE"],
  ["tournament_matches", "p1_id", "users", "id", "SET NULL"],
  ["tournament_matches", "p2_id", "users", "id", "SET NULL"],
  ["tournament_matches", "winner_id", "users", "id", "SET NULL"],
  ["tournament_matches", "next_match_id", "tournament_matches", "id", "SET NULL"],
  ["users", "friends_seen_request_id", "friend_requests", "id", "SET NULL"],
];

/* ---------- Helpers de mapping, partagés ---------- */
function pgType(table, col) {
  const key = table + "." + col.name;
  if (BOOLEANS.has(key)) return "boolean";
  if (DATES.has(key)) return "date";
  if (TIMESTAMPS.has(key)) return "timestamptz";
  const raw = String(col.type || "").toUpperCase();
  if (raw.includes("INT")) return "bigint";
  if (raw.includes("REAL") || raw.includes("FLOA") || raw.includes("DOUB")) return "double precision";
  if (raw.includes("BLOB")) return "bytea";
  if (raw.includes("NUM")) return "numeric";
  return "text";
}

/* Défaut SQLite → défaut Postgres. */
function pgDefault(table, col) {
  const v = col.dflt_value;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (/^datetime\('now'\)$/i.test(s) || /^CURRENT_TIMESTAMP$/i.test(s)) return "now()";
  if (/^date\('now'\)$/i.test(s)) return "CURRENT_DATE";
  if (s === "NULL") return null;
  const key = table + "." + col.name;
  if (BOOLEANS.has(key)) return s === "1" ? "true" : s === "0" ? "false" : null;
  if (/^-?\d+$/.test(s)) return s;
  return s;
}

/* Conversion d'une valeur SQLite vers la valeur attendue par Postgres.
   Utilisée par l'import : sans elle, un `1` booleen fait échouer l'INSERT. */
function toPgValue(table, colName, value, colType) {
  if (value === null || value === undefined) return null;
  const key = table + "." + colName;
  if (BOOLEANS.has(key)) return value === 1 || value === "1" || value === true;
  if (DATES.has(key)) return String(value).slice(0, 10);
  if (TIMESTAMPS.has(key)) {
    const s = String(value).trim();
    if (!s) return null;
    /* SQLite écrit « 2026-11-24 19:46:19 » (UTC, sans fuseau) : on le déclare
       explicitement UTC plutôt que de laisser Postgres deviner le fuseau local. */
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return s.replace(" ", "T") + "Z";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) return s + "Z";
    return s;
  }
  if (String(colType).toUpperCase().includes("INT")) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return value;
}

module.exports = { DOMAINS, PII, BOOLEANS, DATES, TIMESTAMPS, FK, pgType, pgDefault, toPgValue };
