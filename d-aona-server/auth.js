/* =========================================================
   D-aôna — Authentification et sessions
   ---------------------------------------------------------
   Remplace l'ancien mécanisme « pseudo seul » (POST /api/auth créait ou
   ouvrait un compte sans aucune preuve d'identité) par :

     - mot de passe haché en Argon2id (bibliothèque @node-rs/argon2,
       paramètres OWASP : m=19 MiB, t=2, p=1) ;
     - jetons de session OPAQUES, stockés uniquement sous forme
       d'empreinte SHA-256 en base, expirants et révocables ;
     - verrouillage progressif du compte après échecs répétés ;
     - limitation de débit par adresse IP ;
     - journal d'audit en ajout seul (auth_audit_log).

   Ce module ne renvoie JAMAIS de mot de passe, d'empreinte ni de jeton
   dans un message d'erreur ou une entrée de journal.
   ========================================================= */
"use strict";

const crypto = require("node:crypto");
const argon2 = require("@node-rs/argon2");
const { db, User } = require("./db");

/* ---------- Paramètres de hachage -------------------------------------
   Argon2id est l'algorithme recommandé. `algorithm: 2` est explicite
   (Argon2id) : on ne dépend pas du défaut de la bibliothèque pour un
   paramètre de sécurité. */
const ARGON_OPTIONS = {
  algorithm: 2,          // 2 = Argon2id
  memoryCost: 19456,     // 19 MiB
  timeCost: 2,           // 2 passes
  parallelism: 1,
  outputLen: 32,
};
const ALGO_LABEL = "argon2id";

/* Borne haute : hacher un mot de passe très long consomme des ressources.
   On refuse AVANT de hacher, sinon un appelant peut saturer le serveur. */
const PWD_MAX = 128;

/* ---------- Politique de mot de passe ---------------------------------
   Calquée EXACTEMENT sur celle déjà imposée par l'interface
   (index.html → PWD_RULES) afin que le serveur ne refuse jamais ce que
   l'UI accepte — et qu'un appel direct à l'API ne puisse pas la contourner. */
const PWD_RULES = [
  { id: "len",  label: "12 caractères minimum",          test: (v) => v.length >= 12 },
  { id: "case", label: "une minuscule et une majuscule", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: "num",  label: "au moins un chiffre",            test: (v) => /\d/.test(v) },
  { id: "spec", label: "au moins un caractère spécial",  test: (v) => /[^A-Za-z0-9\s]/.test(v) },
];

function validatePassword(pwd) {
  const v = String(pwd == null ? "" : pwd);
  if (v.length > PWD_MAX) {
    return { ok: false, error: `Mot de passe trop long (${PWD_MAX} caractères maximum).`, missing: [] };
  }
  const missing = PWD_RULES.filter((r) => !r.test(v)).map((r) => r.label);
  if (missing.length) return { ok: false, error: "Mot de passe trop faible.", missing };
  return { ok: true, missing: [] };
}

async function hashPassword(pwd) {
  return argon2.hash(String(pwd), ARGON_OPTIONS);
}

/* Vérification tolérante : une empreinte illisible (base altérée, ancien
   format) renvoie false au lieu de lever une exception dans la route. */
async function verifyPassword(hash, pwd) {
  if (!hash) return false;
  try {
    return await argon2.verify(String(hash), String(pwd));
  } catch (_) {
    return false;
  }
}

/* Empreinte factice, calculée une seule fois et réutilisée quand le pseudo
   n'existe pas : le temps de réponse reste comparable, ce qui évite de
   pouvoir énumérer les comptes existants par chronométrage. */
let _dummyHash = null;
async function dummyHash() {
  if (!_dummyHash) _dummyHash = await hashPassword(crypto.randomBytes(18).toString("hex"));
  return _dummyHash;
}

/* ---------- Pseudos ---------------------------------------------------
   Même normalisation que l'API historique (14 caractères, balises retirées)
   pour ne pas casser les comptes existants. */
function normalizePseudo(p) {
  return String(p == null ? "" : p).trim().slice(0, 14).replace(/<[^>]*>/g, "");
}

function isValidPseudo(p) {
  return typeof p === "string" && p.length >= 3 && /^[A-Za-z0-9_.\- ]+$/.test(p);
}

/* ---------- Utilitaires temps ----------------------------------------
   Les dates écrites par ce module sont en ISO 8601 UTC : les comparaisons
   SQL restent cohérentes entre elles. */
const nowIso = () => new Date().toISOString();
const plusSeconds = (s) => new Date(Date.now() + s * 1000).toISOString();

/* ---------- Paramètres de session ------------------------------------ */
const SESSION_TTL_SECONDS = 30 * 24 * 3600;   // 30 jours
const LAST_USED_THROTTLE_MS = 3600 * 1000;    // n'écrit `last_used_at` qu'une fois par heure

/* ---------- Verrouillage progressif ----------------------------------
   5 échecs → 1 min ; 6 → 2 min ; ... doublé à chaque échec, plafonné à 60 min.
   Le compteur est remis à zéro par une connexion réussie. */
const LOCK_THRESHOLD = 5;
const LOCK_BASE_SECONDS = 60;
const LOCK_MAX_SECONDS = 3600;

function lockDurationSeconds(failedAttempts) {
  if (failedAttempts < LOCK_THRESHOLD) return 0;
  return Math.min(LOCK_MAX_SECONDS, LOCK_BASE_SECONDS * Math.pow(2, failedAttempts - LOCK_THRESHOLD));
}

/* ---------- Limitation de débit par IP -------------------------------
   Fenêtre glissante en mémoire : le serveur est mono-processus (PC hôte),
   un stockage partagé n'apporterait rien ici.
   Réglable par variables d'environnement : derrière un hotspot partagé,
   tous les joueurs sortent par la même IP publique et le réglage par
   défaut pourrait gêner un tournoi. */
const RATE_WINDOW_MS = (parseInt(process.env.D_AONA_AUTH_RATE_WINDOW_S || "300", 10) || 300) * 1000;
const RATE_MAX_ATTEMPTS = parseInt(process.env.D_AONA_AUTH_RATE_MAX || "12", 10) || 12;
const _rateHits = new Map();

function rateLimit(key) {
  const now = Date.now();
  const hits = (_rateHits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_ATTEMPTS) {
    _rateHits.set(key, hits);
    return { allowed: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  _rateHits.set(key, hits);
  return { allowed: true, remaining: RATE_MAX_ATTEMPTS - hits.length };
}

function _sweepRate() {
  const now = Date.now();
  for (const [k, v] of _rateHits) {
    const keep = v.filter((t) => now - t < RATE_WINDOW_MS);
    if (keep.length) _rateHits.set(k, keep); else _rateHits.delete(k);
  }
}
const _sweepTimer = setInterval(_sweepRate, 10 * 60 * 1000);
if (_sweepTimer.unref) _sweepTimer.unref();

/* ---------- Journal d'audit (ajout seul) -----------------------------
   On y consigne QUI a fait QUOI et QUAND, jamais avec quoi (aucun secret).
   `detail` est un motif court et normalisé, sans donnée saisie par
   l'utilisateur autre que le pseudo (borné). */
function audit({ event, userId = null, pseudo = null, sessionId = null, ip = null, userAgent = null, detail = null }) {
  try {
    db.prepare(
      "INSERT INTO auth_audit_log (event, user_id, pseudo, session_id, ip, user_agent, detail) VALUES (?,?,?,?,?,?,?)"
    ).run(
      String(event).slice(0, 40),
      userId,
      pseudo ? String(pseudo).slice(0, 40) : null,
      sessionId,
      ip ? String(ip).slice(0, 64) : null,
      userAgent ? String(userAgent).slice(0, 200) : null,
      detail ? String(detail).slice(0, 200) : null
    );
  } catch (_) {
    /* Le journal ne doit jamais faire échouer une connexion légitime. */
  }
}

/* ---------- Identifiants ---------------------------------------------- */
function getCredentials(userId) {
  return db.prepare("SELECT * FROM auth_credentials WHERE user_id = ?").get(userId) || null;
}

function hasPassword(userId) {
  const row = getCredentials(userId);
  return !!(row && row.password_hash);
}

/* Écrit (ou remplace) l'empreinte. Utilise une transaction : jamais de
   ligne à moitié mise à jour si l'écriture échoue. */
async function setPasswordHash(userId, password) {
  const hash = await hashPassword(password);
  db.exec("BEGIN");
  try {
    const existing = getCredentials(userId);
    if (existing) {
      db.prepare(`UPDATE auth_credentials
                  SET password_hash = ?, algo = ?, password_changed_at = ?,
                      failed_attempts = 0, locked_until = NULL, updated_at = ?
                  WHERE user_id = ?`)
        .run(hash, ALGO_LABEL, nowIso(), nowIso(), userId);
    } else {
      db.prepare(`INSERT INTO auth_credentials (user_id, password_hash, algo, password_changed_at, updated_at)
                  VALUES (?,?,?,?,?)`)
        .run(userId, hash, ALGO_LABEL, nowIso(), nowIso());
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    throw err;
  }
}

function isLocked(userId) {
  const row = getCredentials(userId);
  if (!row || !row.locked_until) return false;
  return new Date(row.locked_until).getTime() > Date.now();
}

function lockRemainingSeconds(userId) {
  const row = getCredentials(userId);
  if (!row || !row.locked_until) return 0;
  return Math.max(0, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000));
}

/* Enregistre un échec et arme le verrouillage progressif. */
function registerFailure(userId) {
  const row = getCredentials(userId);
  if (!row) return { attempts: 0, lockedUntil: null };
  const attempts = (row.failed_attempts || 0) + 1;
  const lockSec = lockDurationSeconds(attempts);
  const lockedUntil = lockSec > 0 ? plusSeconds(lockSec) : null;
  db.prepare(`UPDATE auth_credentials
              SET failed_attempts = ?, last_failed_at = ?, locked_until = ?, updated_at = ?
              WHERE user_id = ?`)
    .run(attempts, nowIso(), lockedUntil, nowIso(), userId);
  return { attempts, lockedUntil };
}

function clearFailures(userId) {
  db.prepare(`UPDATE auth_credentials
              SET failed_attempts = 0, locked_until = NULL, updated_at = ?
              WHERE user_id = ?`).run(nowIso(), userId);
}

/* ---------- Sessions --------------------------------------------------
   Le jeton est opaque (32 octets aléatoires, base64url). Seule son
   empreinte SHA-256 est stockée : la base ne contient jamais de quoi
   rejouer une session. */
function tokenHash(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function createSession(userId, { userAgent = null, ip = null } = {}) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = plusSeconds(SESSION_TTL_SECONDS);
  db.prepare(`INSERT INTO sessions
      (id, user_id, token_hash, created_at, last_used_at, expires_at, user_agent, ip)
      VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      id, userId, tokenHash(raw), nowIso(), nowIso(), expiresAt,
      userAgent ? String(userAgent).slice(0, 200) : null,
      ip ? String(ip).slice(0, 64) : null
    );
  return { token: raw, sessionId: id, expiresAt };
}

/* Résout un jeton en session valide, ou null.
   Refuse : inconnu, révoqué, expiré. Met à jour `last_used_at`, mais au
   maximum une fois par heure (évite une écriture à chaque requête). */
function resolveSession(raw, { touch = true } = {}) {
  if (typeof raw !== "string" || raw.length < 20) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash(raw));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  if (touch) {
    const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - last > LAST_USED_THROTTLE_MS) {
      db.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
    }
  }
  return { sessionId: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

function revokeSession(raw, reason = "logout") {
  const row = typeof raw === "string"
    ? db.prepare("SELECT id FROM sessions WHERE token_hash = ?").get(tokenHash(raw))
    : null;
  if (!row) return false;
  db.prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ?")
    .run(nowIso(), String(reason).slice(0, 60), row.id);
  return true;
}

/* Révoque toutes les sessions d'un compte (changement de mot de passe,
   déconnexion de tous les appareils, incident de sécurité). */
function revokeAllSessions(userId, reason = "revoke_all") {
  const info = db.prepare(
    "UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL"
  ).run(nowIso(), String(reason).slice(0, 60), userId);
  return info.changes || 0;
}

/* Purge : supprime les sessions expirées ou révoquées depuis plus de 30 jours. */
function purgeExpiredSessions() {
  const info = db.prepare(`DELETE FROM sessions
    WHERE (expires_at IS NOT NULL AND expires_at < ?)
       OR (revoked_at IS NOT NULL AND revoked_at < ?)`)
    .run(nowIso(), plusSeconds(-30 * 24 * 3600));
  return info.changes || 0;
}

function listSessions(userId) {
  return db.prepare(`SELECT id, created_at, last_used_at, expires_at, revoked_at,
                            revoked_reason, user_agent, ip
                     FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).all(userId);
}

/* ---------- Réclamation des comptes hérités --------------------------
   La base contient des comptes créés AVANT cette refonte : ils n'ont
   aucun mot de passe. Sans dispositif dédié, leurs propriétaires ne
   pourraient plus se connecter. `claim` leur permet de définir un mot de
   passe une seule fois.

   ️ Fenêtre de risque assumée : le premier arrivé peut réclamer un
   compte hérité. À DÉSACTIVER (D_AONA_ALLOW_LEGACY_CLAIM=0) avant toute
   mise en service avec de l'argent réel — c'est explicitement documenté
   dans SECURITE_AUTH.md. */
const ALLOW_LEGACY_CLAIM = process.env.D_AONA_ALLOW_LEGACY_CLAIM !== "0";

/* Message unique : ne révèle jamais si un pseudo existe (anti-énumération). */
const GENERIC_CREDENTIALS_ERROR = "Pseudo ou mot de passe incorrect.";

/* ---------- Inscription ---------------------------------------------- */
async function register({ pseudo, password, province = null, phone = null, userAgent = null, ip = null }) {
  const p = normalizePseudo(pseudo);
  if (!isValidPseudo(p)) {
    return { ok: false, status: 400, error: "Pseudo invalide : 3 à 14 caractères (lettres, chiffres, . _ -)." };
  }
  const check = validatePassword(password);
  if (!check.ok) return { ok: false, status: 400, error: check.error, missing: check.missing };
  if (User.getByPseudo(p)) return { ok: false, status: 409, error: "Ce pseudo est déjà pris." };

  // Le hachage (volontairement lent) est calculé AVANT la transaction :
  // une transaction SQLite ne doit pas rester ouverte pendant un calcul async.
  const hash = await hashPassword(password);

  let userId = null;
  db.exec("BEGIN");
  try {
    const info = db.prepare(
      "INSERT INTO users (pseudo, elo, balance, province, phone, last_seen) VALUES (?, 1100, 5000, ?, ?, ?)"
    ).run(p, province ? String(province).slice(0, 40) : "Antananarivo", phone ? String(phone).slice(0, 24) : null, nowIso());
    userId = Number(info.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO equipped_skins (user_id, pions, plateau, effet) VALUES (?, 'pions-classique', NULL, NULL)").run(userId);
    db.prepare("INSERT OR IGNORE INTO user_skins (user_id, skin_id) VALUES (?, 'pions-classique')").run(userId);
    db.prepare(`INSERT INTO auth_credentials (user_id, password_hash, algo, password_changed_at, updated_at)
                VALUES (?,?,?,?,?)`).run(userId, hash, ALGO_LABEL, nowIso(), nowIso());
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    // Course sur le pseudo : la contrainte UNIQUE de `users.pseudo` tranche.
    if (/UNIQUE/i.test(err.message)) return { ok: false, status: 409, error: "Ce pseudo est déjà pris." };
    throw err;
  }

  const session = createSession(userId, { userAgent, ip });
  audit({ event: "register", userId, pseudo: p, sessionId: session.sessionId, ip, userAgent });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, user: User.getById(userId), newUser: true };
}

/* ---------- Réclamation d'un compte hérité --------------------------- */
async function claim({ pseudo, password, userAgent = null, ip = null }) {
  if (!ALLOW_LEGACY_CLAIM) {
    return { ok: false, status: 403, error: "La définition du mot de passe pour un compte ancien est désactivée." };
  }
  const p = normalizePseudo(pseudo);
  const check = validatePassword(password);
  if (!check.ok) return { ok: false, status: 400, error: check.error, missing: check.missing };

  const user = User.getByPseudo(p);
  // Même réponse que le compte existe ou non, et qu'il ait déjà un mot de passe
  // ou non : impossible d'énumérer les comptes par cette route.
  const failure = { ok: false, status: 409, error: "Pseudo inconnu, ou mot de passe déjà défini pour ce compte." };
  if (!user) { audit({ event: "claim", pseudo: p, ip, userAgent, detail: "pseudo inconnu" }); return failure; }
  if (hasPassword(user.id)) { audit({ event: "claim", userId: user.id, pseudo: p, ip, userAgent, detail: "mot de passe déjà défini" }); return failure; }

  await setPasswordHash(user.id, password);
  const session = createSession(user.id, { userAgent, ip });
  audit({ event: "claim", userId: user.id, pseudo: p, sessionId: session.sessionId, ip, userAgent });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, user: User.getById(user.id) };
}

/* ---------- Connexion -------------------------------------------------
   Anti-énumération : un pseudo inconnu, un compte sans mot de passe et un
   mauvais mot de passe renvoient tous le MÊME message et le même code 401. */
async function login({ pseudo, password, userAgent = null, ip = null }) {
  const p = normalizePseudo(pseudo);
  if (!p || typeof password !== "string" || !password) {
    return { ok: false, status: 400, error: GENERIC_CREDENTIALS_ERROR };
  }
  /* Refus AVANT tout hachage : sans cette borne, un appelant peut envoyer
     1 Mo de mot de passe et utiliser Argon2 comme amplificateur de charge. */
  if (password.length > PWD_MAX) {
    audit({ event: "login_fail", pseudo: p, ip, userAgent, detail: "mot de passe hors borne" });
    return { ok: false, status: 400, error: GENERIC_CREDENTIALS_ERROR };
  }

  const user = User.getByPseudo(p);
  if (!user) {
    await verifyPassword(await dummyHash(), password);      // coût comparable → pas de fuite par chronométrage
    audit({ event: "login_fail", pseudo: p, ip, userAgent, detail: "pseudo inconnu" });
    return { ok: false, status: 401, error: GENERIC_CREDENTIALS_ERROR };
  }

  const creds = getCredentials(user.id);
  if (!creds) {
    await verifyPassword(await dummyHash(), password);
    audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: "compte sans mot de passe" });
    return { ok: false, status: 401, error: GENERIC_CREDENTIALS_ERROR };
  }

  if (isLocked(user.id)) {
    const sec = lockRemainingSeconds(user.id);
    audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: "compte verrouillé" });
    return {
      ok: false, status: 429,
      error: `Compte temporairement verrouillé après trop d'échecs. Réessayez dans ${Math.ceil(sec / 60)} min.`,
    };
  }

  const valid = await verifyPassword(creds.password_hash, password);
  if (!valid) {
    const { attempts, lockedUntil } = registerFailure(user.id);
    audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: `échec n°${attempts}` });
    if (lockedUntil) {
      audit({ event: "locked", userId: user.id, pseudo: p, ip, userAgent, detail: `verrouillé jusqu'à ${lockedUntil}` });
      return { ok: false, status: 429, error: "Trop d'échecs : compte verrouillé temporairement." };
    }
    return { ok: false, status: 401, error: GENERIC_CREDENTIALS_ERROR };
  }

  clearFailures(user.id);
  const session = createSession(user.id, { userAgent, ip });
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(nowIso(), user.id);
  audit({ event: "login_ok", userId: user.id, pseudo: p, sessionId: session.sessionId, ip, userAgent });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, user: User.getById(user.id) };
}

/* ---------- Déconnexion (révocation de la session courante) ---------- */
function logout(rawToken, { userId = null, ip = null, userAgent = null } = {}) {
  const ok = revokeSession(rawToken, "logout");
  audit({ event: "logout", userId, ip, userAgent, detail: ok ? "session révoquée" : "jeton inconnu" });
  return ok;
}

/* ---------- Changement de mot de passe --------------------------------
   Vérifie l'ancien mot de passe, écrit le nouveau, puis révoque toutes les
   AUTRES sessions : si le changement fait suite à un soupçon de
   compromission, les sessions ouvertes ailleurs doivent tomber. */
async function changePassword(userId, currentPassword, newPassword, { userAgent = null, ip = null } = {}) {
  const creds = getCredentials(userId);
  if (!creds) return { ok: false, status: 409, error: "Ce compte n'a pas encore de mot de passe." };

  if (typeof currentPassword !== "string" || !(await verifyPassword(creds.password_hash, currentPassword))) {
    audit({ event: "password_change", userId, ip, userAgent, detail: "ancien mot de passe incorrect" });
    return { ok: false, status: 401, error: "Mot de passe actuel incorrect." };
  }
  const check = validatePassword(newPassword);
  if (!check.ok) return { ok: false, status: 400, error: check.error, missing: check.missing };

  await setPasswordHash(userId, newPassword);
  const revoked = revokeAllSessions(userId, "password_change");
  audit({ event: "password_change", userId, ip, userAgent, detail: `${revoked} session(s) révoquée(s)` });
  return { ok: true, revokedSessions: revoked };
}

module.exports = {
  /* hachage / politique */
  hashPassword, verifyPassword, validatePassword, PWD_RULES, PWD_MAX, ARGON_OPTIONS, ALGO_LABEL,
  /* pseudos */
  normalizePseudo, isValidPseudo,
  /* sessions */
  createSession, resolveSession, revokeSession, revokeAllSessions, purgeExpiredSessions, listSessions,
  /* identifiants */
  getCredentials, hasPassword, setPasswordHash, isLocked, lockRemainingSeconds,
  /* flux */
  register, login, claim, logout, changePassword,
  /* audit + limitation */
  audit, rateLimit, RATE_MAX_ATTEMPTS, RATE_WINDOW_MS,
  /* divers */
  ALLOW_LEGACY_CLAIM, GENERIC_CREDENTIALS_ERROR,
};