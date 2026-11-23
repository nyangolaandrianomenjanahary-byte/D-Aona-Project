/* =========================================================
   D-aôna — Administration v2 : routes « contenu et configuration »
   ---------------------------------------------------------
   Litiges, catalogue de jeux, parties, classement/badges, réglages, et la vue
   d'ensemble. Même contrat que `routes.finance.js` :

     module.exports = async (o) => boolean   (true = réponse écrite)

   Aucune requête SQL ici : tout passe par `store.v2.js`. La séparation n'est
   pas cérémonielle — c'est ce qui rend la relecture de sécurité possible (une
   seule liste de requêtes préparées, toujours au même endroit).
   ========================================================= */
"use strict";

const { db } = require("../db");
const V2 = require("./store.v2");
const Finance = require("./store.finance");

function intParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------- Vue d'ensemble ----------
   Un seul aller-retour pour l'accueil du back-office : six compteurs et
   l'activité des sept derniers jours. Tous les chiffres sont lus à l'instant,
   l'écran ne calcule rien. */
function overview() {
  const one = (sql, ...a) => (db.prepare(sql).get(...a) || { c: 0 }).c;
  const kyc = { pending: one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'pending'"),
    verified: one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'verified'"),
    rejected: one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'rejected'") };
  const disputes = { open: one("SELECT COUNT(*) AS c FROM disputes WHERE status IN ('open','investigating')"),
    resolved: one("SELECT COUNT(*) AS c FROM disputes WHERE status = 'resolved'") };
  const withdrawals = { pending: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'"),
    approved: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'approved'") };

  /* Activité des sept derniers jours — MÊME fuseau que le décompte du jour
     (UTC+3) : un histogramme en UTC ferait basculer les parties du soir sur la
     colonne du lendemain. Les annulations sont exclues, comme l'annonce le pied
     de panneau. */
  const activity = db.prepare(
    `SELECT date(created_at, '+3 hours') AS day, COUNT(*) AS games FROM games
     WHERE date(created_at, '+3 hours') >= date('now', '+3 hours', '-6 days')
       AND COALESCE(status, '') <> 'cancelled'
     GROUP BY day ORDER BY day ASC`
  ).all();
  /* Sept jours COMPLETS, trous compris : un histogramme qui saute les jours
     vides fait croire à une activité continue. */
  const byDay = new Map(activity.map((r) => [r.day, r.games]));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + 3 * 3600 * 1000 - i * 86400000).toISOString().slice(0, 10);
    days.push({ day: d, games: byDay.get(d) || 0 });
  }

  const players = db.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN date(last_seen) >= date('now') THEN 1 ELSE 0 END), 0) AS today,
       COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-7 days') THEN 1 ELSE 0 END), 0) AS news
     FROM users`
  ).get();

  /* « Parties aujourd'hui » compte la date RÉELLE du serveur, pas le jour de
     référence du seed : quand la démonstration est consultée un autre jour, la
     maquette affiche 0, et une application qui afficherait 11 mentirait sur la
     journée en cours. `liveGames` est le nombre de parties en cours — c'est la
     légende de cette métrique dans la maquette.

     FUSEAU : les dates sont écrites en UTC par SQLite, mais la journée qui
     compte est celle de MADAGASCAR (UTC+3). Sans ce décalage, une partie jouée
     à 23 h 50 retombait sur le lendemain — et une partie de 00 h 10 la veille
     disparaissait du décompte du jour. */
  const AUJOURDHUI = "date(created_at, '+3 hours') = date('now', '+3 hours')";
  const todayBy = (mode) => one(`SELECT COUNT(*) AS c FROM games WHERE ${AUJOURDHUI} AND mode = ?`, mode);
  const todayDefi = todayBy("defi");
  const todayOnline = todayBy("online");
  /* Entraînements (`ai`), amicaux et parties de tournoi sont COMPTÉS À PART :
     ils figurent dans la note de bas de panneau, jamais dans le total. Le total
     affiché est donc exactement « défi + matchmaking ». */
  const todayAutres = one(
    `SELECT COUNT(*) AS c FROM games WHERE ${AUJOURDHUI} AND mode NOT IN ('defi','online')`);
  const gamesToday = todayDefi + todayOnline;
  const liveGames = one("SELECT COUNT(*) AS c FROM games WHERE status = 'live'");

  /* ---------- Mises en jeu, tous jeux confondus ----------
     `wager` est la mise PAR CAMP (défi : chaque joueur paie `wager`, le gagnant
     touche `wager × 2 × 0,9` — voir server.js). Le pot réellement engagé est
     donc `2 × wager`. On publie les deux : le total engagé, et ce que chaque
     camp a misé, pour que l'écran puisse le dire sans le calculer.

     Seules les sessions `playing` comptent : ni les parties terminées, ni les
     annulées. La ventilation par jeu somme EXACTEMENT le total (même filtre),
     et regroupe les sessions d'avant la migration 026 sous « inconnu » plutôt
     que de les faire disparaître. */
  const live = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(wager), 0) AS perSide, COALESCE(SUM(wager * 2), 0) AS pot
     FROM game_sessions WHERE status = 'playing'`
  ).get();
  const liveByGame = db.prepare(
    `SELECT COALESCE(NULLIF(game, ''), NULL) AS game, COUNT(*) AS sessions,
            COALESCE(SUM(wager * 2), 0) AS pot
     FROM game_sessions WHERE status = 'playing' GROUP BY game ORDER BY pot DESC, game ASC`
  ).all();
  const openRegistrations = one(
    `SELECT COUNT(*) AS c FROM tournament_registrations r
     JOIN tournaments t ON t.id = r.tournament_id WHERE t.status = 'inscriptions'`
  );

  return {
    players,
    gamesToday,
    liveGames,
    /* Mises en cours : total engagé, mise par camp, nombre de parties, et la
       ventilation par jeu dont la somme égale `total`. */
    liveWagers: {
      total: live.pot || 0,
      perSide: live.perSide || 0,
      sessions: live.n || 0,
      byGame: liveByGame.map((r) => ({ game: r.game || null, sessions: r.sessions, pot: r.pot })),
    },
    /* Décompte du jour, au fuseau de Madagascar : le total affiché est
       exactement `défi + matchmaking` ; `autres` (entraînements, amicaux,
       tournois) est publié séparément pour la note de bas de panneau. */
    gamesTodaySplit: { defi: todayDefi, online: todayOnline, autres: todayAutres },
    openRegistrations,
    kyc,
    disputes,
    withdrawals,
    withdrawalsMoney: Finance.overview(),
    activity: days,
    games: { active: one("SELECT COUNT(*) AS c FROM admin_games WHERE status = 'active'"),
      draft: one("SELECT COUNT(*) AS c FROM admin_games WHERE status = 'draft'") },
    tournaments: { open: one("SELECT COUNT(*) AS c FROM tournaments WHERE status = 'inscriptions'"),
      live: one("SELECT COUNT(*) AS c FROM tournaments WHERE status = 'en_cours'") },
    /* Les décisions qui attendent quelqu'un : la file de travail, pas des
       statistiques. */
    queue: [
      { id: "kyc", label: "Identités à vérifier", count: kyc.pending, perm: "kyc.review" },
      { id: "withdrawals", label: "Retraits à instruire", count: withdrawals.pending, perm: "withdrawals.review" },
      { id: "disputes", label: "Litiges ouverts", count: disputes.open, perm: "disputes.review" },
    ],
    settings: { platformName: V2.setting("platform_name"), maintenance: V2.setting("maintenance") },
  };
}

module.exports = async function v2Routes(o) {
  const { method, parts, url } = o;
  const head = parts[0] || "";

  /* ---------- GET /api/admin/overview ---------- */
  if (head === "overview") {
    if (method !== "GET" || parts.length !== 1) return false;
    if (!o.guard("overview.read")) return true;
    return o.respond(o.res, overview()), true;
  }

  /* ---------- Ouverture d'un dossier d'identité ----------
     La maquette exige `kyc.read` pour `kyc.open` : consulter une pièce est une
     LECTURE, pas une décision. Mais elle est JOURNALISÉE — regarder la carte
     d'identité de quelqu'un est un acte traçable, même quand il est autorisé.
     C'est l'exigence « l'ouverture des pièces est journalisée » du cahier des
     charges, et c'est le seul endroit où elle peut vivre. */
  if (head === "kyc") {
    if (method !== "POST" || parts.length !== 3 || parts[2] !== "open") return false;
    if (!o.guard("kyc.read")) return true;
    const caseId = intParam(parts[1]);
    if (!caseId) return o.refuse(o.res, { status: 400, code: "DOSSIER_INVALIDE", error: "Dossier invalide" }), true;
    const row = db.prepare("SELECT id, user_id, status FROM kyc_cases WHERE id = ?").get(caseId);
    if (!row) return o.refuse(o.res, { status: 404, code: "DOSSIER_INCONNU", error: "Dossier introuvable" }), true;
    o.audit({ action: "kyc.open", target: `kyc:${caseId}`, detail: { userId: row.user_id, status: row.status } });
    return o.respond(o.res, { ok: true, caseId, status: row.status }), true;
  }

  /* ---------- Litiges ---------- */
  if (head === "disputes") {
    if (method === "GET" && parts.length === 1) {
      if (!o.guard("disputes.read")) return true;
      return o.respond(o.res, { disputes: V2.disputesList({ status: url.searchParams.get("status") || "all",
        limit: url.searchParams.get("limit") }) }), true;
    }
    if (method === "POST" && parts.length === 1) {
      /* Ouvrir un litige est un `create` — et non un `review` : la maquette
         distingue celui qui signale de celui qui tranche. */
      if (!o.guard("disputes.create")) return true;
      const b = await o.body();
      if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
      const r = V2.disputeCreate(b, o.actor);
      if (!r.ok) return o.refuse(o.res, r), true;
      o.audit({ action: "disputes.open", target: `dispute:${r.id}`, detail: { matchId: b.matchId, category: b.category } });
      o.broadcast("disputes");
      return o.respond(o.res, r), true;
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "resolve") {
      if (!o.guard("disputes.review")) return true;
      const b = await o.body();
      if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
      const r = V2.disputeResolve(intParam(parts[1]), b);
      if (!r.ok) return o.refuse(o.res, r), true;
      o.audit({ action: "disputes.resolve", target: `dispute:${parts[1]}`,
        detail: { status: b.status, outcome: b.outcome, resolution: b.resolution } });
      o.broadcast("disputes");
      return o.respond(o.res, r), true;
    }
    return false;
  }

  /* ---------- Catalogue des jeux ---------- */
  if (head === "games") {
    if (method === "GET" && parts.length === 1) {
      if (!o.guard("games.read")) return true;
      return o.respond(o.res, { games: V2.gamesList() }), true;
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "status") {
      if (!o.guard("games.edit")) return true;
      const b = await o.body();
      if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
      const r = V2.gameStatus(parts[1], b.status);
      if (!r.ok) return o.refuse(o.res, r), true;
      o.audit({ action: "games.status", target: `game:${parts[1]}`, detail: { status: b.status } });
      o.broadcast("games");
      return o.respond(o.res, r), true;
    }
    if (method === "POST" && parts.length === 2) {
      /* Créer une entrée de catalogue est un `create`, la modifier un `edit` :
         même route, deux droits — on lit donc l'existence d'abord. */
      const exists = V2.gamesList().some((g) => g.slug === parts[1]);
      if (!o.guard(exists ? "games.edit" : "games.create")) return true;
      const b = await o.body();
      if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
      const r = V2.gameSave(parts[1], b);
      if (!r.ok) return o.refuse(o.res, r), true;
      o.audit({ action: exists ? "games.edit" : "games.create", target: `game:${parts[1]}`,
        detail: { name: b.name, status: r.game && r.game.status } });
      o.broadcast("games");
      return o.respond(o.res, r), true;
    }
    return false;
  }

  /* ---------- Parties ---------- */
  if (head === "matches") {
    if (method === "GET" && parts.length === 1) {
      if (!o.guard("matches.read")) return true;
      return o.respond(o.res, { matches: V2.matchesList({ status: url.searchParams.get("status") || "all",
        limit: url.searchParams.get("limit") }) }), true;
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "result") {
      if (!o.guard("matches.review")) return true;
      const b = await o.body();
      if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
      const r = V2.matchResult(intParam(parts[1]), b);
      if (!r.ok) return o.refuse(o.res, r), true;
      o.audit({ action: "matches.result", target: `match:${parts[1]}`,
        detail: { decision: b.decision, reason: b.reason } });
      o.broadcast("matches");
      return o.respond(o.res, r), true;
    }
    return false;
  }

  /* ---------- Classement & badges ---------- */
  if (head === "ranking") {
    if (method !== "GET" || parts.length !== 1) return false;
    if (!o.guard("ranking.read")) return true;
    return o.respond(o.res, V2.rankingOverview()), true;
  }
  if (head === "badges" && method === "POST" && parts.length === 1) {
    if (!o.guard("ranking.edit")) return true;
    const b = await o.body();
    if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
    const r = V2.badgesSave(b);
    if (!r.ok) return o.refuse(o.res, r), true;
    o.audit({ action: "ranking.badges", detail: { count: r.badges.length } });
    o.broadcast("ranking");
    return o.respond(o.res, r), true;
  }

  /* ---------- Réglages ---------- */
  if (head === "settings") {
    if (method === "GET" && parts.length === 1) {
      if (!o.guard("settings.read")) return true;
      return o.respond(o.res, { settings: V2.settingsAll() }), true;
    }
    if (method === "POST" && parts.length === 1) {
      if (!o.guard("settings.edit")) return true;
      const b = await o.body();
      if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
      const r = V2.settingsSave(b);
      if (!r.ok) return o.refuse(o.res, r), true;
      o.audit({ action: "settings.edit", detail: { keys: Object.keys(b).slice(0, 20) } });
      o.broadcast("settings");
      return o.respond(o.res, r), true;
    }
    return false;
  }

  return false;
};

module.exports.overview = overview;
