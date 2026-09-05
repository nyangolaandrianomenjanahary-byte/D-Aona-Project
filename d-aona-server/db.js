/* =========================================================
   D-aôna — Module de base de données (SQLite)
   ========================================================= */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const DB_PATH = path.join(__dirname, "d-aona.db");
const db = new DatabaseSync(DB_PATH);

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
  db.exec(`CREATE TABLE IF NOT EXISTS equipped_skins (
    user_id INTEGER PRIMARY KEY,
    pions   TEXT,
    plateau TEXT,
    effet   TEXT
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
init();

/* ---------- Helpers ---------- */
function now() { return new Date().toISOString(); }

/* ---------- Utilisateurs ---------- */
const User = {
  getById(id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!row) return null;
    return { ...row, kyc: !!row.kyc, bonus_used: !!row.bonus_used };
  },
  getByPseudo(pseudo) {
    const row = db.prepare("SELECT * FROM users WHERE pseudo = ?").get(pseudo);
    if (!row) return null;
    return { ...row, kyc: !!row.kyc, bonus_used: !!row.bonus_used };
  },
  createOrUpdate(pseudo) {
    let user = this.getByPseudo(pseudo);
    if (!user) {
      const stmt = db.prepare("INSERT INTO users (pseudo, elo, balance) VALUES (?, 1100, 5000)");
      const info = stmt.run(pseudo);
      user = this.getById(info.lastInsertRowid);
      db.prepare("INSERT OR IGNORE INTO equipped_skins (user_id, pions, plateau, effet) VALUES (?, 'pions-classique', NULL, NULL)").run(user.id);
      db.prepare("INSERT OR IGNORE INTO user_skins (user_id, skin_id) VALUES (?, 'pions-classique')").run(user.id);
    } else {
      db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now(), user.id);
    }
    return user;
  },
  update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length || !id) return;
    const set = keys.map((k) => `${k} = ?`).join(", ");
    // SQLite ne lie que number/string/null — convertir les booléens en 0/1
    const vals = [...keys.map((k) => (typeof fields[k] === "boolean" ? (fields[k] ? 1 : 0) : fields[k])), id];
    db.prepare(`UPDATE users SET ${set} WHERE id = ?`).run(...vals);
  },
  listAll() {
    return db.prepare("SELECT id, pseudo, elo, wins, losses, province, avatar, last_seen, last_decay FROM users ORDER BY elo DESC").all();
  },
};

/* ---------- Pénalité d'inactivité : −30 Elo / mois après 30 j sans partie ---------- */
const INACTIVITY = { DELAY_DAYS: 30, PENALTY: 30, FLOOR: 100 };
function applyInactivityDecay() {
  const users = db.prepare("SELECT id, elo, last_seen, last_decay FROM users").all();
  const nowMs = Date.now();
  const changed = [];
  for (const u of users) {
    const ref = u.last_seen || u.last_decay;
    if (!ref) continue;
    const refMs = new Date(ref.includes("T") ? ref : ref.replace(" ", "T") + "Z").getTime();
    const daysIdle = (nowMs - refMs) / 86400000;
    if (daysIdle < INACTIVITY.DELAY_DAYS) continue;
    const months = Math.floor(daysIdle / 30);
    if (months < 1) continue;
    const alreadyApplied = u.last_decay
      ? Math.floor((new Date(u.last_decay.includes("T") ? u.last_decay : u.last_decay.replace(" ", "T") + "Z").getTime() - refMs) / (30 * 86400000))
      : 0;
    const toApply = months - alreadyApplied;
    if (toApply <= 0) continue;
    const newElo = Math.max(INACTIVITY.FLOOR, u.elo - toApply * INACTIVITY.PENALTY);
    db.prepare("UPDATE users SET elo = ?, last_decay = ? WHERE id = ?").run(newElo, now(), u.id);
    changed.push({ id: u.id, lost: u.elo - newElo });
  }
  return changed;
}

/* ---------- Parties (historique) ---------- */
const GameRecord = {
  create(p1Id, p2Id, mode, format, wager) {
    const r = db.prepare(
      "INSERT INTO games (player1_id, player2_id, mode, format, wager, reason) VALUES (?, ?, ?, ?, ?, 'en_cours')"
    ).run(p1Id, p2Id, mode, format, wager);
    return r.lastInsertRowid;
  },
  finish(id, winnerId, delta1, delta2, moves, reason) {
    db.prepare(
      "UPDATE games SET winner_id = ?, delta1 = ?, delta2 = ?, moves_json = ?, reason = ? WHERE id = ?"
    ).run(winnerId, delta1, delta2, JSON.stringify(moves || []), reason, id);
  },
  listForUser(userId, limit = 50) {
    return db.prepare(`
      SELECT g.*, u1.pseudo as p1_name, u2.pseudo as p2_name
      FROM games g JOIN users u1 ON g.player1_id = u1.id
      JOIN users u2 ON g.player2_id = u2.id
      WHERE g.player1_id = ? OR g.player2_id = ?
      ORDER BY g.created_at DESC LIMIT ?
    `).all(userId, userId, limit);
  },
};

/* ---------- Tournois ---------- */
const Tournament = {
  list() { return db.prepare("SELECT * FROM tournaments ORDER BY starts_at ASC").all(); },
  get(id) { return db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id); },
  getRegistrations(tournamentId) {
    return db.prepare(
      `SELECT u.id, u.pseudo, u.elo FROM tournament_registrations tr
       JOIN users u ON tr.user_id = u.id WHERE tr.tournament_id = ?`
    ).all(tournamentId);
  },
  isRegistered(userId, tournamentId) {
    return !!db.prepare("SELECT 1 FROM tournament_registrations WHERE tournament_id = ? AND user_id = ?").get(tournamentId, userId);
  },
  register(userId, tournamentId) {
    db.prepare("INSERT OR IGNORE INTO tournament_registrations (tournament_id, user_id) VALUES (?, ?)").run(tournamentId, userId);
  },
  setResults(tournamentId, results) {
    db.prepare("UPDATE tournaments SET status='termine', results_json=? WHERE id=?")
      .run(JSON.stringify(results), tournamentId);
  },
  seed() {
    const count = db.prepare("SELECT COUNT(*) as c FROM tournaments").get();
    if (count && count.c > 0) return;
    const now = Date.now();
    const seedData = [
      { id: 1, name: "Tournoi Hebdo Fanorona #24", game: "Fanorona", format: "rapide",
        entry: 2000, max_players: 8, status: "inscriptions", min_rank: "Bronze",
        sponsor: null, starts_at: new Date(now+2*86400000+4*3600000+1800000).toISOString() },
      { id: 2, name: "Blitz Cup — Analamanga", game: "Fanorona", format: "blitz",
        entry: 1000, max_players: 8, status: "inscriptions", min_rank: "Bronze",
        sponsor: null, starts_at: new Date(now+5*3600000+720000).toISOString() },
      { id: 3, name: "D-aôna Masters — Saison 2", game: "Fanorona", format: "pro",
        entry: 5000, max_players: 8, status: "inscriptions", min_rank: "Platine",
        sponsor: "MVola Gaming Cup", starts_at: new Date(now+6*86400000+3600000).toISOString() },
      { id: 4, name: "Tournoi Hebdo Fanorona #23", game: "Fanorona", format: "rapide",
        entry: 2000, max_players: 8, status: "termine", min_rank: "Bronze",
        sponsor: null, starts_at: new Date(now-3*86400000).toISOString(),
        results_json: JSON.stringify({first:"SolofoGM",second:"ZoFighter",third:"KantoV"}) },
      /* Tournoi de TEST — 8 joueurs, entrée libre (Bronze = rang le plus bas → aucune condition
         d'Elo, de classement ni de badge), cache d'inscription 5000 Ar, dispo tout de suite.
         Le bracket se génère automatiquement dès que 8 joueurs réels se sont inscrits. */
      /* Tournoi de TEST — 4 joueurs, entrée libre (Bronze = rang le plus bas → aucune condition
         d'Elo, de classement ni de badge), cache d'inscription 5000 Ar, dispo tout de suite.
         Mode test : interval_min=0 → aucun intervalle entre matchs, lancement libre dès
         que les 2 joueurs d'un match ont confirmé (indépendant des autres matchs). */
      { id: 5, name: "Tournoi Test ⚔️", game: "Fanorona", format: "rapide",
        entry: 5000, max_players: 4, status: "inscriptions", min_rank: "Bronze",
        sponsor: null, starts_at: new Date(now+15*60000).toISOString(),
        match_duration_min: 5, interval_min: 0 },
    ];
    db.exec("BEGIN");
    const stmt = db.prepare(
      "INSERT INTO tournaments (id,name,game,format,entry,max_players,status,min_rank,sponsor,starts_at,results_json,match_duration_min,interval_min) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    for (const r of seedData) stmt.run(
      r.id, r.name, r.game, r.format, r.entry, r.max_players, r.status,
      r.min_rank, r.sponsor, r.starts_at, r.results_json || null,
      r.match_duration_min ?? 5, r.interval_min ?? 5
    );
    db.exec("COMMIT");
  },
};

/* ---------- Wallet ---------- */
const Wallet = {
  getBalance(userId) {
    const row = db.prepare("SELECT balance, bonus_lock FROM users WHERE id = ?").get(userId);
    return row ? { balance: row.balance, bonus_lock: row.bonus_lock } : null;
  },
  addTransaction(userId, dir, label, amount, status = null, refId = null) {
    db.prepare("INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES (?,?,?,?,?,?)")
      .run(userId, dir, label, amount, status, refId || null);
    if (dir === "in") db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, userId);
    else db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, userId);
  },
  credit(userId, amount, label, locked = false) {
    if (locked) db.prepare("UPDATE users SET bonus_lock = bonus_lock + ? WHERE id = ?").run(amount, userId);
    this.addTransaction(userId, "in", label, amount);
  },
  spend(userId, amount, label) {
    const bal = this.getBalance(userId);
    if (!bal) return;
    const fromBonus = Math.min(bal.bonus_lock, amount);
    db.prepare("UPDATE users SET bonus_lock = bonus_lock - ?, balance = balance - ? WHERE id = ?")
      .run(fromBonus, amount, userId);
    this.addTransaction(userId, "out", label, amount);
  },
  getTransactions(userId, limit = 50) {
    return db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
  },
};

/* ---------- Chat ---------- */
const Chat = {
  saveMessage(fromId, toId, text) {
    db.prepare("INSERT INTO chat_messages (from_user_id, to_user_id, text) VALUES (?,?,?)").run(fromId, toId, text);
  },
  getThread(userId, otherId) {
    return db.prepare(`
      SELECT m.*, CASE WHEN m.from_user_id = ? THEN 'me' ELSE 'them' END as direction
      FROM chat_messages m
      WHERE (m.from_user_id = ? AND m.to_user_id = ?) OR (m.from_user_id = ? AND m.to_user_id = ?)
      ORDER BY m.created_at ASC
    `).all(userId, userId, otherId, otherId, userId);
  },
  getContacts(userId) {
    const rows = db.prepare(`
      SELECT DISTINCT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END as other_id,
             MAX(created_at) as last_at
      FROM chat_messages WHERE from_user_id = ? OR to_user_id = ?
      GROUP BY other_id ORDER BY last_at DESC
    `).all(userId, userId, userId);
    const contacts = [];
    for (const row of rows) {
      const user = User.getById(row.other_id);
      if (user) contacts.push({ id: user.id, pseudo: user.pseudo, last_at: row.last_at });
    }
    return contacts;
  },
};

/* ---------- Amis ---------- */
const FriendRequest = {
  send(fromId, toId) {
    if (fromId === toId) return { ok: false, error: "Impossible de s'envoyer une demande à soi-même" };
    if (Friend.areFriends(fromId, toId)) return { ok: false, error: "Déjà amis" };
    const dup = db.prepare("SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").get(fromId, toId);
    if (dup) return { ok: false, error: "Demande déjà envoyée", id: dup.id };
    // Relance possible après un refus ou une ancienne demande traitée
    db.prepare("DELETE FROM friend_requests WHERE from_id = ? AND to_id = ? AND status != 'pending'").run(fromId, toId);
    const r = db.prepare("INSERT INTO friend_requests (from_id, to_id) VALUES (?, ?)").run(fromId, toId);
    return { ok: true, id: r.lastInsertRowid };
  },
  get(id) { return db.prepare("SELECT * FROM friend_requests WHERE id = ?").get(id); },
  accept(id) {
    db.prepare("UPDATE friend_requests SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(id);
  },
  decline(id) {
    db.prepare("UPDATE friend_requests SET status = 'declined', responded_at = datetime('now') WHERE id = ?").run(id);
  },
  incoming(userId) {
    return db.prepare(`
      SELECT fr.id, fr.from_id, fr.created_at, u.pseudo, u.elo, u.avatar, u.province
      FROM friend_requests fr JOIN users u ON u.id = fr.from_id
      WHERE fr.to_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC
    `).all(userId);
  },
  outgoing(userId) {
    return db.prepare(`
      SELECT fr.id, fr.to_id, fr.created_at, u.pseudo, u.elo, u.avatar, u.province
      FROM friend_requests fr JOIN users u ON u.id = fr.to_id
      WHERE fr.from_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC
    `).all(userId);
  },
  pendingBetween(a, b) {
    const row = db.prepare(`
      SELECT id, from_id, to_id FROM friend_requests
      WHERE status = 'pending' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
    `).get(a, b, b, a);
    if (!row) return null;
    return { id: row.id, direction: row.from_id === a ? "outgoing" : "incoming" };
  },
};

const Friend = {
  add(userId, friendId) {
    if (userId === friendId) return { ok: false, error: "Impossible de s'ajouter soi-même" };
    const exists = db.prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?").get(userId, friendId);
    if (exists) return { ok: false, error: "Déjà amis" };
    db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)").run(userId, friendId);
    return { ok: true };
  },
  remove(userId, friendId) {
    db.prepare("DELETE FROM friends WHERE user_id = ? AND friend_id = ?").run(userId, friendId);
    return { ok: true };
  },
  areFriends(userId, friendId) {
    return !!db.prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?").get(userId, friendId);
  },
  list(userId) {
    return db.prepare(`
      SELECT u.id, u.pseudo, u.elo, u.wins, u.losses, f.created_at
      FROM friends f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ? ORDER BY u.elo DESC
    `).all(userId);
  },
  search(userId, q) {
    const like = "%" + q + "%";
    return db.prepare(`
      SELECT id, pseudo, elo, wins, losses FROM users
      WHERE pseudo LIKE ? AND id != ? ORDER BY elo DESC LIMIT 20
    `).all(like, userId);
  },
};

/* ---------- Skins ---------- */
const Skins = {
  listOwned(userId) {
    return db.prepare("SELECT skin_id FROM user_skins WHERE user_id = ?").all(userId).map((r) => r.skin_id);
  },
  getEquipped(userId) {
    const row = db.prepare("SELECT pions, plateau, effet FROM equipped_skins WHERE user_id = ?").get(userId);
    return row ? { pions: row.pions, plateau: row.plateau, effet: row.effet }
      : { pions: "pions-classique", plateau: null, effet: null };
  },
  buy(userId, skinId, price) {
    const owned = this.listOwned(userId);
    if (owned.includes(skinId)) return { ok: false, error: "Deja possede" };
    db.prepare("INSERT INTO user_skins (user_id, skin_id) VALUES (?, ?)").run(userId, skinId);
    return { ok: true, price };
  },
  equip(userId, kind, skinId) {
    const col = kind === "pions" ? "pions" : kind === "plateau" ? "plateau" : "effet";
    db.prepare(`UPDATE equipped_skins SET ${col} = ? WHERE user_id = ?`).run(skinId, userId);
    return { ok: true };
  },
};

/* ---------- Challenge (defis) ---------- */
const Challenge = {
  create(fromId, toId, wager, format) {
    const id = "DF-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const expires = Date.now() + 15 * 60 * 1000;
    db.prepare(
      "INSERT INTO challenges (id, from_id, to_id, wager, format, status, expires_at) VALUES (?,?,?,?,?,'pending',datetime(?,'unixepoch'))"
    ).run(id, fromId, toId, wager, format, Math.floor(expires / 1000));
    return { id, expires_at: expires };
  },
  getByUser(userId) {
    return db.prepare(`
      SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo
      FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
      WHERE c.to_id = ? AND c.status = 'pending' ORDER BY c.created_at DESC
    `).all(userId);
  },
  get(id) {
    return db.prepare(`
      SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo
      FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
      WHERE c.id = ?
    `).get(id);
  },
  listSent(userId) {
    return db.prepare(`
      SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo
      FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
      WHERE c.from_id = ? ORDER BY c.created_at DESC
    `).all(userId);
  },
  update(id, status) {
    db.prepare("UPDATE challenges SET status = ? WHERE id = ?").run(status, id);
  },
  delete(id) {
    db.prepare("DELETE FROM challenges WHERE id = ?").run(id);
  },
};

/* ---------- Sessions de jeu ---------- */
const GameSessionStore = {
  create(id, p1Id, p2Id, mode, format, wager) {
    db.prepare(
      "INSERT INTO game_sessions (id, player1_id, player2_id, mode, format, wager, state_json, status) VALUES (?,?,?,?,?,?,?,'playing')"
    ).run(id, p1Id, p2Id, mode, format, wager, "");
  },
  get(id) { return db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(id); },
  updateState(id, state) {
    db.prepare("UPDATE game_sessions SET state_json=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(state), id);
  },
  setStatus(id, status, moves, winnerId) {
    const sets = ["status = ?"], vals = [status];
    if (moves !== null) { sets.push("moves_json = ?"); vals.push(JSON.stringify(moves)); }
    if (winnerId !== null) { sets.push("winner_id = ?"); vals.push(winnerId); }
    vals.push(id);
    db.prepare(`UPDATE game_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  },
  delete(id) {
    db.prepare("DELETE FROM game_sessions WHERE id = ?").run(id);
  },
};

/* ---------- Notifications centralisées ---------- */
const Notification = {
  create(userId, type, payload = {}) {
    const r = db.prepare("INSERT INTO notifications (user_id, type, payload_json) VALUES (?,?,?)")
      .run(userId, type, JSON.stringify(payload));
    return r.lastInsertRowid;
  },
  list(userId, limit = 100) {
    return db.prepare(`
      SELECT id, type, payload_json, read, created_at
      FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit).map((r) => ({ ...r, read: !!r.read, payload: safeParse(r.payload_json) }));
  },
  unreadCount(userId) {
    const row = db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0").get(userId);
    return row ? row.c : 0;
  },
  markRead(id, userId) {
    db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(id, userId);
  },
  markAllRead(userId) {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").run(userId);
  },
};

/* ---------- Bracket de tournoi (élimination directe) ---------- */
const TournamentMatch = {
  create(tournamentId, round, slot, data = {}) {
    const r = db.prepare(`
      INSERT INTO tournament_matches
        (tournament_id, round, slot, p1_id, p2_id, score1, score2, winner_id, status, starts_at, confirm_deadline, next_match_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      tournamentId, round, slot,
      data.p1_id ?? null, data.p2_id ?? null,
      data.score1 ?? null, data.score2 ?? null, data.winner_id ?? null,
      data.status ?? 'a_venir', data.starts_at ?? null, data.confirm_deadline ?? null, data.next_match_id ?? null
    );
    return r.lastInsertRowid;
  },
  get(id) { return db.prepare("SELECT * FROM tournament_matches WHERE id = ?").get(id); },
  listByTournament(tournamentId) {
    return db.prepare(`
      SELECT m.*, u1.pseudo as p1_pseudo, u2.pseudo as p2_pseudo, uw.pseudo as winner_pseudo
      FROM tournament_matches m
      LEFT JOIN users u1 ON m.p1_id = u1.id
      LEFT JOIN users u2 ON m.p2_id = u2.id
      LEFT JOIN users uw ON m.winner_id = uw.id
      WHERE m.tournament_id = ? ORDER BY m.round ASC, m.slot ASC
    `).all(tournamentId);
  },
  setPlayers(id, p1Id, p2Id) {
    db.prepare("UPDATE tournament_matches SET p1_id = ?, p2_id = ? WHERE id = ?").run(p1Id, p2Id, id);
  },
  setPlayer(id, which, userId) {
    const col = which === 1 ? "p1_id" : "p2_id";
    db.prepare(`UPDATE tournament_matches SET ${col} = ? WHERE id = ?`).run(userId, id);
  },
  confirm(id, which) {
    const col = which === 1 ? "confirmed_p1" : "confirmed_p2";
    db.prepare(`UPDATE tournament_matches SET ${col} = 1, status = 'confirmation' WHERE id = ?`).run(id);
  },
  setStatus(id, status) {
    db.prepare("UPDATE tournament_matches SET status = ? WHERE id = ?").run(status, id);
  },
  setResult(id, score1, score2, winnerId) {
    db.prepare("UPDATE tournament_matches SET score1 = ?, score2 = ?, winner_id = ?, status = 'termine' WHERE id = ?")
      .run(score1, score2, winnerId, id);
  },
  setNext(id, nextMatchId) {
    db.prepare("UPDATE tournament_matches SET next_match_id = ? WHERE id = ?").run(nextMatchId, id);
  },
  setForfeit(id, winnerId) {
    db.prepare("UPDATE tournament_matches SET status = 'forfait', winner_id = ? WHERE id = ?").run(winnerId, id);
  },
};

function safeParse(json) {
  try { return json ? JSON.parse(json) : {}; } catch (e) { return {}; }
}

module.exports = {
  db, now, applyInactivityDecay, INACTIVITY,
  User, GameRecord, Tournament, Wallet, Chat, Skins, Challenge, GameSessionStore, Friend, FriendRequest,
  Notification, TournamentMatch,
};
