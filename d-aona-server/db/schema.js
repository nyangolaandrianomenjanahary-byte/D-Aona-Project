/* =========================================================
   D-aôna — Schéma : amorçage des tables (SQLite, tolérant aux relances)
   ---------------------------------------------------------
   Extrait de db.js (lot S13) : les CREATE TABLE IF NOT EXISTS et les
   ALTER TABLE idempotents qui préparent une base neuve. Les évolutions
   du schéma passent ensuite par les migrations versionnées (migrations/),
   appliquées par db.js au démarrage.
   ========================================================= */
"use strict";

const { db } = require("./core");

/* ---------- Schéma ---------- */
function init() {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo        TEXT    UNIQUE NOT NULL,
    password_hash TEXT,
    phone         TEXT,
    email         TEXT,
    elo           INTEGER DEFAULT 1100,
    wins          INTEGER DEFAULT 0,
    losses        INTEGER DEFAULT 0,
    balance       INTEGER DEFAULT 0,
    bonus_lock    INTEGER DEFAULT 0,
    kyc           INTEGER DEFAULT 0,
    bonus_used    INTEGER DEFAULT 0,
    withdrawn_today INTEGER DEFAULT 0,
    last_seen     TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player1_id  INTEGER NOT NULL,
    player2_id  INTEGER NOT NULL,
    winner_id   INTEGER,
    delta1      INTEGER,
    delta2      INTEGER,
    mode        TEXT,
    format      TEXT,
    wager       INTEGER DEFAULT 0,
    moves_json  TEXT,
    reason      TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS tournaments (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    game        TEXT,
    format      TEXT,
    entry       INTEGER,
    max_players INTEGER DEFAULT 8,
    status      TEXT DEFAULT 'inscriptions',
    min_rank    TEXT DEFAULT 'Bronze',
    sponsor     TEXT,
    starts_at   TEXT,
    results_json TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);
  // Migration : durée d'un match + intervalle entre matchs (en minutes). Version finale :
  // starts_at du match i = heure_début + index*(durée+intervalle). Pour le test d'aujourd'hui
  // (interval_min=0), aucun intervalle et lancement libre dès les confirmations.
  /* Les ALTER ci-dessous sont des migrations idempotentes : la colonne peut
     déjà exister (base créée après coup) — l'erreur est ATTENDUE et ignorée. */
  try { db.exec("ALTER TABLE tournaments ADD COLUMN match_duration_min INTEGER DEFAULT 5"); } catch (e) {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN interval_min INTEGER DEFAULT 5"); } catch (e) {}
  db.exec(`CREATE TABLE IF NOT EXISTS tournament_registrations (
    tournament_id INTEGER NOT NULL,
    user_id       INTEGER NOT NULL,
    registered_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (tournament_id, user_id)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    dir         TEXT,
    label       TEXT,
    amount      INTEGER,
    status      TEXT,
    ref_id      TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id   INTEGER NOT NULL,
    text         TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_users ON chat_messages(from_user_id, to_user_id);");
  db.exec(`CREATE TABLE IF NOT EXISTS user_skins (
    user_id     INTEGER NOT NULL,
    skin_id     TEXT NOT NULL,
    acquired_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, skin_id)
  );`);
  /* ATTENTION — schéma d'AMORÇAGE : il doit être celui qu'attendent les
     migrations, pas la forme finale. `equipped_skins` naît donc ici avec les
     trois colonnes d'origine (`pions`), puis la chaîne de migrations la fait
     évoluer : 005 ajoute la clé étrangère, 008 scinde `pions` en `pions_light` /
     `pions_dark`. Déclarer directement la forme finale ici casse la 005
     (« no such column: pions ») sur une base neuve — c'est-à-dire le chemin
     `wipe_db.js --yes` puis redémarrage. */
  db.exec(`CREATE TABLE IF NOT EXISTS equipped_skins (
    user_id INTEGER PRIMARY KEY,
    pions   TEXT,
    plateau TEXT,
    effet   TEXT
  );`);
  /* Personnalisation du pion : UNE ligne par compte, deux colonnes SÉPARÉES.
     Aucune combinaison n'est stockée (ni ici ni ailleurs) : la couleur et le
     motif sont deux choix indépendants, que la migration 009 a repris des anciens
     skins de pions déjà achetés — aucun achat perdu. */
  db.exec(`CREATE TABLE IF NOT EXISTS pion_style (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    color   TEXT NOT NULL DEFAULT 'blanc',
    pattern TEXT NOT NULL DEFAULT 'aucun'
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS challenges (
    id          TEXT PRIMARY KEY,
    from_id     INTEGER NOT NULL,
    to_id       INTEGER NOT NULL,
    wager       INTEGER DEFAULT 0,
    format      TEXT,
    status      TEXT DEFAULT 'pending',
    created_at  TEXT DEFAULT (datetime('now')),
    expires_at  TEXT
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS game_sessions (
    id          TEXT PRIMARY KEY,
    player1_id  INTEGER NOT NULL,
    player2_id  INTEGER NOT NULL,
    mode        TEXT,
    format      TEXT,
    wager       INTEGER DEFAULT 0,
    state_json  TEXT NOT NULL,
    winner_id   INTEGER,
    moves_json  TEXT,
    status      TEXT DEFAULT 'playing',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS friends (
    user_id     INTEGER NOT NULL,
    friend_id   INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, friend_id)
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);");
  db.exec(`CREATE TABLE IF NOT EXISTS friend_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     INTEGER NOT NULL,
    to_id       INTEGER NOT NULL,
    status      TEXT DEFAULT 'pending',
    created_at  TEXT DEFAULT (datetime('now')),
    responded_at TEXT,
    UNIQUE(from_id, to_id)
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_freq_to ON friend_requests(to_id, status);");
  // Migration : colonne province (classement provincial) — remplace l'ancienne colonne region
  try { db.exec("ALTER TABLE users ADD COLUMN province TEXT DEFAULT 'Antananarivo'"); } catch (e) {}
  // Migration des anciennes régions vers les 6 provinces
  const regionToProvince = {
    "Analamanga": "Antananarivo", "Itasy": "Antananarivo", "Vakinankaratra": "Antananarivo", "Bongolava": "Antananarivo",
    "Diana": "Antsiranana", "Sava": "Antsiranana",
    "Matsiatra Ambony": "Fianarantsoa", "Amoron'i Mania": "Fianarantsoa", "Vatovavy": "Fianarantsoa", "Fitovinany": "Fianarantsoa", "Atsimo-Atsinanana": "Fianarantsoa", "Ihorombe": "Fianarantsoa",
    "Boeny": "Mahajanga", "Sofia": "Mahajanga", "Betsiboka": "Mahajanga", "Melaky": "Mahajanga",
    "Atsinanana": "Toamasina", "Analanjirofo": "Toamasina", "Ambatosoa": "Toamasina", "Alaotra-Mangoro": "Toamasina",
    "Menabe": "Toliara", "Atsimo-Andrefana": "Toliara", "Androy": "Toliara", "Anosy": "Toliara"
  };
  try {
    const rows = db.prepare("SELECT id, region FROM users WHERE region IS NOT NULL AND region != ''").all();
    const upd = db.prepare("UPDATE users SET province = ? WHERE id = ?");
    for (const r of rows) { upd.run(regionToProvince[r.region] || "Antananarivo", r.id); }
  } catch (e) {}
  // Migration : suivi de la dernière pénalité d'inactivité
  try { db.exec("ALTER TABLE users ADD COLUMN last_decay TEXT"); } catch (e) {}
  // Migration : photo de profil (chemin fichier sur le serveur)
  try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL"); } catch (e) {}
  // Migration : colonne region (ancienne, remplacée par province)
  try { db.exec("ALTER TABLE users ADD COLUMN region TEXT DEFAULT NULL"); } catch (e) {}

  // ---------- Notifications centralisées (PRD — onglet Notifications) ----------
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT NOT NULL,
    payload_json TEXT,
    read        INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at);");

  // ---------- Bracket de tournoi réel (élimination directe) ----------
  db.exec(`CREATE TABLE IF NOT EXISTS tournament_matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    round        INTEGER NOT NULL,
    slot         INTEGER NOT NULL,
    p1_id        INTEGER,
    p2_id        INTEGER,
    score1       INTEGER,
    score2       INTEGER,
    winner_id    INTEGER,
    status       TEXT DEFAULT 'a_venir',
    starts_at    TEXT,
    confirm_deadline TEXT,
    confirmed_p1 INTEGER DEFAULT 0,
    confirmed_p2 INTEGER DEFAULT 0,
    next_match_id INTEGER,
    created_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(tournament_id, round, slot)
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tm_tournament ON tournament_matches(tournament_id, round, slot);");
}

module.exports = { init };
