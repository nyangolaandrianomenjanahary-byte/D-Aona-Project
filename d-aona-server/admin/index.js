/* =========================================================
   D-aôna — Administration : routeur HTTP du back-office
   ---------------------------------------------------------
   Toutes les routes vivent sous /api/admin/. Trois barrières, dans cet ordre :

     1. SESSION — un jeton valide, sinon 401.
     2. MODULE  — le module doit être allumé globalement, sinon 403
                  `MODULE_DESACTIVE` (interrupteur du back-office).
     3. DROIT   — permission « module.action » du ou des rôles du joueur, sinon
                  403 `ACCES_REFUSE`.

   Aucune route ne décide « d'après l'interface » : le client masque les écrans
   qu'il ne peut pas utiliser, le serveur refuse quand même. Les refus sur une
   action modifiante sont JOURNALISÉS (les lectures ne le sont pas : un
   observateur qui recharge sa page ne doit pas noyer le journal).

   Ce module ne connaît pas server.js : ce dont il a besoin de l'extérieur
   (diffusion d'un événement tournoi, génération d'un bracket) lui est passé
   dans `ctx.hooks` — sans ce sens unique, un require circulaire rendrait les
   deux modules impossibles à charger.
   ========================================================= */
"use strict";

const { db, User, Wallet, Notification, Tournament, Sanction } = require("../db");
const DATA = require("../data");
const Kyc = require("../kyc");
const Store = require("./store");
/* Routes des modules ajoutés par la refonte v2 : un fichier par domaine, même
   contrat de barrières que ci-dessous. Les garder séparées évite que ce
   routeur — déjà long — devienne le point de passage obligé de tout. */
const EXTRA_ROUTES = [require("./routes.v2"), require("./routes.finance")];
const V2 = require("./store.v2");
const { MODULES, isPermission, allPermissions, isCore } = require("./permissions");
const { readBody, respond, clientIp } = require("../http");

/* Le back-office manipule des formulaires (titre de bannière, motif de refus) :
   quelques kilo-octets. Aucune route d'ici n'accepte d'image — les pièces KYC
   arrivent par /api/kyc/submit, côté joueur. */
const MAX_BODY = 256 * 1024;

/* ---------- Barrière d'accès ---------- */
function authorise(userId, perm) {
  if (!userId) return { ok: false, status: 401, code: "NON_AUTHENTIFIE", error: "Non authentifié" };
  const mod = String(perm).split(".")[0];
  if (!MODULES[mod] || !isPermission(perm))
    return { ok: false, status: 403, code: "PERMISSION_INCONNUE", error: "Accès refusé" };
  if (!Store.moduleEnabled(mod))
    return { ok: false, status: 403, code: "MODULE_DESACTIVE", error: "Ce module est désactivé" };
  if (!Store.can(userId, perm))
    return { ok: false, status: 403, code: "ACCES_REFUSE", error: "Accès refusé" };
  return { ok: true };
}

/* Refus normalisé : `{ error, code }` — le client peut réagir au code sans lire
   la phrase française. */
function refuse(res, r) {
  return respond(res, { error: r.error, code: r.code }, r.status);
}

function clip(v, max) {
  if (v == null) return null;
  return String(v).trim().slice(0, max);
}

/* Entier borné, ou null si la valeur n'est pas un entier exploitable. */
function intIn(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

/* Date AAAA-MM-JJ valide, ou null. On n'accepte pas d'heure : les bornes d'une
   période comptable se lisent en jours, pas en fuseaux horaires. */
function isoDate(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : s;
}

function sendCsv(res, filename, text) {
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(text);
}

/* BOM UTF-8 + « ; » : le tableur français ouvre le fichier sans assistant. */
/* Échappement CSV + protection contre l'INJECTION DE FORMULE.
   Un tableur interprète `=`, `+`, `-`, `@`, tabulation ou retour chariot en
   tête de cellule comme une FORMULE : un pseudo commençant par « = » ferait
   exécuter du code au poste de qui ouvre l'export. On préfixe d'une apostrophe
   — la valeur reste lisible, elle n'est plus exécutable.
   Les NOMBRES en sont exclus : `String(-16000)` commence par « - », et le
   préfixer corromprait une colonne de montants. */
function csvRows(header, rows) {
  const q = (v) => {
    const isNumber = typeof v === "number";
    let s = String(v == null ? "" : v);
    if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return "\ufeff" + [header.map(q).join(";"), ...rows.map((r) => r.map(q).join(";"))].join("\r\n");
}

/* ---------- Identité de l'appelant ---------- */
function mePayload(userId) {
  const roles = Store.rolesOf(userId);
  const rights = Store.rightsOf(userId);
  const permissions = [];
  for (const [mod, acts] of Object.entries(rights)) for (const a of acts) permissions.push(`${mod}.${a}`);
  return {
    roles,
    permissions,
    rights,
    modules: Store.listModules(),
    catalogue: Object.fromEntries(Object.entries(MODULES).map(([id, m]) => [id, m.actions])),
    all: allPermissions(),
    superAdmin: roles.includes("super_admin"),
  };
}


/* ---------- Joueurs ---------- */
/* État KYC de chaque joueur en UNE requête : la dernière ligne de `kyc_cases`
   fait foi, `users.kyc` tranche en cas de compte vérifié sans dossier (comptes
   antérieurs à la v2). */
function kycStatusMap() {
  const map = new Map();
  const rows = db.prepare("SELECT user_id, status FROM kyc_cases ORDER BY id ASC").all();
  for (const r of rows) map.set(r.user_id, r.status);
  return map;
}

function adminUsers(url) {
  const q = clip(url.searchParams.get("q"), 20) || "";
  const limit = intIn(url.searchParams.get("limit"), 1, 200) || 50;
  const cols = "id, pseudo, elo, wins, losses, balance, bonus_lock, kyc, province, avatar, created_at, last_seen";
  const rows = q
    ? db.prepare(`SELECT ${cols} FROM users WHERE pseudo LIKE ? ORDER BY elo DESC LIMIT ?`).all(`%${q}%`, limit)
    : db.prepare(`SELECT ${cols} FROM users ORDER BY elo DESC LIMIT ?`).all(limit);
  const status = kycStatusMap();
  /* Une seule requête pour toutes les suspensions ACTIVES : un `isBlocked()`
     par ligne ferait N requêtes pour un écran qui en affiche 50. */
  const blocked = new Map(db.prepare(
    "SELECT user_id, reason FROM user_sanctions WHERE kind = 'block' AND lifted_at IS NULL"
  ).all().map((r) => [r.user_id, r.reason]));
  /* Dernière visite DANS LE JEU, en UNE requête groupée : la plus récente des
     sessions touchées et des parties créées. Deux sources parce qu'une partie
     terminée garde sa ligne d'historique même quand sa session a disparu. */
  const lastGame = new Map(db.prepare(
    `SELECT player_id, MAX(t) AS t FROM (
       SELECT player1_id AS player_id, updated_at AS t FROM game_sessions
       UNION ALL SELECT player2_id, updated_at FROM game_sessions
       UNION ALL SELECT player1_id, created_at FROM games
       UNION ALL SELECT player2_id, created_at FROM games
     ) GROUP BY player_id`).all().map((r) => [r.player_id, r.t]));
  return rows.map((r) => ({
    id: r.id, pseudo: r.pseudo, elo: r.elo, wins: r.wins, losses: r.losses,
    balance: r.balance, bonus_lock: r.bonus_lock,
    kyc: !!r.kyc, province: r.province || null, avatar: r.avatar || null,
    created_at: r.created_at, last_seen: r.last_seen,
    last_game_at: lastGame.get(r.id) || null,
    kyc_status: r.kyc ? "verified" : (status.get(r.id) || "none"),
    roles: Store.rolesOf(r.id),
    blocked: blocked.has(r.id),
    sanction_reason: blocked.get(r.id) || null,
  }));
}

/* ---------- Dossier d'un joueur (« Examiner ») ----------
   Ce que la fiche doit montrer, et rien de plus : l'identité administrative
   (téléphone, e-mail, date de création), l'activité (dernière connexion,
   dernière visite dans le jeu) et le dernier dossier d'identité.

   AUCUNE image ici : les pièces binaires restent servies par la route dédiée
   `/api/admin/kyc/:id/doc/:face`, qui exige le droit `kyc.review` et journalise
   chaque lecture. Cette fiche ne dit que si les faces EXISTENT — et le droit
   `users.read` suffit pour ça, ce qui évite d'ouvrir les cartes d'identité à un
   rôle de modération qui n'en a pas besoin. */
function adminUserDetail(userId) {
  const id = intIn(userId, 1, Number.MAX_SAFE_INTEGER);
  if (!id) return null;
  const u = db.prepare(
    `SELECT id, pseudo, phone, email, province, avatar, elo, wins, losses,
            balance, bonus_lock, kyc, created_at, last_seen
       FROM users WHERE id = ?`).get(id);
  if (!u) return null;
  const jeu = db.prepare(
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(updated_at) AS t FROM game_sessions WHERE player1_id = ? OR player2_id = ?
       UNION ALL SELECT MAX(created_at) AS t FROM games WHERE player1_id = ? OR player2_id = ?
     )`).get(id, id, id, id);
  const c = db.prepare(
    `SELECT id, status, reason, submitted_at, reviewed_at,
            recto_path, verso_path, bytes_recto, bytes_verso, recto_sha, verso_sha,
            face_path, face_bytes, face_captured_at, retention_until
       FROM kyc_cases WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(id);
  const blocked = db.prepare(
    "SELECT reason FROM user_sanctions WHERE user_id = ? AND kind = 'block' AND lifted_at IS NULL ORDER BY id DESC LIMIT 1"
  ).get(id);
  return {
    id: u.id, pseudo: u.pseudo, phone: u.phone || null, email: u.email || null,
    province: u.province || null, avatar: u.avatar || null,
    elo: u.elo, wins: u.wins, losses: u.losses,
    balance: u.balance, bonus_lock: u.bonus_lock,
    created_at: u.created_at, last_seen: u.last_seen,
    last_game_at: (jeu && jeu.t) || null,
    kyc_status: u.kyc ? "verified" : (c ? c.status : "none"),
    kyc_case: c ? {
      id: c.id, status: c.status, reason: c.reason || null,
      submitted_at: c.submitted_at, reviewed_at: c.reviewed_at,
      faces: { recto: !!c.recto_path, verso: !!c.verso_path },
      bytes: { recto: c.bytes_recto, verso: c.bytes_verso },
      sha8: { recto: String(c.recto_sha || "").slice(0, 8), verso: String(c.verso_sha || "").slice(0, 8) },
      /* Présence du scan facial (migration 025). L'image n'est pas ici : elle
         reste derrière la route protégée par `kyc.review`. */
      face: { present: !!c.face_path, captured_at: c.face_captured_at || null },
      retention_until: c.retention_until || null,
    } : null,
    roles: Store.rolesOf(u.id),
    blocked: !!blocked, sanction_reason: blocked ? blocked.reason : null,
  };
}

/* Deux gestes de support seulement. Ni l'Elo, ni le solde, ni le mot de passe ne
   sont modifiables ici : ce sont des décisions de jeu ou d'identité, pas des
   corrections de modération. */
function updateUserById(userId, body, actor, ip) {
  const target = User.getById(userId);
  if (!target) return { ok: false, status: 404, code: "JOUEUR_INCONNU", error: "Joueur introuvable" };
  const action = String(body.action || "");

  if (action === "revoke-kyc") {
    if (!target.kyc) return { ok: false, status: 409, code: "PAS_VERIFIE", error: "Ce joueur n'est pas vérifié" };
    db.prepare("UPDATE users SET kyc = 0 WHERE id = ?").run(userId);
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "users.revoke-kyc",
      target: `user:${userId}`, detail: { pseudo: target.pseudo, reason: clip(body.reason, 200) }, ip });
    return { ok: true, kyc: false, kyc_status: "none" };
  }

  if (action === "unlock") {
    /* Déblocage après verrouillage pour échecs de mot de passe : la session
       n'est PAS ouverte pour autant, le joueur doit se reconnecter. */
    require("../auth").clearFailures(userId);
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "users.unlock",
      target: `user:${userId}`, detail: { pseudo: target.pseudo }, ip });
    return { ok: true, locked: false };
  }

  /* ---------- Sanctions ----------
     Une suspension qui ne ferme pas la session en cours ne protège rien :
     `revokeAllSessions` coupe les sessions ouvertes, et `login()` refuse
     ensuite toute reconnexion (403 COMPTE_SUSPENDU). */
  if (action === "block" || action === "unblock" || action === "warn") {
    const reason = clip(body.reason, 300);
    if (!reason || reason.length < 3)
      return { ok: false, status: 400, code: "MOTIF_MANQUANT", error: "Un motif est obligatoire" };
    if (action === "block" && Store.hasRole(userId, "super_admin"))
      return { ok: false, status: 409, code: "ROLE_PROTEGE",
        error: "Un super administrateur ne peut pas être suspendu" };

    const kind = action === "warn" ? "warning" : action;
    Sanction.add(userId, kind, reason, actor.id);
    let revoked = 0;
    if (action === "block") revoked = require("../auth").revokeAllSessions(userId, "sanction") || 0;
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: `users.${action}`,
      target: `user:${userId}`, detail: { pseudo: target.pseudo, reason, revokedSessions: revoked }, ip });
    return { ok: true, blocked: Sanction.isBlocked(userId), revokedSessions: revoked };
  }

  return { ok: false, status: 400, code: "ACTION_INCONNUE", error: "Action inconnue" };
}

/* ---------- Dossiers d'identité ---------- */
function kycQueue(url) {
  const status = clip(url.searchParams.get("status"), 20) || "pending";
  const limit = intIn(url.searchParams.get("limit"), 1, 200) || 100;
  return {
    cases: Kyc.listForReview(status, limit),
    /* Politique en vigueur : le scan facial est-il EXIGÉ pour valider ? Lu à
       chaque requête (jamais mis en cache), pour que l'écran dise la vérité
       juste après un changement de réglage. */
    faceRequired: require("./store.v2").setting("kyc_face_required") === true,
    counts: {
      pending: db.prepare("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'pending'").get().c,
      verified: db.prepare("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'verified'").get().c,
      rejected: db.prepare("SELECT COUNT(*) AS c FROM kyc_cases WHERE status = 'rejected'").get().c,
    },
  };
}

function decideKyc(caseId, body, actor, ip) {
  const approve = body.decision === "approve" || body.approve === true;
  const r = Kyc.review(caseId, { approve, reason: body.reason, reviewerId: actor.id });
  /* On journalise le RÉSULTAT, refus compris : une tentative d'auto-validation
     est exactement ce qu'un audit doit contenir. */
  Store.audit({
    actorId: actor.id, actorPseudo: actor.pseudo,
    action: approve ? "kyc.approve" : "kyc.reject",
    target: `kyc:${caseId}`,
    detail: r.ok ? { userId: r.userId, status: r.status, reason: r.reason || null }
                 : { refus: r.code, status: r.status },
    ip,
  });
  /* Une décision change l'état que le joueur voit (dépôt, mises, tournois) :
     il doit l'apprendre sans avoir à recharger. */
  if (r.ok) {
    Notification.create(r.userId, "kyc", approve
      ? { text: "✅ Votre identité est vérifiée — dépôts, retraits, mises et tournois débloqués." }
      : { text: `⚠️ Votre dossier d'identité a été refusé : ${r.reason}` });
  }
  return r;
}

/* ---------- Publicités ---------- */
/* Les bannières sont des fichiers servis par l'application : le chemin doit
   rester dans `assets/`, sinon une « image » deviendrait un lien externe (que la
   CSP bloque de toute façon) ou une traversée de dossier. */
const AD_IMAGE_RE = /^assets\/[A-Za-z0-9_.\-/]+\.(webp|png|jpe?g|gif|svg)$/i;
const AD_LINK_RE = /^https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/i;
const AD_POSITIONS = ["accueil", "profil", "both"];

function adInput(body, { partial = false } = {}) {
  const out = {};
  const set = (k, v) => { if (!partial || v !== undefined) out[k] = v; };

  if (!partial || body.titre !== undefined) {
    const titre = clip(body.titre, 200);
    if (!titre) return { error: "Titre obligatoire" };
    set("titre", titre);
  }
  if (!partial || body.image !== undefined) {
    const image = clip(body.image, 300);
    if (!image || !AD_IMAGE_RE.test(image) || image.includes(".."))
      return { error: "Image invalide : chemin attendu sous assets/ (webp, png, jpg, gif ou svg)" };
    set("image", image);
  }
  if (body.repli !== undefined) {
    const repli = clip(body.repli, 300);
    if (repli && (!AD_IMAGE_RE.test(repli) || repli.includes(".."))) return { error: "Image de repli invalide" };
    set("repli", repli || null);
  }
  if (body.lien !== undefined) {
    const lien = clip(body.lien, 500);
    if (lien && !AD_LINK_RE.test(lien)) return { error: "Lien invalide (http/https attendu)" };
    set("lien", lien || null);
  }
  for (const k of ["debut", "fin"]) {
    if (body[k] === undefined) continue;
    if (body[k] === null || body[k] === "") { set(k, null); continue; }
    const d = isoDate(body[k]);
    if (!d) return { error: `Date ${k} invalide (AAAA-MM-JJ attendu)` };
    set(k, d);
  }
  if (body.debut && body.fin && out.debut && out.fin && out.debut > out.fin)
    return { error: "La date de fin doit suivre la date de début" };
  if (body.position !== undefined) {
    if (!AD_POSITIONS.includes(body.position))
      return { error: "Emplacement invalide (accueil, profil ou both)" };
    set("position", body.position);
  }
  if (body.actif !== undefined) set("actif", !!body.actif);
  if (body.ordre !== undefined) set("ordre", intIn(body.ordre, 0, 999) || 0);
  if (body.slug !== undefined) set("slug", clip(body.slug, 60));
  return { data: out };
}

/* ---------- Tournois ---------- */
const TOURNAMENT_STATUSES = ["inscriptions", "en_cours", "termine", "annule"];

function adminTournaments() {
  const rows = db.prepare("SELECT * FROM tournaments ORDER BY starts_at DESC").all();
  return rows.map((t) => {
    const n = db.prepare("SELECT COUNT(*) AS c FROM tournament_registrations WHERE tournament_id = ?").get(t.id).c;
    return {
      id: t.id, name: t.name, game: t.game, format: t.format, entry: t.entry,
      maxPlayers: t.max_players, status: t.status, sponsor: t.sponsor, minRank: t.min_rank,
      startsAt: t.starts_at, registered: n, createdAt: t.created_at,
      matchDurationMin: t.match_duration_min, intervalMin: t.interval_min,
    };
  });
}

function tournamentInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = clip(body.name, 120);
    if (!name) return { error: "Nom obligatoire" };
    out.name = name;
  }
  if (!partial || body.format !== undefined) {
    const format = clip(body.format, 20) || "rapide";
    if (!DATA.FORMATS.some((f) => f.id === format)) return { error: "Format inconnu" };
    out.format = format;
  }
  if (!partial || body.entry !== undefined) {
    const entry = intIn(body.entry, 0, 1000000);
    if (entry === null) return { error: "Entrée invalide" };
    out.entry = entry;
  }
  if (body.maxPlayers !== undefined || !partial) {
    const mp = intIn(body.maxPlayers, 2, 64);
    if (mp === null) return { error: "Nombre de joueurs invalide (2 à 64)" };
    /* Un bracket à élimination directe se joue sur une PUISSANCE DE 2 :
       « pair » ne suffit pas (6 joueurs donnent un tableau à trous et un
       tour orphelin). */
    if ((mp & (mp - 1)) !== 0)
      return { error: "Le bracket exige une puissance de 2 (2, 4, 8, 16, 32, 64)" };
    out.max_players = mp;
  }
  if (body.startsAt !== undefined || !partial) {
    const d = new Date(String(body.startsAt || ""));
    if (isNaN(d.getTime())) return { error: "Date de début invalide" };
    out.starts_at = d.toISOString();
  }
  if (body.sponsor !== undefined) out.sponsor = clip(body.sponsor, 80) || null;
  if (body.minRank !== undefined) out.min_rank = clip(body.minRank, 20) || "Bronze";
  if (body.game !== undefined) out.game = clip(body.game, 40) || "fanorana";
  if (body.matchDurationMin !== undefined) out.match_duration_min = intIn(body.matchDurationMin, 1, 240) || 5;
  if (body.intervalMin !== undefined) out.interval_min = intIn(body.intervalMin, 0, 240) || 0;
  return { data: out };
}

/* Annulation : l'entrée est REMBOURSÉE à chaque inscrit et les inscriptions sont
   effacées. Sans le remboursement, annuler un tournoi payant reviendrait à
   garder l'argent des joueurs. */
function cancelTournament(t, actor, ip, hooks) {
  if (t.status === "annule") return { ok: false, status: 409, code: "DEJA_ANNULE", error: "Tournoi déjà annulé" };
  if (t.status === "termine") return { ok: false, status: 409, code: "TERMINE", error: "Un tournoi terminé ne s'annule pas" };
  const regs = Tournament.getRegistrations(t.id);
  const entry = parseInt(t.entry, 10) || 0;
  let refunded = 0;
  for (const r of regs) {
    if (entry > 0) {
      Wallet.credit(r.id, entry, `Remboursement - annulation ${t.name}`);
      refunded += entry;
    }
    Notification.create(r.id, "tournoi", { text: `⚠️ Le tournoi « ${t.name} » est annulé${entry > 0 ? ` — entrée de ${entry} Ar remboursée` : ""}.`, tournamentId: t.id });
  }
  db.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ?").run(t.id);
  /* Les rencontres du tournoi sont annulées : un bracket qui survit à
     l'annulation de son édition laisserait des matchs jouables dans un
     tournoi qui n'existe plus. */
  const cancelled = db.prepare(
    "SELECT COUNT(*) AS c FROM tournament_matches WHERE tournament_id = ?"
  ).get(t.id).c;
  db.prepare("UPDATE tournament_matches SET status = 'annule' WHERE tournament_id = ?").run(t.id);
  db.prepare("UPDATE tournaments SET status = 'annule' WHERE id = ?").run(t.id);
  Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "tournaments.cancel",
    target: `tournament:${t.id}`,
    detail: { name: t.name, registrations: regs.length, refunded, matches: cancelled }, ip });
  if (hooks && hooks.broadcast) hooks.broadcast({ type: "tournament_update" });
  return { ok: true, status: "annule", registrations: regs.length, refunded, matches: cancelled };
}


/* ---------- Comptabilité ---------- */
/* Rien n'est calculé « au taux du jour » : les montants sont ceux des lignes de
   `transactions`, classées par famille et par moyen. Aucune commission, aucune
   cagnotte théorique n'est inventée ici — une comptabilité qui invente un
   chiffre est pire qu'une comptabilité absente. */
function accounting(url) {
  const today = new Date().toISOString().slice(0, 10);
  const to = isoDate(url.searchParams.get("to")) || today;
  const from = isoDate(url.searchParams.get("from")) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const lo = `${from} 00:00:00`;
  const hi = `${to} 23:59:59`;

  const groups = db.prepare(
    `SELECT label, dir, COUNT(*) AS n, SUM(amount) AS total
     FROM transactions WHERE created_at >= ? AND created_at <= ?
     GROUP BY label, dir`
  ).all(lo, hi);

  const kinds = new Map();
  const methods = new Map();
  const totals = { in: { count: 0, amount: 0 }, out: { count: 0, amount: 0 } };

  const bump = (map, key, extra, r) => {
    if (!map.has(key)) map.set(key, { key, label: extra, count: 0, in: 0, out: 0 });
    const e = map.get(key);
    e.count += r.n;
    if (r.dir === "in") e.in += r.total || 0; else e.out += r.total || 0;
  };

  for (const r of groups) {
    const kind = DATA.txKind(r.label);
    bump(kinds, kind, DATA.txKindLabel(kind), r);
    bump(methods, DATA.txMethod(r.label), DATA.txMethod(r.label), r);
    const dir = r.dir === "in" ? "in" : "out";
    totals[dir].count += r.n;
    totals[dir].amount += r.total || 0;
  }

  const sums = db.prepare("SELECT COUNT(*) AS n, SUM(balance) AS b, SUM(bonus_lock) AS l FROM users").get();
  const verified = db.prepare("SELECT COUNT(*) AS c FROM users WHERE kyc = 1").get().c;
  const active = db.prepare(
    "SELECT COUNT(DISTINCT user_id) AS c FROM transactions WHERE created_at >= ? AND created_at <= ?"
  ).get(lo, hi).c;

  /* Engagement du carnet : ce que l'application DOIT aux joueurs. C'est la
     seule ligne qui ne vienne pas des transactions, et elle est indispensable —
     un total de dépôts sans le solde restant ne dit rien. */
  return {
    from, to, totals,
    byKind: [...kinds.values()].sort((a, b) => (b.in + b.out) - (a.in + a.out)),
    byMethod: [...methods.values()].sort((a, b) => (b.in + b.out) - (a.in + a.out)),
    players: { total: sums.n || 0, active: active || 0, kycVerified: verified || 0 },
    balances: { total: sums.b || 0, bonusLocked: sums.l || 0, available: (sums.b || 0) - (sums.l || 0) },
    note: "Montants lus dans `transactions` sur la période, sans commission calculée.",
  };
}

function accountingCsv(url) {
  const to = isoDate(url.searchParams.get("to")) || new Date().toISOString().slice(0, 10);
  const from = isoDate(url.searchParams.get("from")) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT t.created_at, t.label, t.dir, t.amount, t.status, u.pseudo
     FROM transactions t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.created_at >= ? AND t.created_at <= ?
     ORDER BY t.created_at ASC, t.id ASC LIMIT 50000`
  ).all(`${from} 00:00:00`, `${to} 23:59:59`);
  /* Le pseudo est ajouté à la ligne avant de passer par le formateur CSV du
     wallet : un export comptable sans le joueur ne serait pas vérifiable. */
  const lines = rows.map((r) => ({ ...r, label: r.pseudo ? `${r.label} — ${r.pseudo}` : r.label }));
  return { filename: `d-aona-comptabilite-${from}_${to}.csv`, text: DATA.txCsv(lines) };
}

/* ---------- Elo et badges (LECTURE SEULE) ---------- */
/* Ces deux écrans n'écrivent rien : l'Elo se gagne en jouant, les badges
   découlent du rang. Les offrir en écriture serait une porte ouverte au
   classement truqué. */
function eloSnapshot() {
  const rows = db.prepare("SELECT id, pseudo, elo, wins, losses, kyc FROM users ORDER BY elo DESC").all();
  const n = rows.length;
  const values = rows.map((r) => r.elo || 0).sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const median = n ? (n % 2 ? values[(n - 1) / 2] : Math.round((values[n / 2 - 1] + values[n / 2]) / 2)) : 0;
  const bands = [
    { id: "1500+", test: (v) => v >= 1500 },
    { id: "1300-1499", test: (v) => v >= 1300 && v < 1500 },
    { id: "1100-1299", test: (v) => v >= 1100 && v < 1300 },
    { id: "<1100", test: (v) => v < 1100 },
  ].map((b) => ({ id: b.id, players: values.filter(b.test).length }));
  return {
    stats: {
      players: n,
      average: n ? Math.round(sum / n) : 0,
      median,
      min: n ? values[0] : 0,
      max: n ? values[n - 1] : 0,
    },
    bands,
    top: rows.slice(0, 20).map((r, i) => ({
      rank: i + 1, id: r.id, pseudo: r.pseudo, elo: r.elo, wins: r.wins, losses: r.losses,
      badge: DATA.badgeFor(i + 1).name,
    })),
    note: "Lecture seule : l'Elo ne s'écrit qu'en fin de partie.",
  };
}

function badgesOverview() {
  const rows = db.prepare("SELECT id, pseudo, elo FROM users ORDER BY elo DESC").all();
  const counts = new Map();
  rows.forEach((r, i) => {
    const b = DATA.badgeFor(i + 1);
    counts.set(b.name, (counts.get(b.name) || 0) + 1);
  });
  return {
    badges: DATA.BADGES.map((b) => ({
      name: b.name, icon: b.icon, color: b.color, ink: b.ink,
      min: b.min, max: Number.isFinite(b.max) ? b.max : null,
      members: counts.get(b.name) || 0,
    })),
    holders: rows.slice(0, 10).map((r, i) => ({
      rank: i + 1, id: r.id, pseudo: r.pseudo, elo: r.elo, badge: DATA.badgeFor(i + 1).name,
    })),
    note: "Lecture seule : le badge découle du rang au classement.",
  };
}


/* ---------- Rôles, droits, attributions ---------- */
function updateRole(roleId, body, actor, ip) {
  const role = db.prepare("SELECT * FROM admin_roles WHERE id = ?").get(roleId);
  if (!role) return { ok: false, status: 404, code: "ROLE_INCONNU", error: "Rôle inconnu" };
  /* Le rôle fondateur est en lecture seule : ses droits sont calculés, il n'a
     rien à modifier, et le laisser éditable permettrait de se couper l'herbe
     sous le pied en une requête. */
  if (role.protected)
    return { ok: false, status: 409, code: "ROLE_PROTEGE", error: "Le rôle super administrateur n'est pas modifiable" };
  const changes = Array.isArray(body.changes) ? body.changes.slice(0, 200) : [];
  if (!changes.length) return { ok: false, status: 400, code: "AUCUN_CHANGEMENT", error: "Aucune modification fournie" };
  const touched = Store.setGrants(roleId, changes);
  Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "roles.edit",
    target: `role:${roleId}`, detail: { touched, changes: changes.slice(0, 20) }, ip });
  return { ok: true, role: roleId, touched, roles: Store.listRoles() };
}

function updateAssignment(body, actor, ip) {
  const roleId = clip(body.role, 40);
  const pseudo = clip(body.pseudo, 20);
  const action = String(body.action || "grant");
  if (!roleId || !pseudo) return { ok: false, status: 400, code: "CHAMP_MANQUANT", error: "Pseudo et rôle obligatoires" };
  if (!db.prepare("SELECT 1 AS x FROM admin_roles WHERE id = ?").get(roleId))
    return { ok: false, status: 404, code: "ROLE_INCONNU", error: "Rôle inconnu" };
  const target = User.getByPseudo(pseudo);
  if (!target) return { ok: false, status: 404, code: "JOUEUR_INCONNU", error: "Joueur introuvable" };

  const isSuper = Store.hasRole(actor.id, "super_admin");

  if (action === "grant") {
    /* On ne distribue que ce qu'on possède : un modérateur ne peut pas fabriquer
       un administrateur (escalade de privilèges par rebond). */
    if (!isSuper && !Store.hasRole(actor.id, roleId))
      return { ok: false, status: 403, code: "ESCALADE", error: "Vous ne pouvez attribuer qu'un rôle que vous détenez" };
    Store.grantRole(target.id, roleId, actor.id);
  } else if (action === "revoke") {
    if (roleId === "super_admin" && Store.countRole("super_admin") <= 1)
      return { ok: false, status: 409, code: "DERNIER_SUPER",
        error: "Impossible de retirer le dernier super administrateur" };
    Store.revokeRole(target.id, roleId);
  } else {
    return { ok: false, status: 400, code: "ACTION_INCONNUE", error: "Action inconnue" };
  }

  Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: `roles.${action}`,
    target: `user:${target.id}`, detail: { pseudo: target.pseudo, role: roleId }, ip });
  return { ok: true, userId: target.id, roles: Store.rolesOf(target.id) };
}


/* ---------- Routeur ---------- */
function denied(req, res, g, actor, ip) {
  /* Les refus sur une ACTION sont journalisés : « qui a essayé » compte autant
     que « qui a réussi ». Les lectures refusées, non (bruit). */
  if (req.method !== "GET")
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "acces.refuse",
      target: String(req.url).slice(0, 120), detail: { code: g.code }, ip });
  return refuse(res, g);
}

async function handle(req, res, url, ctx) {
  const method = req.method;
  const parts = url.pathname.slice("/api/admin".length).split("/").filter(Boolean);
  const ip = clientIp(req);
  const actor = { id: ctx.userId || null, pseudo: (ctx.user && ctx.user.pseudo) || null };
  const hooks = ctx.hooks || {};
  /* Garde réutilisable : elle écrit ELLE-MÊME le refus (401/403 + journal sur
     une action). Un module de routes n'a donc pas à connaître la forme d'un
     refus — une seule définition, un seul comportement. */
  const guard = (perm) => {
    const g = authorise(ctx.userId, perm);
    if (!g.ok) denied(req, res, g, actor, ip);
    return g.ok;
  };
  const body = async () => {
    const b = await readBody(req, MAX_BODY);
    if (b && b.__tooLarge) return null;
    return b || {};
  };

  /* « Moi » : ouvert à tout porteur d'un rôle. C'est la seule réponse dont
     l'interface a besoin pour savoir quels écrans afficher — la soumettre à une
     permission créerait une dépendance circulaire (il faut connaître ses droits
     pour demander ses droits). */
  if (method === "GET" && (parts.length === 0 || parts[0] === "me")) {
    if (!ctx.userId) return refuse(res, { status: 401, code: "NON_AUTHENTIFIE", error: "Non authentifié" });
    if (!Store.rolesOf(ctx.userId).length)
      return refuse(res, { status: 403, code: "ACCES_REFUSE", error: "Accès refusé" });
    return respond(res, { ...mePayload(ctx.userId), userId: ctx.userId, pseudo: actor.pseudo });
  }

  /* GET /api/admin/modules */
  if (method === "GET" && parts[0] === "modules" && parts.length === 1) {
    const g = authorise(ctx.userId, "modules.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { modules: Store.listModules() });
  }

  /* POST /api/admin/modules/:id — interrupteur global { enabled }
     Un module SOCLE ne s'éteint pas : couper « Rôles & permissions » ou
     « Modules » laisserait le back-office sans moyen de se rallumer, ce qui
     est exactement ce qu'un interrupteur ne doit jamais permettre. Le refus
     est 409 et non 403 : ce n'est pas un droit qui manque, c'est l'action qui
     est interdite à tout le monde. */
  if (method === "POST" && parts[0] === "modules" && parts.length === 2) {
    const g = authorise(ctx.userId, "modules.edit");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    if (!b.enabled && isCore(parts[1]))
      return refuse(res, { status: 409, code: "MODULE_SOCLE",
        error: "Module socle : il ne peut pas être désactivé" });
    if (!Store.setModuleEnabled(parts[1], !!b.enabled))
      return refuse(res, { status: 404, code: "MODULE_INCONNU", error: "Module inconnu" });
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "modules.toggle",
      target: `module:${parts[1]}`, detail: { enabled: !!b.enabled }, ip });
    return respond(res, { ok: true, modules: Store.listModules() });
  }

  /* GET /api/admin/roles */
  if (method === "GET" && parts[0] === "roles" && parts.length === 1) {
    const g = authorise(ctx.userId, "roles.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { roles: Store.listRoles(), modules: Store.listModules() });
  }

  /* POST /api/admin/roles/:id — { changes: [{ module, action, allowed }] } */
  if (method === "POST" && parts[0] === "roles" && parts.length === 2) {
    const g = authorise(ctx.userId, "roles.edit");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const r = updateRole(parts[1], b, actor, ip);
    if (!r.ok) return refuse(res, r);
    return respond(res, r);
  }

  /* GET /api/admin/assignments — qui détient quel rôle */
  if (method === "GET" && parts[0] === "assignments" && parts.length === 1) {
    const g = authorise(ctx.userId, "roles.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { assignments: Store.listAssignments() });
  }

  /* POST /api/admin/assignments — { pseudo, role, action } */
  if (method === "POST" && parts[0] === "assignments" && parts.length === 1) {
    const g = authorise(ctx.userId, "roles.edit");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const r = updateAssignment(b, actor, ip);
    if (!r.ok) return refuse(res, r);
    return respond(res, r);
  }

  /* GET /api/admin/audit */
  if (method === "GET" && parts[0] === "audit" && parts.length === 1) {
    const g = authorise(ctx.userId, "audit.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { entries: Store.listAudit(intIn(url.searchParams.get("limit"), 1, 500) || 100) });
  }

  /* GET /api/admin/users?q=&limit= */
  if (method === "GET" && parts[0] === "users" && parts.length === 1) {
    const g = authorise(ctx.userId, "users.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { users: adminUsers(url) });
  }

  /* GET /api/admin/users/:id — dossier de consultation (« Examiner »).
     Droit `users.read`, et l'acte est JOURNALISÉ : qui a consulté quel joueur,
     et quand. C'est la contrepartie du droit de regard sur des données
     personnelles. */
  if (method === "GET" && parts[0] === "users" && parts.length === 2) {
    const g = authorise(ctx.userId, "users.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const id = parseInt(parts[1], 10);
    const r = adminUserDetail(id);
    if (!r) return refuse(res, { status: 404, code: "JOUEUR_INCONNU", error: "Joueur introuvable" });
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "users.examine",
      target: `user:${id}`, detail: { pseudo: r.pseudo }, ip });
    return respond(res, r);
  }

  /* POST /api/admin/users/:id — { action: "revoke-kyc" | "unlock" } */
  if (method === "POST" && parts[0] === "users" && parts.length === 2) {
    const g = authorise(ctx.userId, "users.edit");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const r = updateUserById(parseInt(parts[1], 10), b, actor, ip);
    if (!r.ok) return refuse(res, r);
    return respond(res, r);
  }


  /* ---------- Dossiers d'identité ---------- */

  /* GET /api/admin/kyc?status=pending — file de revue */
  if (method === "GET" && parts[0] === "kyc" && parts.length === 1) {
    const g = authorise(ctx.userId, "kyc.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, kycQueue(url));
  }

  /* GET /api/admin/kyc/:id/doc/:face — la pièce elle-même (recto | verso).
     Jamais mise en cache, jamais devinée dans un dossier public : le chemin
     vient de la base, et cette route est la SEULE à pouvoir la lire. */
  if (method === "GET" && parts[0] === "kyc" && parts.length === 4 && parts[2] === "doc") {
    const g = authorise(ctx.userId, "kyc.review");
    if (!g.ok) return denied(req, res, g, actor, ip);
    /* Trois pièces possibles : recto, verso et le scan facial (migration 025).
       Toute autre valeur est refusée — le nom de fichier ne vient JAMAIS de
       l'URL, seulement de la base. */
    const face = parts[3] === "verso" ? "verso"
      : parts[3] === "recto" ? "recto"
      : parts[3] === "visage" ? "visage"
      : null;
    if (!face) return refuse(res, { status: 400, code: "FACE_INVALIDE", error: "Face inconnue (recto, verso ou visage)" });
    const caseId = parseInt(parts[1], 10);
    const doc = Kyc.openDoc(caseId, face);
    if (!doc) return refuse(res, { status: 404, code: "PIECE_ABSENTE", error: "Pièce introuvable" });
    /* Lire une carte d'identité est un acte sensible : il est journalisé. */
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "kyc.doc",
      target: `kyc:${caseId}`, detail: { face, bytes: doc.buf.length }, ip });
    res.writeHead(200, {
      "Content-Type": doc.mime,
      "Content-Length": doc.buf.length,
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${face}-${caseId}"`,
    });
    return res.end(doc.buf);
  }

  /* POST /api/admin/kyc/:id/approve | /reject */
  if (method === "POST" && parts[0] === "kyc" && parts.length === 3 &&
      (parts[2] === "approve" || parts[2] === "reject")) {
    const g = authorise(ctx.userId, "kyc.review");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    b.decision = parts[2];
    const r = decideKyc(parseInt(parts[1], 10), b, actor, ip);
    if (!r.ok) return refuse(res, r);
    return respond(res, { ok: true, status: r.status, userId: r.userId, reason: r.reason || null,
      counts: kycQueue(url).counts });
  }

  /* ---------- Publicités ---------- */

  /* GET /api/admin/ads — le MODULE s'appelle « campaigns », le chemin non :
     renommer une URL publique est un changement de contrat, traité avec le
     reste du contrat v2 — pas au détour d'une bascule de vocabulaire. */
  if (method === "GET" && parts[0] === "ads" && parts.length === 1) {
    const g = authorise(ctx.userId, "campaigns.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { ads: Store.adsList() });
  }

  /* POST /api/admin/ads — création */
  if (method === "POST" && parts[0] === "ads" && parts.length === 1) {
    const g = authorise(ctx.userId, "campaigns.create");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const v = adInput(b);
    if (v.error) return refuse(res, { status: 400, code: "CHAMP_INVALIDE", error: v.error });
    let ad;
    try { ad = Store.adCreate(v.data, b.slug); }
    catch (e) { return refuse(res, { status: 409, code: "SLUG_EXISTANT", error: "Un identifiant identique existe déjà" }); }
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "campaigns.create",
      target: `ad:${ad.id}`, detail: { slug: ad.slug, titre: ad.titre }, ip });
    return respond(res, { ok: true, ad });
  }

  /* POST /api/admin/ads/:id — modification (l'état `actif` s'y règle aussi :
     désactiver une bannière n'est pas la supprimer) */
  if (method === "POST" && parts[0] === "ads" && parts.length === 2) {
    const g = authorise(ctx.userId, "campaigns.edit");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const id = parseInt(parts[1], 10);
    if (!Store.adGet(id)) return refuse(res, { status: 404, code: "PUB_INCONNUE", error: "Bannière introuvable" });
    const v = adInput(b, { partial: true });
    if (v.error) return refuse(res, { status: 400, code: "CHAMP_INVALIDE", error: v.error });
    const ad = Store.adUpdate(id, v.data);
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "campaigns.edit",
      target: `ad:${id}`, detail: { champs: Object.keys(v.data) }, ip });
    return respond(res, { ok: true, ad });
  }

  /* DELETE /api/admin/ads/:id */
  if (method === "DELETE" && parts[0] === "ads" && parts.length === 2) {
    const g = authorise(ctx.userId, "campaigns.delete");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const id = parseInt(parts[1], 10);
    const ad = Store.adGet(id);
    if (!ad) return refuse(res, { status: 404, code: "PUB_INCONNUE", error: "Bannière introuvable" });
    Store.adDelete(id);
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "campaigns.delete",
      target: `ad:${id}`, detail: { slug: ad.slug, titre: ad.titre }, ip });
    return respond(res, { ok: true });
  }


  /* ---------- Tournois ---------- */

  /* GET /api/admin/tournaments */
  if (method === "GET" && parts[0] === "tournaments" && parts.length === 1) {
    const g = authorise(ctx.userId, "tournaments.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, { tournaments: adminTournaments() });
  }

  /* POST /api/admin/tournaments — création */
  if (method === "POST" && parts[0] === "tournaments" && parts.length === 1) {
    const g = authorise(ctx.userId, "tournaments.create");
    if (!g.ok) return denied(req, res, g, actor, ip);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const v = tournamentInput(b);
    if (v.error) return refuse(res, { status: 400, code: "CHAMP_INVALIDE", error: v.error });
    const d = v.data;
    const info = db.prepare(
      `INSERT INTO tournaments (name, game, format, entry, max_players, status, min_rank, sponsor,
                                starts_at, match_duration_min, interval_min)
       VALUES (?, ?, ?, ?, ?, 'inscriptions', ?, ?, ?, ?, ?)`
    ).run(d.name, d.game || "fanorana", d.format, d.entry, d.max_players,
      d.min_rank || "Bronze", d.sponsor || null, d.starts_at,
      d.match_duration_min || 5, d.interval_min === undefined ? 5 : d.interval_min);
    const id = info.lastInsertRowid;
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "tournaments.create",
      target: `tournament:${id}`, detail: { name: d.name, entry: d.entry, maxPlayers: d.max_players }, ip });
    if (hooks.broadcast) hooks.broadcast({ type: "tournament_update" });
    return respond(res, { ok: true, tournament: adminTournaments().find((t) => String(t.id) === String(id)) || null });
  }

  /* POST /api/admin/tournaments/:id — { action: "update" | "cancel" }
     Le corps est lu UNE fois (une seconde lecture d'un flux déjà consommé ne
     rendrait jamais la main) ; l'action qu'il contient décide ensuite de la
     permission exacte à exiger.

     ORDRE DES BARRIÈRES : session → module → DROIT → donnée. Le contrôle de
     droit passe donc AVANT `Tournament.get()`. Sinon un rôle sans droit reçoit
     un 404 qui dépend de l'existence de la ressource, et la barrière n'est
     jamais réellement franchie — ce que `scripts/permissions.js` a mesuré. */
  if (method === "POST" && parts[0] === "tournaments" && parts.length === 2) {
    const id = parseInt(parts[1], 10);
    const b = await body();
    if (!b) return respond(res, { error: "Requête trop volumineuse" }, 413);
    const action = String(b.action || "update");

    /* Annuler une édition est une TRANSITION, pas une suppression : la maquette
       n'accorde aucun `delete` sur les tournois, et l'historique doit rester.
       Les deux branches exigent donc le même droit, vérifié une seule fois. */
    const g = authorise(ctx.userId, "tournaments.edit");
    if (!g.ok) return denied(req, res, g, actor, ip);

    const t = Tournament.get(id);
    if (!t) return refuse(res, { status: 404, code: "TOURNOI_INCONNU", error: "Tournoi introuvable" });

    if (action === "cancel") {
      const r = cancelTournament(t, actor, ip, hooks);
      if (!r.ok) return refuse(res, r);
      return respond(res, r);
    }

    /* Le droit `tournaments.edit` a déjà été vérifié plus haut, avant la
       lecture : le revérifier ici serait redondant, et une seconde déclaration
       masquerait la première. */
    const v = tournamentInput(b, { partial: true });
    if (v.error) return refuse(res, { status: 400, code: "CHAMP_INVALIDE", error: v.error });
    const keys = Object.keys(v.data);
    if (!keys.length) return refuse(res, { status: 400, code: "AUCUN_CHANGEMENT", error: "Aucune modification fournie" });
    db.prepare(`UPDATE tournaments SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => v.data[k]), id);
    Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "tournaments.edit",
      target: `tournament:${id}`, detail: { champs: keys, name: t.name }, ip });
    if (hooks.broadcast) hooks.broadcast({ type: "tournament_update" });
    return respond(res, { ok: true, tournament: adminTournaments().find((x) => String(x.id) === String(id)) || null });
  }

  /* ---------- Comptabilité ---------- */

  /* GET /api/admin/accounting?from=&to=  —  ?format=csv exige le droit d'export */
  if (method === "GET" && parts[0] === "accounting" && parts.length === 1) {
    const wantCsv = url.searchParams.get("format") === "csv";
    const g = authorise(ctx.userId, wantCsv ? "finance.export" : "finance.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    if (wantCsv) {
      const { filename, text } = accountingCsv(url);
      Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "finance.export",
        target: filename, detail: { from: isoDate(url.searchParams.get("from")), to: isoDate(url.searchParams.get("to")) }, ip });
      return sendCsv(res, filename, text);
    }
    return respond(res, accounting(url));
  }

  /* ---------- Elo et badges (lecture seule) ---------- */
  if (method === "GET" && parts[0] === "elo" && parts.length === 1) {
    const g = authorise(ctx.userId, "ranking.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, eloSnapshot());
  }

  if (method === "GET" && parts[0] === "badges" && parts.length === 1) {
    const g = authorise(ctx.userId, "ranking.read");
    if (!g.ok) return denied(req, res, g, actor, ip);
    return respond(res, badgesOverview());
  }

  /* ---------- Modules de la refonte v2 ----------
     Chacun reçoit le MÊME contexte que les routes ci-dessus et renvoie true
     s'il a répondu. L'ordre compte : un module qui ne reconnaît pas la route
     doit pouvoir la laisser passer. */
  const extra = {
    res, url, method, parts, actor, ip, body, guard,
    respond, refuse,
    audit: (e) => Store.audit({ actorId: actor.id, actorPseudo: actor.pseudo, ...e, ip }),
    broadcast: (module) => { if (hooks.broadcast) hooks.broadcast({ type: "admin_update", module }); },
    notifyWallet: (userId) => { if (hooks.walletUpdate) hooks.walletUpdate(userId); },
  };
  for (const route of EXTRA_ROUTES) if (await route(extra)) return;

  /* Route inconnue SOUS /api/admin : 404 explicite. Le serveur ne doit pas
     répondre 200 « rien à faire » — un back-office qui accepte une URL qu'il ne
     connaît pas masque une faute de frappe côté client. */
  return respond(res, { error: "Route d'administration inconnue", code: "ROUTE_INCONNUE" }, 404);
}

/* Amorçage explicite : appelé au démarrage du serveur (et par admin_grant.js).
   Il est idempotent — le rappeler ne réécrit aucun droit existant. */
function init() {
  Store.ensureSeed();
  /* Amorçages de la v2 : même règle qu'en 016 — ils ne remplissent que ce qui
     est VIDE. Un catalogue édité par un administrateur survit au redémarrage. */
  V2.ensureSettings();
  V2.ensureCatalogue();
  V2.ensureBadges();
}

module.exports = { handle, init, authorise, Store };
