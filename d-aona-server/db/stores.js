/* =========================================================
   D-aôna — Magasins de données : utilisateurs, parties, tournois,
   portefeuille, chat, amis, skins, défis, sessions, notifications
   ---------------------------------------------------------
   Les magasins ne font AUCUN effet de bord au chargement — le schéma
   et les migrations sont appliqués par db.js avant tout usage.
   ========================================================= */
"use strict";

const { db } = require("./core");
const DATA = require("../data");

/* ---------- Helpers ---------- */
function now() { return new Date().toISOString(); }
/* Comparaison de libellé insensible à la casse ET aux accents, pour la
   recherche de l'historique du wallet (« depot » retrouve « Dépôt MVola »). */
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

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
  /* Recherche par adresse e-mail, insensible à la casse. C'est l'identifiant
     demandé pour l'attribution des rôles : deux pseudos peuvent se ressembler
     (« Ifehizoro » et « Ifehizoro7 »), une adresse vérifiée est unique. */
  getByEmail(email) {
    const clean = String(email || "").trim();
    if (!clean) return null;
    const row = db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(clean);
    if (!row) return null;
    return { ...row, kyc: !!row.kyc, bonus_used: !!row.bonus_used };
  },
  createOrUpdate(pseudo) {
    let user = this.getByPseudo(pseudo);
    if (!user) {
      /* `balance` démarre à ZÉRO : le montant d'ouverture est crédité juste
         après, par une écriture. Poser 5000 ici créait un solde sans trace
         comptable — le compte violait l'invariant financier dès sa création. */
      const stmt = db.prepare("INSERT INTO users (pseudo, elo, balance) VALUES (?, 1100, 0)");
      const info = stmt.run(pseudo);
      user = this.getById(info.lastInsertRowid);
      Wallet.opening(user.id);
      Skins.ensureDefaults(user.id);
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
  /* `game` = identifiant du plateau (dossier de jeu). Sans lui, l historique
     d un joueur melangeait Tsivy, Dimy et Telo sous la meme etiquette. Le
     defaut garde les appels historiques (et les lignes anterieurs a la
     migration 015) sur le Fanoron-Tsivy. */
  create(p1Id, p2Id, mode, format, wager, game) {
    /* `status = 'live'` des la CREATION : sans cela, la colonne prenait son
       defaut de la migration 018 (`'finished'`), si bien qu'une partie en
       cours s'affichait « terminee sans vainqueur » dans le back-office — et
       apparaissait DEUX fois (une fois par la session, une fois par cette
       ligne). Le cycle est desormais : live -> finished | cancelled. */
    const r = db.prepare(
      "INSERT INTO games (player1_id, player2_id, mode, format, wager, reason, game, status) VALUES (?, ?, ?, ?, ?, 'en_cours', ?, 'live')"
    ).run(p1Id, p2Id, mode, format, wager, game || "fanoron-tsivy");
    return r.lastInsertRowid;
  },
  finish(id, winnerId, delta1, delta2, moves, reason, elo = null) {
    /* L'instantané d'Elo (migration 006) est OPTIONNEL : un appel qui ne le
       fournit pas laisse les colonnes à NULL, et l'interface affichera « Données
       indisponibles » au lieu d'inventer une valeur. */
    db.prepare(
      `UPDATE games SET winner_id = ?, delta1 = ?, delta2 = ?, moves_json = ?, reason = ?,
              elo1_before = ?, elo1_after = ?, elo2_before = ?, elo2_after = ?, status = 'finished'
       WHERE id = ?`
    ).run(
      winnerId, delta1, delta2, JSON.stringify(moves || []), reason,
      elo ? elo.p1Before : null, elo ? elo.p1After : null,
      elo ? elo.p2Before : null, elo ? elo.p2After : null, id
    );
  },
  listForUser(userId, limit = 50) {
    return db.prepare(`
      SELECT g.*, u1.pseudo as p1_name, u2.pseudo as p2_name
      FROM games g JOIN users u1 ON g.player1_id = u1.id
      JOIN users u2 ON g.player2_id = u2.id
      WHERE g.player1_id = ? OR g.player2_id = ?
      ORDER BY g.created_at DESC, g.id DESC LIMIT ?
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
/* Solde offert à la création du compte. Écrit AU GRAND LIVRE (voir
   `Wallet.opening`) : une colonne posée à la main ferait qu'un compte neuf
   violerait l'invariant « solde = Σ écritures » dès sa première seconde. */
const OPENING_BALANCE = 5000;
/* Bonus de bienvenue du PRD : 1 000 Ar, NON RETIRABLES, une seule fois par
   compte. Il est crédité au grand livre (comme tout mouvement) ET porté par
   `bonus_lock` : il se dépense en mises / entrées de tournoi, mais
   `spendWithdrawable()` ne le touche jamais — il n'est pas retirable.
   Montant UNIQUE : `Wallet.grantWelcome()` est le seul endroit qui le crédite,
   donc le dépôt et l'inscription ne peuvent plus diverger (5 000 ici, 1 000
   là — c'était le défaut mesuré). */
const WELCOME_BONUS = 1000;

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
  /* Solde d'OUVERTURE : le seul crédit qui n'est pas un dépôt. Il passe par
     `credit`, donc par une écriture : c'est ce qui rend le grand livre
     réconciliable dès la création du compte.
     Libellé volontairement DISTINCT du « Crédit de bienvenue » verrouillé
     (accordé au premier dépôt) : deux gestes différents, deux lignes
     différentes — un joueur doit pouvoir lire ce qu'il a reçu et quand. */
  opening(userId) {
    this.credit(userId, OPENING_BALANCE, "Solde d'ouverture · " + OPENING_BALANCE + " Ar offerts");
  },
  /* BONUS DE BIENVENUE (PRD) — 1 000 Ar non retirables, UNE SEULE FOIS.
     Idempotent : `bonus_used` est la marque, donc l'inscription, le tournoi et
     le premier dépôt peuvent tous l'appeler ; le second appel ne crédite rien.
     Le compte NEUF d'un vrai joueur n'a plus de solde d'ouverture de 5 000 Ar
     (décision PRD) : il démarre à 0 avec ce seul bonus verrouillé.
     `Wallet.opening()` reste utilisée par les comptes de DÉMONSTRATION
     (`User.createOrUpdate`, seed) — leurs soldes ne bougent pas. */
  grantWelcome(userId) {
    const u = db.prepare("SELECT bonus_used FROM users WHERE id = ?").get(userId);
    if (!u || u.bonus_used) return false;
    db.prepare("UPDATE users SET bonus_used = 1 WHERE id = ?").run(userId);
    this.credit(userId, WELCOME_BONUS, "Bonus de bienvenue", true);
    return true;
  },
  /* Dépense : le montant sort du solde UNE SEULE fois, et la part verrouillée
     (bonus de bienvenue, non retirable) est consommée d'abord. L'ancienne
     version débitait `balance` ici ET dans addTransaction : chaque retrait,
     achat, entrée de tournoi ou mise de défi était facturé deux fois, ce qui
     faisait passer les soldes en négatif. */
  spend(userId, amount, label) {
    const bal = this.getBalance(userId);
    if (!bal) return;
    const fromBonus = Math.min(bal.bonus_lock, amount);
    db.prepare("UPDATE users SET bonus_lock = bonus_lock - ? WHERE id = ?").run(fromBonus, userId);
    this.addTransaction(userId, "out", label, amount);
  },
  /* Sortie d'argent RÉEL : ne consomme jamais le bonus verrouillé.
     `spend()` ci-dessus consomme le bonus en premier — ce qui est juste pour un
     achat ou une mise (l'argent non retirable se dépense), et FAUX pour un
     retrait : le joueur retirerait alors de l'argent qu'il n'a pas le droit de
     retirer, tout en conservant celui qu'il pourrait retirer. Deux intentions,
     donc deux primitives. Renvoie false si la part libre ne couvre pas le
     montant — l'appelant décide du message, pas cette fonction. */
  spendWithdrawable(userId, amount, label, refId = null) {
    const bal = this.getBalance(userId);
    if (!bal) return false;
    if (amount > bal.balance - bal.bonus_lock) return false;
    this.addTransaction(userId, "out", label, amount, null, refId);
    return true;
  },
  getTransactions(userId, limit = 50) {
    return db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
  },
  /* Historique FILTRÉ et PAGINÉ de l'écran Wallet. Les dates, le statut et le
     tri sont résolus en SQL ; les familles (kind), les moyens (method) et la
     recherche (q) reposent sur des motifs et sont donc appliqués après la
     lecture — les mêmes règles que celles renvoyées au client (DATA.txKind /
     DATA.txMethod), donc filtre et étiquette ne peuvent pas diverger.
     `size` accepte un nombre ou « all » (0 = tout afficher) ; sans valeur, le
     défaut historique de 50 est conservé. Chaque ligne repart étiquetée. */
  history(userId, opts = {}) {
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    let size = opts.size === "all" ? 0 : parseInt(opts.size, 10);
    if (!Number.isFinite(size)) size = 50;
    if (size < 0) size = 50;
    const sort = opts.sort === "asc" ? "ASC" : "DESC";
    const period = opts.period || "all";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(opts.from || "") ? opts.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(opts.to || "") ? opts.to : null;

    let sql = "SELECT * FROM transactions WHERE user_id = ?";
    const args = [userId];
    if (from) { sql += " AND date(created_at) >= ?"; args.push(from); }
    if (to) { sql += " AND date(created_at) <= ?"; args.push(to); }
    if (!from && !to && period === "recent") sql += " AND datetime(created_at) >= datetime('now', '-30 days')";
    if (!from && !to && period === "old") sql += " AND datetime(created_at) < datetime('now', '-30 days')";
    const status = opts.status || "all";
    if (status === "pending") sql += " AND status = 'pending'";
    else if (status === "success") sql += " AND (status IS NULL OR status = '' OR status = 'success')";
    sql += ` ORDER BY datetime(created_at) ${sort}, id ${sort}`;

    let rows = db.prepare(sql).all(...args);
    /* ---------- DEMANDES DE RETRAIT EN COURS, VISIBLES DANS L'HISTORIQUE ----
       Une demande (pending/approved) n'a AUCUNE écriture au grand livre :
       `Finance.pay()` ne débite qu'au paiement. Le joueur doit pourtant la voir
       — sans elle, son « disponible » baisse sans aucune ligne qui l'explique.
       On la FUSIONNE ici plutôt que d'insérer une transaction `out` : une telle
       ligne, sans débit, casserait l'invariant `balance = Σ(in) − Σ(out)` du
       montant exact de la demande. Une seule implémentation ⇒ l'écran Wallet,
       l'export CSV et les filtres (famille « Retrait », moyen « MVola »…,
       recherche) la traitent comme n'importe quelle ligne. */
    if (status !== "success") {
      const wArgs = [userId];
      let wSql = "SELECT id, amount, method, status, created_at FROM withdrawals " +
        "WHERE user_id = ? AND status IN ('pending', 'approved')";
      if (from) { wSql += " AND date(created_at) >= ?"; wArgs.push(from); }
      if (to) { wSql += " AND date(created_at) <= ?"; wArgs.push(to); }
      if (!from && !to && period === "recent") wSql += " AND datetime(created_at) >= datetime('now', '-30 days')";
      if (!from && !to && period === "old") wSql += " AND datetime(created_at) < datetime('now', '-30 days')";
      const demandes = db.prepare(wSql).all(...wArgs).map((w) => ({
        id: "w" + w.id, user_id: userId, dir: "out",
        label: `Retrait ${w.method} (en attente)`, amount: w.amount,
        status: "pending", ref_id: "withdrawal:" + w.id, created_at: w.created_at,
        _sortId: 1e9 + w.id,
      }));
      if (demandes.length) {
        rows = rows.concat(demandes).sort((a, b) => {
          const d = String(a.created_at || "").localeCompare(String(b.created_at || ""));
          const ia = a._sortId != null ? a._sortId : (Number(a.id) || 0);
          const ib = b._sortId != null ? b._sortId : (Number(b.id) || 0);
          if (d !== 0) return sort === "ASC" ? d : -d;
          return sort === "ASC" ? ia - ib : ib - ia;
        });
      }
    }
    const kind = opts.kind || "all";
    if (kind !== "all") rows = rows.filter((r) => DATA.txKind(r.label) === kind);
    const method = opts.method || "all";
    if (method !== "all") rows = rows.filter((r) => DATA.txMethod(r.label) === method);
    const q = fold(opts.q);
    if (q) rows = rows.filter((r) => fold(r.label).includes(q));

    const total = rows.length;
    const slice = size > 0 ? rows.slice((page - 1) * size, page * size) : rows;
    return {
      /* `_sortId` est un détail de tri interne (demandes de retrait) : il ne
         sort pas de l'API. */
      items: slice.map((r) => {
        const { _sortId, ...rest } = r;
        return { ...rest, kind: DATA.txKind(r.label), method: DATA.txMethod(r.label) };
      }),
      total, page, size: size > 0 ? size : total,
    };
  },
  /* Somme des retraits du JOUR : sert au plafond de 500 000 Ar et au profil.
     Depuis que le retrait est une DEMANDE, la source est la table `withdrawals`
     — compter les seules écritures comptables laisserait un joueur empiler des
     demandes en attente sans jamais atteindre le plafond, puisque rien n'est
     débité avant le paiement. Les mouvements ANTÉRIEURS (libellé « Retrait… »,
     sans référence `withdrawal:`) restent comptés : effacer l'historique d'un
     jour remettrait le plafond à zéro au premier déploiement. */
  withdrawnToday(userId) {
    const fromRequests = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals " +
      "WHERE user_id = ? AND status IN ('pending', 'approved', 'paid') AND date(created_at) = date('now')"
    ).get(userId);
    const fromLedger = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions " +
      "WHERE user_id = ? AND dir = 'out' AND label LIKE 'Retrait%' AND date(created_at) = date('now') " +
      "AND (ref_id IS NULL OR ref_id NOT LIKE 'withdrawal:%')"
    ).get(userId);
    return (fromRequests ? fromRequests.s : 0) + (fromLedger ? fromLedger.s : 0);
  },
};

/* ---------- Sanctions de compte ----------
   La sanction est un ÉVÉNEMENT, l'état courant se DÉDUIT du dernier événement.
   Une colonne `users.blocked` entretenue à la main dériverait au premier chemin
   d'écriture oublié ; un journal, non. */
const Sanction = {
  /* Dernier événement du joueur, ou null. Sert à la fois à l'état courant et à
     l'affichage « pourquoi / par qui / quand ». */
  latest(userId) {
    return db.prepare(
      "SELECT * FROM user_sanctions WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    ).get(userId) || null;
  },
  isBlocked(userId) {
    const last = this.latest(userId);
    return !!last && last.kind === "block" && !last.lifted_at;
  },
  history(userId, limit = 20) {
    return db.prepare(
      "SELECT * FROM user_sanctions WHERE user_id = ? ORDER BY id DESC LIMIT ?"
    ).all(userId, limit);
  },
  /* Pose un événement. `block` lève automatiquement une éventuelle suspension
     précédente encore ouverte : deux lignes `block` actives simultanément
     rendraient la lecture de l'état ambiguë. */
  add(userId, kind, reason, actorId = null) {
    if (kind === "block") {
      db.prepare(
        "UPDATE user_sanctions SET lifted_at = datetime('now') WHERE user_id = ? AND kind = 'block' AND lifted_at IS NULL"
      ).run(userId);
    }
    if (kind === "unblock") {
      db.prepare(
        "UPDATE user_sanctions SET lifted_at = datetime('now') WHERE user_id = ? AND kind = 'block' AND lifted_at IS NULL"
      ).run(userId);
    }
    const info = db.prepare(
      "INSERT INTO user_sanctions (user_id, kind, reason, actor_id) VALUES (?, ?, ?, ?)"
    ).run(userId, kind, reason || null, actorId);
    return this.latest(userId) && db.prepare("SELECT * FROM user_sanctions WHERE id = ?").get(info.lastInsertRowid);
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
  /* Demandes ARRIVÉES DEPUIS la dernière consultation de l'écran Amis.
     Le repère est `users.friends_seen_request_id` (migration 007) : un
     IDENTIFIANT, jamais une date — SQLite écrit `datetime('now')` là où le reste
     du code manipule de l'ISO-UTC, et comparer les deux formats est un bug
     silencieux qui attend son heure. */
  newIncoming(userId) {
    const u = db.prepare("SELECT friends_seen_request_id FROM users WHERE id = ?").get(userId);
    const seen = (u && u.friends_seen_request_id) || 0;
    return db.prepare(
      "SELECT COUNT(*) AS c FROM friend_requests WHERE to_id = ? AND status = 'pending' AND id > ?"
    ).get(userId, seen).c;
  },
  /* Identifiant de la dernière demande REÇUE (tous statuts) : c'est le filigrane
     que `markSeen` enregistre, et celui que l'API expose au client. Le client
     peut ainsi trancher une réponse retardée (partie avant la consultation) sans
     dépendre de l'ordre d'arrivée des requêtes. */
  incomingWatermark(userId) {
    const row = db.prepare("SELECT MAX(id) AS m FROM friend_requests WHERE to_id = ?").get(userId);
    return (row && row.m) || 0;
  },
  /* « J'ai vu l'écran Amis » : le filigrane avance jusqu'à la dernière demande
     REÇUE, tous statuts confondus (une demande traitée ne doit pas être recomptée ;
     une relance crée un nouvel id, donc elle sera comptée comme nouvelle).
     Le filigrane ne recule jamais : deux ouvertures d'écran ne doivent pas rendre
     « nouvelle » une demande plus ancienne. */
  markSeen(userId) {
    const upto = this.incomingWatermark(userId);
    const cur = db.prepare("SELECT friends_seen_request_id FROM users WHERE id = ?").get(userId);
    const seen = (cur && cur.friends_seen_request_id) || 0;
    if (upto > seen) db.prepare("UPDATE users SET friends_seen_request_id = ? WHERE id = ?").run(upto, userId);
    return { seen: Math.max(seen, upto) };
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

/* ---------- Skins ----------
   Deux catégories de pions, deux achats, deux emplacements : `pions_light`
   (pions clairs) et `pions_dark` (pions sombres). Le TYPE est porté par le skin
   (voir data.js) et le slot est toujours dérivé de ce type — jamais d'une
   valeur envoyée par le client. */
const EQUIPPED_SLOTS = Object.freeze(["pions_light", "pions_dark", "plateau", "effet"]);
/* Skins gratuits attribués à tout compte : l'ex-`pions-classique` (qui habillait
   les deux camps) est scindé en deux par la migration 008, un par catégorie. */
const FREE_SKINS = Object.freeze(["pions-clair-classique", "pions-sombre-classique"]);
const DEFAULT_EQUIPPED = Object.freeze({
  pions_light: "pions-clair-classique",
  pions_dark: "pions-sombre-classique",
  plateau: null,
  effet: null,
});

const Skins = {
  FREE_SKINS, DEFAULT_EQUIPPED,
  /* Attribution des skins gratuits + des deux emplacements par défaut.
     Appelée par les DEUX chemins d'inscription (`User.createOrUpdate` et
     `Auth.register`) : une seule définition, donc aucune divergence possible. */
  ensureDefaults(userId) {
    db.prepare(
      `INSERT OR IGNORE INTO equipped_skins (user_id, pions_light, pions_dark, plateau, effet)
       VALUES (?, ?, ?, NULL, NULL)`
    ).run(userId, DEFAULT_EQUIPPED.pions_light, DEFAULT_EQUIPPED.pions_dark);
    const ins = db.prepare("INSERT OR IGNORE INTO user_skins (user_id, skin_id) VALUES (?, ?)");
    for (const id of FREE_SKINS) ins.run(userId, id);
    /* La personnalisation du pion est créée au même moment et par le même chemin :
       un compte neuf a donc TOUJOURS une couleur et un motif POUR CHAQUE CAMP
       (les défauts), ce qui évite un « aucun style » à gérer dans l'interface et
       sur le plateau. */
    PionStyle.ensureDefaults(userId);
  },
  listOwned(userId) {
    return db.prepare("SELECT skin_id FROM user_skins WHERE user_id = ?").all(userId).map((r) => r.skin_id);
  },
  getEquipped(userId) {
    const row = db.prepare("SELECT pions_light, pions_dark, plateau, effet FROM equipped_skins WHERE user_id = ?").get(userId);
    return row
      ? { pions_light: row.pions_light, pions_dark: row.pions_dark, plateau: row.plateau, effet: row.effet }
      : { ...DEFAULT_EQUIPPED };
  },
  buy(userId, skinId, price) {
    const owned = this.listOwned(userId);
    if (owned.includes(skinId)) return { ok: false, error: "Deja possede" };
    db.prepare("INSERT INTO user_skins (user_id, skin_id) VALUES (?, ?)").run(userId, skinId);
    return { ok: true, price };
  },
  /* `slot` doit être une clé de la liste blanche ci-dessus : aucune valeur venue
     du client n'est jamais concaténée dans le SQL. Un skin clair ne peut donc
     écrire que dans `pions_light`, un skin sombre que dans `pions_dark`. */
  equip(userId, slot, skinId) {
    if (!EQUIPPED_SLOTS.includes(slot)) return { ok: false, error: "Emplacement de skin inconnu" };
    db.prepare(`UPDATE equipped_skins SET ${slot} = ? WHERE user_id = ?`).run(skinId, userId);
    return { ok: true, slot };
  },
};

/* ---------- Apparence des pions (forme × couleur × motif), UNE LIGNE PAR CAMP ----------
   Trois champs séparés, jamais d'identifiant combiné : la variété vient du
   produit des trois catalogues (data.js), pas de la base. Les identifiants sont
   validés par l'appelant (server.js) contre `PION_SHAPES` / `PION_COLORS` /
   `PION_PATTERNS` et contre le GROUPE du camp AVANT d'arriver ici : aucune
   valeur arbitraire ni aucune couleur hors groupe ne peut être écrite. */
const PionStyle = {
  CAMPS: DATA.PION_CAMPS,
  DEFAULTS: DATA.PION_DEFAULTS,
  /* Création des DEUX lignes (une par camp), appelée par les DEUX chemins
     d'inscription (voir Skins.ensureDefaults) : une seule définition, donc
     aucune divergence possible entre `User.createOrUpdate` et `Auth.register`. */
  ensureDefaults(userId) {
    const ins = db.prepare("INSERT OR IGNORE INTO pion_style (user_id, camp, color, pattern, shape) VALUES (?, ?, ?, ?, ?)");
    for (const c of DATA.PION_CAMPS) {
      const d = DATA.PION_DEFAULTS[c.id];
      ins.run(userId, c.id, d.color, d.pattern, d.shape);
    }
  },
  /* `{ light: { shape, color, pattern }, dark: { … } }` — la forme est TOUJOURS
     complète : un camp sans ligne (base d'avant la 010, ligne supprimée à la
     main) retombe sur son défaut au lieu de manquer, et une base d'avant la 014
     (colonne `shape` absente de la ligne) retombe sur la forme par défaut. */
  get(userId) {
    const out = {};
    for (const c of DATA.PION_CAMPS) out[c.id] = { ...DATA.PION_DEFAULTS[c.id] };
    const rows = db.prepare("SELECT camp, color, pattern, shape FROM pion_style WHERE user_id = ?").all(userId);
    for (const r of rows) if (out[r.camp]) {
      out[r.camp] = {
        shape: r.shape || DATA.PION_DEFAULTS[r.camp].shape,
        color: r.color, pattern: r.pattern,
      };
    }
    return out;
  },
  set(userId, camp, color, pattern, shape) {
    /* `shape` ABSENT (appelant d'avant la 014, ou client ancien qui change
       seulement la couleur) : la forme DÉJÀ ENREGISTRÉE est conservée — un
       changement de couleur ne remet pas la silhouette à zéro. Sans ligne
       existante, c'est la forme par défaut du camp (la colonne est NOT NULL). */
    const cur = db.prepare("SELECT shape FROM pion_style WHERE user_id = ? AND camp = ?").get(userId, camp);
    const sh = shape || (cur && cur.shape) || DATA.PION_DEFAULTS[camp].shape;
    db.prepare(`INSERT INTO pion_style (user_id, camp, color, pattern, shape) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, camp) DO UPDATE SET color = excluded.color, pattern = excluded.pattern, shape = excluded.shape`)
      .run(userId, camp, color, pattern, sh);
    return { ok: true, camp, style: { shape: sh, color, pattern } };
  },
};

/* ---------- Challenge (defis) ---------- */
const Challenge = {
  /* `game` : le defi porte le PLATEAU choisi par l envoyeur. Le destinataire
     accepte donc un Dimy ou un Telo, pas un Tsivy par defaut. */
  create(fromId, toId, wager, format, game) {
    const id = "DF-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const expires = Date.now() + 15 * 60 * 1000;
    db.prepare(
      "INSERT INTO challenges (id, from_id, to_id, wager, format, game, status, expires_at) VALUES (?,?,?,?,?,?,'pending',datetime(?,'unixepoch'))"
    ).run(id, fromId, toId, wager, format, game || "fanoron-tsivy", Math.floor(expires / 1000));
    return { id, expires_at: expires };
  },
  getByUser(userId) {
    return db.prepare(`
      SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo,
             u1.avatar as from_avatar, u2.avatar as to_avatar
      FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
      WHERE c.to_id = ? AND c.status = 'pending' ORDER BY c.created_at DESC
    `).all(userId);
  },
  get(id) {
    return db.prepare(`
      SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo,
             u1.avatar as from_avatar, u2.avatar as to_avatar
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
  /* `game` et `gameRecordId` (migration 026) : la variante jouée et le lien
     vers la ligne d'historique `games`. Sans eux, l'écran Parties affichait
     « variante inconnue » et ne pouvait pas distinguer une session de sa ligne
     d'historique. Nullables : une session d'avant la migration n'en a pas. */
  create(id, p1Id, p2Id, mode, format, wager, game = null, gameRecordId = null) {
    db.prepare(
      "INSERT INTO game_sessions (id, player1_id, player2_id, mode, format, wager, game, game_record_id, state_json, status) VALUES (?,?,?,?,?,?,?,?,?,'playing')"
    ).run(id, p1Id, p2Id, mode, format, wager, game || null, gameRecordId || null, "");
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
  now, applyInactivityDecay, INACTIVITY,
  User, GameRecord, Tournament, Wallet, Chat, Skins, PionStyle, Challenge, GameSessionStore, Friend, FriendRequest,
  Notification, TournamentMatch, Sanction,
};
