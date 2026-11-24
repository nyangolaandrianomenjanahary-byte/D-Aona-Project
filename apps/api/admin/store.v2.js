/* =========================================================
   D-aôna — Administration v2 : contenu et configuration
   ---------------------------------------------------------
   SQL des modules ajoutés par la refonte, hors rôles et hors finances :
     · disputes  — litiges et suites données ;
     · games     — catalogue éditorial des variantes ;
     · matches   — parties archivées + parties en cours ;
     · ranking   — classement et badges ;
     · settings  — réglages de la plateforme.

   Trois amorçages idempotents, appelés au démarrage (`Admin.init()`), suivent
   la règle posée par la migration 016 : une migration est immuable, elle ne
   doit pas figer un contenu éditorial. Ils n'écrasent JAMAIS une décision
   d'exploitation — ils ne remplissent que ce qui est vide.
   ========================================================= */
"use strict";

const { db } = require("../db");
const DATA = require("../data");
/* Formule Elo du moteur : `computeEloDelta(eloJoueur, eloAdverse, score)`.
   Elle est IDENTIQUE à celle de la maquette de référence
   (`Math.round(32 * (a - 1/(1+10^((e-t)/400))))`) — vérifié : u8 1210 contre
   u9 1105 donne +11/−11 des deux côtés. On réutilise celle du moteur plutôt
   que d'en écrire une seconde qui pourrait dériver. */
const { computeEloDelta } = require("../game");

/* ---------- Petits utilitaires locaux ---------- */
function clip(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function intIn(v, min, max, fallback = null) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
function bool(v, fallback = false) {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return fallback;
}
function fail(status, code, error) {
  return { ok: false, status, code, error };
}

/* =========================================================
   Réglages de la plateforme
   ---------------------------------------------------------
   `value` est du TEXTE en base ; le TYPE vit dans DEFAULTS. Une valeur
   illisible est refusée à l'écriture, jamais interprétée à la lecture : une
   base qui contient « truee » ne doit pas se comporter comme `false` en
   silence.
   ========================================================= */
const DEFAULTS = {
  platform_name: { type: "text", value: "D-aôna", max: 60, label: "Nom de la plateforme" },
  contact: { type: "text", value: "admin@daona.mg", max: 120, label: "Contact de support" },
  timezone: { type: "text", value: "Indian/Antananarivo", max: 60, label: "Fuseau horaire" },
  registrations_open: { type: "bool", value: "1", label: "Inscriptions ouvertes" },
  maintenance: { type: "bool", value: "0", label: "Mode maintenance" },
  /* Exiger le SCAN FACIAL pour valider une identité. Éteint par défaut : la
     capture (selfie / liveness) se fait dans l'application joueur, pas encore
     livrée — l'allumer aujourd'hui bloquerait toute validation. Le jour où la
     capture existe, ce réglage suffit à rendre la règle « toutes les pièces »
     effective, sans redéploiement. */
  kyc_face_required: { type: "bool", value: "0", label: "Exiger le scan facial (KYC)" },
};

function ensureSettings() {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );
  for (const [key, def] of Object.entries(DEFAULTS)) ins.run(key, def.value);
}

function settingsAll() {
  const rows = db.prepare("SELECT key, value, updated_at FROM platform_settings").all();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = {};
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const row = byKey.get(key);
    out[key] = {
      key, label: def.label, type: def.type,
      value: row ? (def.type === "bool" ? row.value === "1" : row.value) : (def.type === "bool" ? def.value === "1" : def.value),
      updatedAt: row ? row.updated_at : null,
    };
  }
  return out;
}

/* Écriture : chaque clé est typée AVANT d'être enregistrée. Une clé inconnue
   est ignorée — accepter n'importe quoi ferait de cette table un dépotoir. */
function settingsSave(patch) {
  if (!patch || typeof patch !== "object") return fail(400, "AUCUN_CHANGEMENT", "Aucun réglage fourni");
  const up = db.prepare(
    "UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?"
  );
  const ins = db.prepare(
    "INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );
  let touched = 0;
  for (const [key, def] of Object.entries(DEFAULTS)) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    let value;
    if (def.type === "bool") value = bool(raw, def.value === "1") ? "1" : "0";
    else {
      const s = clip(raw, def.max);
      if (s == null && def.value !== "") return fail(400, "CHAMP_INVALIDE", `« ${def.label} » ne peut pas être vide`);
      value = s == null ? "" : s;
    }
    const r = up.run(value, key);
    if (!r.changes) ins.run(key, value);
    touched++;
  }
  if (!touched) return fail(400, "AUCUN_CHANGEMENT", "Aucun réglage reconnu");
  return { ok: true, settings: settingsAll() };
}

/* Lu par les routes qui en dépendent (inscriptions). Jamais mis en cache au
   démarrage : un mode maintenance doit pouvoir être posé sans redémarrer. */
function setting(key) {
  const def = DEFAULTS[key];
  if (!def) return null;
  const row = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
  if (!row) return def.type === "bool" ? def.value === "1" : def.value;
  return def.type === "bool" ? row.value === "1" : row.value;
}

/* =========================================================
   Catalogue des jeux
   ---------------------------------------------------------
   Le moteur vit en code (`games/registry.js`), l'état éditorial vit ici. Un
   jeu présent en code mais absent du catalogue est amorcé en `active` (il est
   jouable) ; une entrée de `DATA.GAMES_CATALOG` sans moteur est amorcée en
   `draft` — elle ne peut pas être activée par erreur.
   ========================================================= */
function ensureCatalogue() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM admin_games").get();
  if (row && row.c > 0) return;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO admin_games (slug, name, variant, status, duration, ranked, min_elo, rules, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );
  let registry = { ids: () => [], has: () => false, get: () => null };
  try { registry = require("../games/registry"); } catch (e) { /* module absent : on amorce le reste */ }
  for (const id of registry.ids()) {
    const mod = registry.get(id) || {};
    const m = mod.manifest || {};
    ins.run(id, clip(m.name, 80) || id, clip(m.family, 60), "active",
      intIn(m.duration, 1, 600, 30), 1, 0, null);
  }
  for (const g of DATA.GAMES_CATALOG || []) {
    if (!g || !g.id || registry.has(g.id)) continue;
    ins.run(g.id, clip(g.name, 80) || g.id, clip(g.type, 60), "draft", 30, 0, 0, clip(g.desc, 4000));
  }
}

function gamesList() {
  const rows = db.prepare("SELECT * FROM admin_games ORDER BY status = 'active' DESC, name ASC").all();
  let registry = { has: () => false };
  try { registry = require("../games/registry"); } catch (e) {}
  return rows.map((r) => ({
    slug: r.slug, name: r.name, variant: r.variant, status: r.status,
    duration: r.duration, ranked: !!r.ranked, minElo: r.min_elo, rules: r.rules,
    version: r.version, updatedAt: r.updated_at, createdAt: r.created_at,
    /* « moteur introuvable » : le catalogue ne doit pas mentir sur la
       disponibilité réelle. */
    engine: registry.has(r.slug),
  }));
}

function gameSave(slug, data) {
  const key = clip(slug, 60);
  if (!key) return fail(400, "IDENTIFIANT_MANQUANT", "Identifiant de jeu manquant");
  let registry = { has: () => false };
  try { registry = require("../games/registry"); } catch (e) {}
  const exists = db.prepare("SELECT * FROM admin_games WHERE slug = ?").get(key);
  const name = clip(data.name, 80);
  if (!exists && !registry.has(key))
    return fail(404, "JEU_INCONNU", "Aucun moteur de ce nom : créez d'abord le dossier de jeu");
  if (exists && !name) return fail(400, "CHAMP_INVALIDE", "Le nom est obligatoire");

  if (exists) {
    db.prepare(
      `UPDATE admin_games SET name = ?, variant = ?, duration = ?, ranked = ?, min_elo = ?,
        rules = ?, version = version + 1, updated_at = datetime('now') WHERE slug = ?`
    ).run(name, clip(data.variant, 60), intIn(data.duration, 1, 600, exists.duration),
      bool(data.ranked, !!exists.ranked) ? 1 : 0, intIn(data.minElo, 0, 4000, exists.min_elo),
      clip(data.rules, 4000), key);
  } else {
    db.prepare(
      `INSERT INTO admin_games (slug, name, variant, status, duration, ranked, min_elo, rules, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, datetime('now'))`
    ).run(key, name, clip(data.variant, 60), intIn(data.duration, 1, 600, 30),
      bool(data.ranked, true) ? 1 : 0, intIn(data.minElo, 0, 4000, 0), clip(data.rules, 4000));
  }
  return { ok: true, game: gamesList().find((g) => g.slug === key) || null };
}

function gameStatus(slug, status) {
  const key = clip(slug, 60);
  const next = String(status || "").toLowerCase();
  if (!["draft", "active", "archived"].includes(next))
    return fail(400, "ETAT_INVALIDE", "État attendu : draft, active ou archived");
  const row = db.prepare("SELECT * FROM admin_games WHERE slug = ?").get(key);
  if (!row) return fail(404, "JEU_INCONNU", "Jeu introuvable");
  if (next === "active") {
    let registry = { has: () => false };
    try { registry = require("../games/registry"); } catch (e) {}
    if (!registry.has(key))
      return fail(409, "MOTEUR_ABSENT", "Aucun moteur pour ce jeu : impossible de l'activer");
  }
  db.prepare("UPDATE admin_games SET status = ?, version = version + 1, updated_at = datetime('now') WHERE slug = ?")
    .run(next, key);
  return { ok: true, game: gamesList().find((g) => g.slug === key) || null };
}

/* =========================================================
   Litiges
   ========================================================= */
const DISPUTE_STATES = ["open", "investigating", "resolved", "rejected"];
const DISPUTE_OUTCOMES = ["none", "corrected", "void"];

function disputesList({ status = "all", limit = 100 } = {}) {
  const n = intIn(limit, 1, 500, 100);
  const rows = DISPUTE_STATES.includes(status)
    ? db.prepare(
      `SELECT d.*, u.pseudo FROM disputes d LEFT JOIN users u ON u.id = d.user_id
       WHERE d.status = ? ORDER BY d.created_at ASC, d.id ASC LIMIT ?`).all(status, n)
    : db.prepare(
      `SELECT d.*, u.pseudo FROM disputes d LEFT JOIN users u ON u.id = d.user_id
       ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END,
       d.created_at DESC, d.id DESC LIMIT ?`).all(n);
  return rows.map((r) => ({
    id: r.id, matchId: r.match_id, userId: r.user_id, pseudo: r.pseudo || null,
    category: r.category, reason: r.reason, status: r.status, outcome: r.outcome,
    resolution: r.resolution, createdAt: r.created_at, resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
  }));
}

function disputeCreate(input, actor) {
  const matchId = intIn(input.matchId, 1, Number.MAX_SAFE_INTEGER);
  const category = clip(input.category, 60);
  const reason = clip(input.reason, 1000);
  if (!matchId) return fail(400, "CHAMP_MANQUANT", "Partie obligatoire");
  if (!category) return fail(400, "CHAMP_MANQUANT", "Catégorie obligatoire");
  if (!reason || reason.length < 5) return fail(400, "CHAMP_MANQUANT", "Motif obligatoire (5 caractères minimum)");
  const game = db.prepare("SELECT id FROM games WHERE id = ?").get(matchId);
  if (!game) return fail(404, "PARTIE_INCONNUE", "Partie introuvable");
  const info = db.prepare(
    "INSERT INTO disputes (match_id, user_id, category, reason) VALUES (?, ?, ?, ?)"
  ).run(matchId, actor.id || null, category, reason);
  db.prepare("UPDATE games SET status = 'disputed' WHERE id = ? AND status = 'finished'").run(matchId);
  return { ok: true, id: info.lastInsertRowid };
}

function disputeResolve(id, input) {
  const row = db.prepare("SELECT * FROM disputes WHERE id = ?").get(intIn(id, 1, Number.MAX_SAFE_INTEGER));
  if (!row) return fail(404, "LITIGE_INCONNU", "Litige introuvable");
  if (row.status === "resolved" || row.status === "rejected")
    return fail(409, "ETAT_INVALIDE", "Ce litige est déjà clos");
  const status = String(input.status || "").toLowerCase();
  const outcome = String(input.outcome || "none").toLowerCase();
  if (!["open", "investigating", "resolved", "rejected"].includes(status))
    return fail(400, "ETAT_INVALIDE", "État de litige inconnu");
  if (!DISPUTE_OUTCOMES.includes(outcome))
    return fail(400, "ETAT_INVALIDE", "Suite attendue : none, corrected ou void");
  const resolution = clip(input.resolution, 1000);
  if ((status === "resolved" || status === "rejected") && (!resolution || resolution.length < 5))
    return fail(400, "MOTIF_MANQUANT", "Une clôture doit être motivée");
  db.prepare(
    `UPDATE disputes SET status = ?, outcome = ?, resolution = ?,
      resolved_by = CASE WHEN ? IN ('resolved','rejected') THEN ? ELSE resolved_by END,
      resolved_at = CASE WHEN ? IN ('resolved','rejected') THEN datetime('now') ELSE resolved_at END
     WHERE id = ?`
  ).run(status, outcome, resolution, status, null, status, id);
  /* `void` annule la partie : c'est le seul effet automatique. Corriger un
     résultat (outcome = corrected) reste une action distincte sur la partie,
     parce que cela touche l'Elo de deux joueurs. */
  if (outcome === "void")
    db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(row.match_id);
  return { ok: true, dispute: disputesList({ limit: 500 }).find((d) => d.id === row.id) || null };
}

/* =========================================================
   Parties
   ========================================================= */
const MATCH_STATES = ["live", "finished", "disputed", "cancelled"];

function matchesList({ status = "all", limit = 100 } = {}) {
  const n = intIn(limit, 1, 500, 100);
  /* `status` inconnu = « toutes ». Sans cette normalisation, un `?status=live`
     tombait dans la branche générique et renvoyait TOUTES les parties (mesuré :
     « 60 lignes dont 49 vainqueurs » dans l'onglet « En cours »). */
  const sel = MATCH_STATES.includes(status) ? status : "all";

  /* « En cours » = les SESSIONS en jeu, et elles seules. C'est la seule source
     qui sait qu'une partie est vivante : la ligne d'historique naît en même
     temps et resterait « en cours » même après la fin. */
  const liveRows = (sel === "all" || sel === "live")
    ? db.prepare(
      `SELECT s.*, u1.pseudo AS p1, u2.pseudo AS p2
        FROM game_sessions s LEFT JOIN users u1 ON u1.id = s.player1_id
        LEFT JOIN users u2 ON u2.id = s.player2_id
       WHERE s.status = 'playing' ORDER BY s.updated_at DESC LIMIT ?`).all(n)
    : [];

  /* Historique = les lignes `games` SAUF celles encore en cours : les inclure
     ferait apparaître la même partie deux fois, dont une « terminée » sans
     vainqueur. */
  const archived = sel === "live" ? [] : db.prepare(
    `SELECT g.*, u1.pseudo AS p1, u2.pseudo AS p2, w.pseudo AS winner
       FROM games g LEFT JOIN users u1 ON u1.id = g.player1_id
       LEFT JOIN users u2 ON u2.id = g.player2_id LEFT JOIN users w ON w.id = g.winner_id
      WHERE COALESCE(g.status, 'finished') <> 'live'
        ${sel === "all" ? "" : "AND g.status = ?"}
      ORDER BY g.created_at DESC LIMIT ?`
  ).all(...(sel === "all" ? [n] : [sel, n]));

  const shaped = [
    ...liveRows.map((r) => ({
      id: `s${r.id}`, sessionId: r.id, game: r.game || null, status: "live",
      p1: r.p1, p2: r.p2, playerIds: [r.player1_id, r.player2_id],
      winnerId: null, winner: null, mode: r.mode, format: r.format, wager: r.wager,
      reason: null, createdAt: r.created_at, updatedAt: r.updated_at, eloDelta: null,
    })),
    ...archived.map((r) => ({
      id: r.id, sessionId: null, game: r.game || null, status: r.status || "finished",
      p1: r.p1, p2: r.p2, playerIds: [r.player1_id, r.player2_id],
      winnerId: r.winner_id || null, winner: r.winner || null,
      mode: r.mode, format: r.format, wager: r.wager, reason: r.reason,
      createdAt: r.created_at, updatedAt: r.created_at,
      eloDelta: r.delta1 == null ? null : { p1: r.delta1, p2: r.delta2 },
    })),
  ];
  return shaped.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, n);
}

/* Confirmer ou annuler une partie contestée. L'Elo n'est PAS recalculé ici :
   une correction rétroactive des classements demande de reprendre la chaîne
   des parties, ce qui n'est pas une décision d'écran. L'effet est donc borné à
   l'état de la partie, et l'écran le dit. */
function matchResult(id, input) {
  const gameId = intIn(id, 1, Number.MAX_SAFE_INTEGER);
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
  if (!row) return fail(404, "PARTIE_INCONNUE", "Partie introuvable");
  const decision = String(input.decision || "").toLowerCase();
  if (decision !== "confirm" && decision !== "void")
    return fail(400, "DECISION_INCONNUE", "Décision attendue : confirm ou void");
  const reason = clip(input.reason, 500);
  if (!reason || reason.length < 5) return fail(400, "MOTIF_MANQUANT", "Un motif est obligatoire");

  /* Un litige OUVERT bloque la validation du résultat. Sans cette règle, un
     opérateur pourrait trancher un résultat pendant qu'un signalement est
     encore à l'instruction — et l'Elo suivrait une décision contestée. */
  const openDispute = db.prepare(
    "SELECT id FROM disputes WHERE match_id = ? AND status IN ('open', 'investigating')"
  ).get(gameId);
  if (openDispute)
    return fail(409, "LITIGE_OUVERT",
      `Un litige (#${openDispute.id}) est ouvert sur cette partie : tranchez-le d'abord`);

  /* Une partie de TOURNOI ne s'annule pas isolément : le tableau, les
     remboursements et la dotation en dépendent. Annuler une seule rencontre
     laisserait un trou dans le bracket et une dotation calculée sur un
     tournoi incomplet. */
  if (decision === "void" && row.mode === "tournament")
    return fail(409, "PARTIE_DE_TOURNOI",
      "Une partie de tournoi ne s'annule pas isolément : annulez l'édition");

  const next = decision === "confirm" ? "finished" : "cancelled";
  /* Idempotence AVANT le contrôle d'état : un second appel doit répondre
     « classement déjà mis à jour », et non « déjà dans cet état » — ce dernier
     message laisserait croire qu'un autre chemin subsiste. */
  if (decision === "confirm" && row.mode !== "friendly" && row.elo1_after != null)
    return fail(409, "ELO_DEJA_APPLIQUE", "Le classement de cette partie a déjà été mis à jour");
  if (row.status === next && !input.force) return fail(409, "ETAT_INVALIDE", "La partie est déjà dans cet état");

  /* ---------- Annulation : aucun Elo en jeu ---------- */
  if (decision === "void") {
    db.prepare("UPDATE games SET status = 'cancelled', reason = ? WHERE id = ?").run(reason, gameId);
    return { ok: true, match: { id: gameId, status: "cancelled", winnerId: row.winner_id || null,
      eloRecalculated: false } };
  }

  /* ---------- Confirmation : le classement bouge, UNE SEULE FOIS ---------- */
  const winnerId = intIn(input.winnerId, 1, Number.MAX_SAFE_INTEGER) || row.winner_id || null;
  if (!winnerId)
    return fail(400, "VAINQUEUR_MANQUANT", "Indiquez le vainqueur : la partie n'en porte aucun");
  if (winnerId !== row.player1_id && winnerId !== row.player2_id)
    return fail(400, "VAINQUEUR_INVALIDE", "Le vainqueur doit être l'un des deux joueurs");
  /* Idempotence : un second appel ne doit pas doubler l'Elo. Le contrôle
     principal est fait plus haut, avant celui de l'état. */
  if (row.elo1_after != null)
    return fail(409, "ELO_DEJA_APPLIQUE", "Le classement de cette partie a déjà été mis à jour");

  const p1 = db.prepare("SELECT id, elo FROM users WHERE id = ?").get(row.player1_id);
  const p2 = db.prepare("SELECT id, elo FROM users WHERE id = ?").get(row.player2_id);
  if (!p1 || !p2) return fail(409, "JOUEUR_INCONNU", "Un des joueurs n'existe plus");

  /* Une partie AMICALE ne touche pas au classement : on confirme le résultat
     sans inventer d'Elo. C'est la règle de la référence, et c'est aussi ce qui
     rend les parties d'historique inoffensives. */
  if (row.mode === "friendly") {
    db.prepare("UPDATE games SET status = 'finished', winner_id = ?, reason = ? WHERE id = ?")
      .run(winnerId, reason, gameId);
    return { ok: true, match: { id: gameId, status: "finished", winnerId,
      eloRecalculated: false, friendly: true } };
  }

  /* ZERO-SUM : la somme des deux écarts vaut zéro par construction de la
     formule (même `expected`, résultats complémentaires). */
  const delta1 = computeEloDelta(p1.elo, p2.elo, winnerId === p1.id ? 1 : 0);
  const delta2 = computeEloDelta(p2.elo, p1.elo, winnerId === p2.id ? 1 : 0);
  const loserId = winnerId === p1.id ? p2.id : p1.id;

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE games SET status = 'finished', winner_id = ?, reason = ?, delta1 = ?, delta2 = ?,
         elo1_before = ?, elo1_after = ?, elo2_before = ?, elo2_after = ? WHERE id = ?`
    ).run(winnerId, reason, delta1, delta2, p1.elo, p1.elo + delta1, p2.elo, p2.elo + delta2, gameId);
    db.prepare("UPDATE users SET elo = ?, wins = wins + 1 WHERE id = ?").run(p1.id === winnerId ? p1.elo + delta1 : p2.elo + delta2, winnerId);
    db.prepare("UPDATE users SET elo = ?, losses = losses + 1 WHERE id = ?")
      .run(loserId === p1.id ? p1.elo + delta1 : p2.elo + delta2, loserId);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    return fail(409, "ECRITURE_IMPOSSIBLE", "Résultat non enregistré : rien n'a changé");
  }

  return {
    ok: true,
    match: {
      id: gameId, status: "finished", winnerId, eloRecalculated: true,
      elo: { [p1.id]: delta1, [p2.id]: delta2 },
    },
  };
}

/* =========================================================
   Classement et badges
   ========================================================= */
function ensureBadges() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM badges").get();
  if (row && row.c > 0) return;
  const ins = db.prepare(
    "INSERT OR IGNORE INTO badges (name, icon, color, ink, min_rank, max_rank) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const b of DATA.BADGES || []) {
    const max = Number.isFinite(b.max) ? b.max : null;
    ins.run(clip(b.name, 40), clip(b.icon, 8), clip(b.color, 16), clip(b.ink, 16), b.min, max);
  }
}

function badgesList() {
  return db.prepare("SELECT * FROM badges ORDER BY min_rank ASC").all().map((b) => ({
    name: b.name, icon: b.icon, color: b.color, ink: b.ink,
    minRank: b.min_rank, maxRank: b.max_rank == null ? null : b.max_rank,
  }));
}

function badgeForRank(rank) {
  const list = badgesList();
  const hit = list.find((b) => rank >= b.minRank && (b.maxRank == null || rank <= b.maxRank));
  return hit || list[list.length - 1] || null;
}

/* Barème lu UNE fois : `badgeForRank()` par ligne ferait N requêtes pour un
   tableau de cinquante lignes. */
function badgePicker() {
  const badges = badgesList();
  return (rank) => badges.find((b) => rank >= b.minRank && (b.maxRank == null || rank <= b.maxRank))
    || badges[badges.length - 1] || null;
}

function rankingList(limit = 50) {
  const rows = db.prepare("SELECT id, pseudo, elo, wins, losses, province FROM users ORDER BY elo DESC, pseudo ASC").all();
  const pick = badgePicker();
  return rows.slice(0, intIn(limit, 1, 500, 50)).map((r, i) => {
    const badge = pick(i + 1);
    return {
      rank: i + 1, id: r.id, pseudo: r.pseudo, elo: r.elo, wins: r.wins, losses: r.losses,
      province: r.province || null, badge: badge ? badge.name : null,
      badgeIcon: badge ? badge.icon : null, badgeColor: badge ? badge.color : null,
    };
  });
}

function rankingOverview() {
  const players = db.prepare("SELECT elo FROM users").all().map((r) => r.elo);
  const pick = badgePicker();
  const counts = new Map();
  for (let i = 1; i <= players.length; i++) {
    const b = pick(i);
    if (!b) continue;
    counts.set(b.name, (counts.get(b.name) || 0) + 1);
  }
  const sorted = players.slice().sort((a, b) => a - b);
  const avg = players.length ? Math.round(players.reduce((s, v) => s + v, 0) / players.length) : 0;
  return {
    players: players.length,
    average: avg,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    min: sorted.length ? sorted[0] : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    top: rankingList(10),
    badges: badgesList().map((b) => ({ ...b, members: counts.get(b.name) || 0 })),
  };
}

/* Remplacement ENTIER du barème, dans une transaction : un barème à moitié
   écrit laisserait des joueurs sans badge pendant un instant. */
function badgesSave(input) {
  const list = Array.isArray(input.badges) ? input.badges : null;
  if (!list || !list.length) return fail(400, "AUCUN_CHANGEMENT", "Aucun badge fourni");
  if (list.length > 20) return fail(400, "TROP_DE_BADGES", "20 badges au maximum");
  const clean = [];
  for (const b of list) {
    const name = clip(b && b.name, 40);
    const minRank = intIn(b && b.minRank, 1, 1000000);
    const maxRaw = b && b.maxRank;
    const maxRank = maxRaw === null || maxRaw === "" || maxRaw === undefined ? null : intIn(maxRaw, 1, 1000000);
    if (!name) return fail(400, "CHAMP_INVALIDE", "Chaque badge doit avoir un nom");
    if (!minRank) return fail(400, "CHAMP_INVALIDE", `Rang minimum invalide pour « ${name} »`);
    if (maxRank != null && maxRank < minRank)
      return fail(400, "INTERVALLE_INVALIDE", `« ${name} » : le rang maximum précède le minimum`);
    clean.push({ name, minRank, maxRank,
      icon: clip(b.icon, 8), color: clip(b.color, 16), ink: clip(b.ink, 16) });
  }
  /* Continuité du barème : les paliers doivent couvrir 1 -> ∞ sans trou ni
     chevauchement. Valider chaque intervalle isolément ne suffit pas — c'est
     l'ensemble qui doit former une partition, sinon un rang n'a pas de badge
     ou en a deux. */
  clean.sort((a, b) => a.minRank - b.minRank);
  if (clean[0].minRank !== 1)
    return fail(400, "INTERVALLE_INVALIDE", "Le premier badge doit commencer au rang 1");
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    if (prev.maxRank == null)
      return fail(400, "INTERVALLE_INVALIDE",
        `« ${prev.name} » n'a pas de borne haute : aucun badge ne peut le suivre`);
    if (clean[i].minRank !== prev.maxRank + 1)
      return fail(400, "INTERVALLE_INVALIDE",
        `Trou ou chevauchement entre « ${prev.name} » (jusqu'au rang ${prev.maxRank}) ` +
        `et « ${clean[i].name} » (à partir du rang ${clean[i].minRank})`);
  }
  const lastBadge = clean[clean.length - 1];
  if (lastBadge.maxRank != null)
    return fail(400, "INTERVALLE_INVALIDE",
      `Le dernier badge (« ${lastBadge.name} ») doit rester ouvert : laissez la borne haute vide`);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM badges").run();
    const ins = db.prepare(
      "INSERT INTO badges (name, icon, color, ink, min_rank, max_rank) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const b of clean) ins.run(b.name, b.icon, b.color, b.ink, b.minRank, b.maxRank);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    return fail(409, "ECRITURE_IMPOSSIBLE", "Enregistrement des badges impossible");
  }
  return { ok: true, badges: badgesList() };
}

module.exports = {
  DEFAULTS, ensureSettings, settingsAll, settingsSave, setting,
  ensureCatalogue, gamesList, gameSave, gameStatus,
  disputesList, disputeCreate, disputeResolve,
  matchesList, matchResult,
  ensureBadges, badgesList, badgeForRank, rankingList, rankingOverview, badgesSave,
};
