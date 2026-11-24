/* =========================================================
   D-aôna (Vercel + Supabase) — Authentification & sessions PostgreSQL
   ========================================================= */
"use strict";

const crypto = require("node:crypto");
const { query, one, tx } = require("./db");
const { User, Skins, Sanction } = require("./stores");

let argon2 = null;
try { argon2 = require("@node-rs/argon2"); } catch (_) { argon2 = null; }

const ARGON_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
const PWD_MAX = 128;
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
  if (argon2) return argon2.hash(String(pwd), ARGON_OPTIONS);
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = crypto.scryptSync(String(pwd), salt, 32).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

async function verifyPassword(hash, pwd) {
  if (!hash) return false;
  try {
    const s = String(hash);
    if (s.startsWith("scrypt$")) {
      const [, salt, hex] = s.split("$");
      if (!salt || !hex) return false;
      const dk = crypto.scryptSync(String(pwd), salt, 32);
      const target = Buffer.from(hex, "hex");
      return dk.length === target.length && crypto.timingSafeEqual(dk, target);
    }
    if (argon2) return await argon2.verify(s, String(pwd));
    return false;
  } catch (_) {
    return false;
  }
}

let _dummyHash = null;
async function dummyHash() {
  if (!_dummyHash) _dummyHash = await hashPassword(crypto.randomBytes(18).toString("hex"));
  return _dummyHash;
}

function normalizePseudo(p) {
  return String(p == null ? "" : p).trim().slice(0, 14).replace(/<[^>]*>/g, "");
}

function isValidPseudo(p) {
  return typeof p === "string" && p.length >= 3 && /^[A-Za-z0-9_.\- ]+$/.test(p);
}

const nowIso = () => new Date().toISOString();
const plusSeconds = (s) => new Date(Date.now() + s * 1000).toISOString();
const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const LAST_USED_THROTTLE_MS = 3600 * 1000;
const LOCK_THRESHOLD = 5;
const LOCK_BASE_SECONDS = 60;
const LOCK_MAX_SECONDS = 3600;

function lockDurationSeconds(failedAttempts) {
  if (failedAttempts < LOCK_THRESHOLD) return 0;
  return Math.min(LOCK_MAX_SECONDS, LOCK_BASE_SECONDS * Math.pow(2, failedAttempts - LOCK_THRESHOLD));
}

const RATE_WINDOW_MS = (parseInt(process.env.D_AONA_AUTH_RATE_WINDOW_S || "300", 10) || 300) * 1000;
const RATE_MAX_ATTEMPTS = parseInt(process.env.D_AONA_AUTH_RATE_MAX || "20", 10) || 20;
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

async function audit({ event, userId = null, pseudo = null, sessionId = null, ip = null, userAgent = null, detail = null }) {
  try {
    await query(
      "INSERT INTO auth_audit_log (event, user_id, pseudo, session_id, ip, user_agent, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        String(event).slice(0, 40),
        userId,
        pseudo ? String(pseudo).slice(0, 40) : null,
        sessionId,
        ip ? String(ip).slice(0, 64) : null,
        userAgent ? String(userAgent).slice(0, 200) : null,
        detail ? String(detail).slice(0, 200) : null,
      ]
    );
  } catch (_) {}
}

function tokenHash(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

async function createSession(userId, { userAgent = null, ip = null } = {}) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = plusSeconds(SESSION_TTL_SECONDS);
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_used_at, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id, userId, tokenHash(raw), nowIso(), nowIso(), expiresAt,
      userAgent ? String(userAgent).slice(0, 200) : null,
      ip ? String(ip).slice(0, 64) : null,
    ]
  );
  return { token: raw, sessionId: id, expiresAt };
}

async function resolveSession(raw, { touch = true } = {}) {
  if (typeof raw !== "string" || raw.length < 20) return null;
  const row = await one("SELECT * FROM sessions WHERE token_hash = $1", [tokenHash(raw)]);
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (touch) {
    const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - last > LAST_USED_THROTTLE_MS) {
      await query("UPDATE sessions SET last_used_at = $1 WHERE id = $2", [nowIso(), row.id]);
    }
  }
  return { sessionId: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

async function revokeSession(raw, reason = "logout") {
  if (typeof raw !== "string") return false;
  const row = await one("SELECT id FROM sessions WHERE token_hash = $1", [tokenHash(raw)]);
  if (!row) return false;
  await query("UPDATE sessions SET revoked_at = $1, revoked_reason = $2 WHERE id = $3", [nowIso(), String(reason).slice(0, 60), row.id]);
  return true;
}

async function revokeAllSessions(userId, reason = "revoke_all") {
  const r = await query(
    "UPDATE sessions SET revoked_at = $1, revoked_reason = $2 WHERE user_id = $3 AND revoked_at IS NULL",
    [nowIso(), String(reason).slice(0, 60), userId]
  );
  return r.rowCount || 0;
}

const GENERIC_CREDENTIALS_ERROR = "Pseudo ou mot de passe incorrect.";

async function register({ pseudo, password, province = null, phone = null, email = null, userAgent = null, ip = null }) {
  const p = normalizePseudo(pseudo);
  if (!isValidPseudo(p)) {
    await audit({ event: "register_fail", pseudo: p, ip, userAgent, detail: "pseudo invalide" });
    return { ok: false, status: 400, error: "Pseudo invalide : 3 à 14 caractères (lettres, chiffres, . _ -)." };
  }
  const check = validatePassword(password);
  if (!check.ok) return { ok: false, status: 400, error: check.error, missing: check.missing };

  if (await User.getByPseudo(p)) {
    await audit({ event: "register_fail", pseudo: p, ip, userAgent, detail: "pseudo déjà pris" });
    return { ok: false, status: 409, error: "Ce pseudo est déjà pris." };
  }

  const cleanEmail = email ? String(email).trim().slice(0, 120).toLowerCase() : null;
  const cleanPhone = phone ? String(phone).trim().slice(0, 24) : null;
  if (cleanEmail || cleanPhone) {
    const already = await one(
      "SELECT id FROM users WHERE ($1::text IS NOT NULL AND $1 <> '' AND email = $1) OR ($2::text IS NOT NULL AND $2 <> '' AND phone = $2) LIMIT 1",
      [cleanEmail, cleanPhone]
    );
    if (already) {
      await audit({ event: "register_fail", userId: already.id, pseudo: p, ip, userAgent, detail: "email ou téléphone déjà utilisé" });
      return { ok: false, status: 409, error: "Email ou téléphone déjà utilisés." };
    }
  }

  const hash = await hashPassword(password);
  const algo = hash.startsWith("scrypt$") ? "scrypt" : "argon2id";
  let userId = null;

  try {
    userId = await tx(async (c) => {
      const ins = await c.one(
        `INSERT INTO users (pseudo, elo, balance, province, phone, email, last_seen, bonus_used, bonus_lock)
         VALUES ($1, 1100, 1000, $2, $3, $4, $5, 1, 1000) RETURNING id`,
        [p, province ? String(province).slice(0, 40) : "Antananarivo", cleanPhone, cleanEmail, nowIso()]
      );
      const uid = ins.id;
      await c.query(
        "INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES ($1,'in','Bonus de bienvenue',1000,NULL,NULL)",
        [uid]
      );
      await c.query(
        "INSERT INTO equipped_skins (user_id, pions_light, pions_dark, plateau, effet) VALUES ($1, 'pions-clair-classique', 'pions-sombre-classique', NULL, NULL) ON CONFLICT DO NOTHING",
        [uid]
      );
      await c.query("INSERT INTO user_skins (user_id, skin_id) VALUES ($1, 'pions-clair-classique'), ($1, 'pions-sombre-classique') ON CONFLICT DO NOTHING", [uid]);
      await c.query(
        "INSERT INTO pion_style (user_id, camp, color, pattern, shape) VALUES ($1, 'light', 'blanc', 'aucun', 'ronde'), ($1, 'dark', 'noir', 'aucun', 'ronde') ON CONFLICT DO NOTHING",
        [uid]
      );
      await c.query(
        "INSERT INTO auth_credentials (user_id, password_hash, algo, password_changed_at, updated_at) VALUES ($1,$2,$3,$4,$5)",
        [uid, hash, algo, nowIso(), nowIso()]
      );
      return uid;
    });
  } catch (err) {
    if (err && err.code === "23505") {
      const cName = String(err.constraint || err.message || "");
      if (/phone|email/i.test(cName)) return { ok: false, status: 409, error: "Email ou téléphone déjà utilisés." };
      return { ok: false, status: 409, error: "Ce pseudo est déjà pris." };
    }
    throw err;
  }

  const session = await createSession(userId, { userAgent, ip });
  await audit({ event: "register", userId, pseudo: p, sessionId: session.sessionId, ip, userAgent });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, user: await User.getById(userId), newUser: true };
}

async function login({ pseudo, password, userAgent = null, ip = null }) {
  const p = normalizePseudo(pseudo);
  if (!p || typeof password !== "string" || !password) {
    return { ok: false, status: 400, error: GENERIC_CREDENTIALS_ERROR };
  }
  if (password.length > PWD_MAX) {
    await audit({ event: "login_fail", pseudo: p, ip, userAgent, detail: "mot de passe hors borne" });
    return { ok: false, status: 400, error: GENERIC_CREDENTIALS_ERROR };
  }

  const user = await User.getByPseudo(p);
  if (!user) {
    await verifyPassword(await dummyHash(), password);
    await audit({ event: "login_fail", pseudo: p, ip, userAgent, detail: "pseudo inconnu" });
    return { ok: false, status: 401, error: GENERIC_CREDENTIALS_ERROR };
  }

  const creds = await one("SELECT * FROM auth_credentials WHERE user_id = $1", [user.id]);
  if (!creds) {
    await verifyPassword(await dummyHash(), password);
    await audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: "compte sans mot de passe" });
    return { ok: false, status: 401, error: GENERIC_CREDENTIALS_ERROR };
  }

  if (creds.locked_until && new Date(creds.locked_until).getTime() > Date.now()) {
    const sec = Math.ceil((new Date(creds.locked_until).getTime() - Date.now()) / 1000);
    await audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: "compte verrouillé" });
    return { ok: false, status: 429, error: `Compte verrouillé — réessayez dans ${Math.ceil(sec / 60)} min.` };
  }

  const valid = await verifyPassword(creds.password_hash, password);
  if (!valid) {
    const attempts = (creds.failed_attempts || 0) + 1;
    const lockSec = lockDurationSeconds(attempts);
    const lockedUntil = lockSec > 0 ? plusSeconds(lockSec) : null;
    await query(
      "UPDATE auth_credentials SET failed_attempts = $1, last_failed_at = $2, locked_until = $3, updated_at = $4 WHERE user_id = $5",
      [attempts, nowIso(), lockedUntil, nowIso(), user.id]
    );
    await audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: `échec n°${attempts}` });
    if (lockedUntil) {
      await audit({ event: "locked", userId: user.id, pseudo: p, ip, userAgent, detail: `verrouillé jusqu'à ${lockedUntil}` });
      return { ok: false, status: 429, error: "Trop d'échecs : compte verrouillé temporairement." };
    }
    return { ok: false, status: 401, error: GENERIC_CREDENTIALS_ERROR };
  }

  await query("UPDATE auth_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = $1 WHERE user_id = $2", [nowIso(), user.id]);

  if (await Sanction.isBlocked(user.id)) {
    await audit({ event: "login_fail", userId: user.id, pseudo: p, ip, userAgent, detail: "compte suspendu" });
    return { ok: false, status: 403, code: "COMPTE_SUSPENDU", error: "Compte suspendu — contactez le support." };
  }

  const session = await createSession(user.id, { userAgent, ip });
  await query("UPDATE users SET last_seen = $1 WHERE id = $2", [nowIso(), user.id]);
  await audit({ event: "login_ok", userId: user.id, pseudo: p, sessionId: session.sessionId, ip, userAgent });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, user: await User.getById(user.id) };
}

async function logout(rawToken, { userId = null, ip = null, userAgent = null } = {}) {
  const ok = await revokeSession(rawToken, "logout");
  await audit({ event: "logout", userId, ip, userAgent, detail: ok ? "session révoquée" : "jeton inconnu" });
  return ok;
}

async function changePassword(userId, currentPassword, newPassword, { userAgent = null, ip = null } = {}) {
  const creds = await one("SELECT * FROM auth_credentials WHERE user_id = $1", [userId]);
  if (!creds) return { ok: false, status: 409, error: "Ce compte n'a pas encore de mot de passe." };
  if (typeof currentPassword !== "string" || !(await verifyPassword(creds.password_hash, currentPassword))) {
    await audit({ event: "password_change", userId, ip, userAgent, detail: "ancien mot de passe incorrect" });
    return { ok: false, status: 401, error: "Mot de passe actuel incorrect." };
  }
  const check = validatePassword(newPassword);
  if (!check.ok) return { ok: false, status: 400, error: check.error, missing: check.missing };
  const hash = await hashPassword(newPassword);
  const algo = hash.startsWith("scrypt$") ? "scrypt" : "argon2id";
  await query(
    "UPDATE auth_credentials SET password_hash = $1, algo = $2, password_changed_at = $3, failed_attempts = 0, locked_until = NULL, updated_at = $4 WHERE user_id = $5",
    [hash, algo, nowIso(), nowIso(), userId]
  );
  const revoked = await revokeAllSessions(userId, "password_change");
  await audit({ event: "password_change", userId, ip, userAgent, detail: `${revoked} session(s) révoquée(s)` });
  return { ok: true, revokedSessions: revoked };
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePassword,
  normalizePseudo,
  isValidPseudo,
  createSession,
  resolveSession,
  revokeSession,
  revokeAllSessions,
  register,
  login,
  logout,
  changePassword,
  audit,
  rateLimit,
};
