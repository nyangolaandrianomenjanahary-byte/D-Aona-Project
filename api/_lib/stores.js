/* =========================================================
   D-aôna (Vercel + Supabase) — Magasins PostgreSQL asynchrones
   ========================================================= */
"use strict";

const crypto = require("node:crypto");
const { query, one, all, tx } = require("./db");
const DATA = require("../../d-aona-server/data");
const { imageMagicOk, detectImageExt } = require("../../d-aona-server/image");

const nowIso = () => new Date().toISOString();
const nowSqlUtc = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function toIsoUtc(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "number") return new Date(raw).toISOString();
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return s.replace(" ", "T") + "Z";
  return s;
}

/* ---------- Settings ---------- */
const Settings = {
  async all() {
    const rows = await all("SELECT key, value, updated_at FROM platform_settings");
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      revision: parseInt(map.revision || "0", 10) || 0,
      platformName: map.platform_name || "D-aôna",
      registrationsOpen: map.registrations_open !== "false",
      maintenanceMode: map.maintenance_mode === "true",
      kycFaceRequired: map.kyc_face_required === "true",
    };
  },
  async setting(key) {
    const r = await one("SELECT value FROM platform_settings WHERE key = $1", [key]);
    if (!r) {
      if (key === "registrations_open") return true;
      if (key === "maintenance_mode" || key === "kyc_face_required") return false;
      return null;
    }
    if (r.value === "true") return true;
    if (r.value === "false") return false;
    return r.value;
  },
};

/* ---------- Badges ---------- */
const Badges = {
  async list() {
    const rows = await all("SELECT name, icon, color, ink, min_rank, max_rank FROM badges ORDER BY min_rank ASC");
    if (!rows.length) return DATA.BADGES;
    return rows.map((r) => ({
      name: r.name,
      icon: r.icon,
      color: r.color,
      ink: r.ink,
      min: r.min_rank,
      max: r.max_rank == null ? Infinity : r.max_rank,
    }));
  },
  async forRank(rank) {
    const list = await this.list();
    return list.find((b) => rank >= b.min && rank <= b.max) || list[list.length - 1];
  },
};

/* ---------- Skins & PionStyle ---------- */
const EQUIPPED_SLOTS = Object.freeze(["pions_light", "pions_dark", "plateau", "effet"]);
const FREE_SKINS = Object.freeze(["pions-clair-classique", "pions-sombre-classique"]);
const DEFAULT_EQUIPPED = Object.freeze({
  pions_light: "pions-clair-classique",
  pions_dark: "pions-sombre-classique",
  plateau: null,
  effet: null,
});

const PionStyle = {
  CAMPS: DATA.PION_CAMPS,
  DEFAULTS: DATA.PION_DEFAULTS,
  async ensureDefaults(userId) {
    for (const c of DATA.PION_CAMPS) {
      const d = DATA.PION_DEFAULTS[c.id];
      await query(
        `INSERT INTO pion_style (user_id, camp, color, pattern, shape)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, camp) DO NOTHING`,
        [userId, c.id, d.color, d.pattern, d.shape]
      );
    }
  },
  async get(userId) {
    const out = {};
    for (const c of DATA.PION_CAMPS) out[c.id] = { ...DATA.PION_DEFAULTS[c.id] };
    if (!userId) return out;
    const rows = await all("SELECT camp, color, pattern, shape FROM pion_style WHERE user_id = $1", [userId]);
    for (const r of rows) {
      if (out[r.camp]) {
        out[r.camp] = {
          shape: r.shape || DATA.PION_DEFAULTS[r.camp].shape,
          color: r.color,
          pattern: r.pattern,
        };
      }
    }
    return out;
  },
  async set(userId, camp, color, pattern, shape) {
    const cur = await one("SELECT shape FROM pion_style WHERE user_id = $1 AND camp = $2", [userId, camp]);
    const sh = shape || (cur && cur.shape) || DATA.PION_DEFAULTS[camp].shape;
    await query(
      `INSERT INTO pion_style (user_id, camp, color, pattern, shape) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, camp) DO UPDATE SET color = EXCLUDED.color, pattern = EXCLUDED.pattern, shape = EXCLUDED.shape`,
      [userId, camp, color, pattern, sh]
    );
    return { ok: true, camp, style: { shape: sh, color, pattern } };
  },
};

const Skins = {
  FREE_SKINS,
  DEFAULT_EQUIPPED,
  async ensureDefaults(userId) {
    await query(
      `INSERT INTO equipped_skins (user_id, pions_light, pions_dark, plateau, effet)
       VALUES ($1, $2, $3, NULL, NULL) ON CONFLICT (user_id) DO NOTHING`,
      [userId, DEFAULT_EQUIPPED.pions_light, DEFAULT_EQUIPPED.pions_dark]
    );
    for (const id of FREE_SKINS) {
      await query(
        "INSERT INTO user_skins (user_id, skin_id) VALUES ($1, $2) ON CONFLICT (user_id, skin_id) DO NOTHING",
        [userId, id]
      );
    }
    await PionStyle.ensureDefaults(userId);
  },
  async listOwned(userId) {
    const rows = await all("SELECT skin_id FROM user_skins WHERE user_id = $1", [userId]);
    return rows.map((r) => r.skin_id);
  },
  async getEquipped(userId) {
    const row = await one("SELECT pions_light, pions_dark, plateau, effet FROM equipped_skins WHERE user_id = $1", [userId]);
    return row
      ? { pions_light: row.pions_light, pions_dark: row.pions_dark, plateau: row.plateau, effet: row.effet }
      : { ...DEFAULT_EQUIPPED };
  },
  async buy(userId, skinId, price) {
    const owned = await this.listOwned(userId);
    if (owned.includes(skinId)) return { ok: false, error: "Deja possede" };
    await query("INSERT INTO user_skins (user_id, skin_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, skinId]);
    return { ok: true, price };
  },
  async equip(userId, slot, skinId) {
    if (!EQUIPPED_SLOTS.includes(slot)) return { ok: false, error: "Emplacement de skin inconnu" };
    await query(`UPDATE equipped_skins SET ${slot} = $1 WHERE user_id = $2`, [skinId, userId]);
    return { ok: true, slot };
  },
};

/* ---------- Users ---------- */
const USER_UPDATABLE = new Set([
  "phone", "email", "province", "avatar", "first_name", "last_name", "birth_date", "bio",
  "last_seen", "elo", "wins", "losses", "kyc", "friends_seen_request_id",
]);

const User = {
  async getById(id) {
    const row = await one("SELECT * FROM users WHERE id = $1", [id]);
    if (!row) return null;
    return { ...row, kyc: !!row.kyc, bonus_used: !!row.bonus_used };
  },
  async getByPseudo(pseudo) {
    const row = await one("SELECT * FROM users WHERE pseudo = $1", [pseudo]);
    if (!row) return null;
    return { ...row, kyc: !!row.kyc, bonus_used: !!row.bonus_used };
  },
  async getByEmail(email) {
    const clean = String(email || "").trim();
    if (!clean) return null;
    const row = await one("SELECT * FROM users WHERE lower(email) = lower($1)", [clean]);
    if (!row) return null;
    return { ...row, kyc: !!row.kyc, bonus_used: !!row.bonus_used };
  },
  async update(id, fields) {
    const keys = Object.keys(fields).filter((k) => USER_UPDATABLE.has(k));
    if (!keys.length || !id) return;
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const vals = [...keys.map((k) => (typeof fields[k] === "boolean" ? (fields[k] ? 1 : 0) : fields[k])), id];
    await query(`UPDATE users SET ${sets} WHERE id = $${keys.length + 1}`, vals);
  },
  async listAll() {
    return all("SELECT id, pseudo, elo, wins, losses, province, avatar, last_seen, last_decay FROM users ORDER BY elo DESC, id ASC");
  },
};

/* ---------- Wallet & Finance ---------- */
const WELCOME_BONUS = 1000;
const OPENING_BALANCE = 5000;
const DAILY_CAP = 500000;
const MIN_WITHDRAW = 1000;
const WITHDRAW_METHODS = ["MVola", "Orange Money", "Airtel Money", "Bankily"];

function normMethod(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return WITHDRAW_METHODS[0];
  return WITHDRAW_METHODS.find((m) => m.toLowerCase() === s.toLowerCase()) || WITHDRAW_METHODS[0];
}

const Wallet = {
  async getBalance(userId) {
    const row = await one("SELECT balance, bonus_lock FROM users WHERE id = $1", [userId]);
    return row ? { balance: row.balance, bonus_lock: row.bonus_lock } : null;
  },
  async addTransaction(userId, dir, label, amount, status = null, refId = null) {
    await tx(async (c) => {
      await c.query(
        "INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [userId, dir, label, amount, status, refId || null]
      );
      if (dir === "in") await c.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, userId]);
      else await c.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, userId]);
    });
  },
  async credit(userId, amount, label, locked = false) {
    await tx(async (c) => {
      if (locked) await c.query("UPDATE users SET bonus_lock = bonus_lock + $1 WHERE id = $2", [amount, userId]);
      await c.query(
        "INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES ($1,'in',$2,$3,NULL,NULL)",
        [userId, label, amount]
      );
      await c.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, userId]);
    });
  },
  async opening(userId) {
    await this.credit(userId, OPENING_BALANCE, `Solde d'ouverture · ${OPENING_BALANCE} Ar offerts`);
  },
  async grantWelcome(userId) {
    const ok = await tx(async (c) => {
      const r = await c.query("UPDATE users SET bonus_used = 1 WHERE id = $1 AND bonus_used = 0 RETURNING id", [userId]);
      if (!r.rows.length) return false;
      await c.query("UPDATE users SET bonus_lock = bonus_lock + $1, balance = balance + $1 WHERE id = $2", [WELCOME_BONUS, userId]);
      await c.query(
        "INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES ($1,'in','Bonus de bienvenue',$2,NULL,NULL)",
        [userId, WELCOME_BONUS]
      );
      return true;
    });
    return ok;
  },
  async spend(userId, amount, label) {
    await tx(async (c) => {
      const bal = await c.one("SELECT balance, bonus_lock FROM users WHERE id = $1 FOR UPDATE", [userId]);
      if (!bal) return;
      const fromBonus = Math.min(bal.bonus_lock || 0, amount);
      await c.query("UPDATE users SET bonus_lock = bonus_lock - $1, balance = balance - $2 WHERE id = $3", [fromBonus, amount, userId]);
      await c.query(
        "INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES ($1,'out',$2,$3,NULL,NULL)",
        [userId, label, amount]
      );
    });
  },
  async spendWithdrawable(userId, amount, label, refId = null) {
    return tx(async (c) => {
      const bal = await c.one("SELECT balance, bonus_lock FROM users WHERE id = $1 FOR UPDATE", [userId]);
      if (!bal || amount > bal.balance - bal.bonus_lock) return false;
      await c.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, userId]);
      await c.query(
        "INSERT INTO transactions (user_id, dir, label, amount, status, ref_id) VALUES ($1,'out',$2,$3,NULL,$4)",
        [userId, label, amount, refId || null]
      );
      return true;
    });
  },
  async getTransactions(userId, limit = 50) {
    return all("SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [userId, limit]);
  },
  async withdrawnToday(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const req = await one(
      "SELECT COALESCE(SUM(amount), 0)::int AS s FROM withdrawals WHERE user_id = $1 AND status IN ('pending','approved','paid') AND substr(created_at, 1, 10) = $2",
      [userId, today]
    );
    const led = await one(
      "SELECT COALESCE(SUM(amount), 0)::int AS s FROM transactions WHERE user_id = $1 AND dir = 'out' AND label LIKE 'Retrait%' AND substr(created_at, 1, 10) = $2 AND (ref_id IS NULL OR ref_id NOT LIKE 'withdrawal:%')",
      [userId, today]
    );
    return (req ? req.s : 0) + (led ? led.s : 0);
  },
  async history(userId, opts = {}) {
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    let size = opts.size === "all" ? 0 : parseInt(opts.size, 10);
    if (!Number.isFinite(size) || size < 0) size = 50;
    const sort = opts.sort === "asc" ? "ASC" : "DESC";
    const period = opts.period || "all";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(opts.from || "") ? opts.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(opts.to || "") ? opts.to : null;
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19).replace("T", " ");

    let sql = "SELECT * FROM transactions WHERE user_id = $1";
    const args = [userId];
    let idx = 2;
    if (from) { sql += ` AND substr(created_at, 1, 10) >= $${idx++}`; args.push(from); }
    if (to) { sql += ` AND substr(created_at, 1, 10) <= $${idx++}`; args.push(to); }
    if (!from && !to && period === "recent") { sql += ` AND created_at >= $${idx++}`; args.push(cutoff30); }
    if (!from && !to && period === "old") { sql += ` AND created_at < $${idx++}`; args.push(cutoff30); }
    const status = opts.status || "all";
    if (status === "pending") sql += " AND status = 'pending'";
    else if (status === "success") sql += " AND (status IS NULL OR status = '' OR status = 'success')";
    sql += ` ORDER BY created_at ${sort}, id ${sort}`;

    let rows = await all(sql, args);
    if (status !== "success") {
      let wSql = "SELECT id, amount, method, status, created_at FROM withdrawals WHERE user_id = $1 AND status IN ('pending', 'approved')";
      const wArgs = [userId];
      let wIdx = 2;
      if (from) { wSql += ` AND substr(created_at, 1, 10) >= $${wIdx++}`; wArgs.push(from); }
      if (to) { wSql += ` AND substr(created_at, 1, 10) <= $${wIdx++}`; wArgs.push(to); }
      if (!from && !to && period === "recent") { wSql += ` AND created_at >= $${wIdx++}`; wArgs.push(cutoff30); }
      if (!from && !to && period === "old") { wSql += ` AND created_at < $${wIdx++}`; wArgs.push(cutoff30); }
      const demandes = (await all(wSql, wArgs)).map((w) => ({
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
      items: slice.map((r) => {
        const { _sortId, ...rest } = r;
        return { ...rest, kind: DATA.txKind(r.label), method: DATA.txMethod(r.label) };
      }),
      total, page, size: size > 0 ? size : total,
    };
  },
};

const Finance = {
  METHODS: WITHDRAW_METHODS,
  DAILY_CAP,
  MIN_AMOUNT: MIN_WITHDRAW,
  shape(r) {
    if (!r) return null;
    return {
      id: r.id, userId: r.user_id, pseudo: r.pseudo || null,
      amount: r.amount, method: r.method, phone: r.phone, status: r.status,
      reference: r.reference, reason: r.reason,
      createdAt: r.created_at, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by,
      paidAt: r.paid_at, paidBy: r.paid_by,
    };
  },
  async reserved(userId) {
    const bal = (await Wallet.getBalance(userId)) || { balance: 0, bonus_lock: 0 };
    const row = await one(
      "SELECT COALESCE(SUM(amount), 0)::int AS s FROM withdrawals WHERE user_id = $1 AND status IN ('pending', 'approved')",
      [userId]
    );
    const pending = row ? row.s : 0;
    return { bonus: bal.bonus_lock || 0, pending, total: (bal.bonus_lock || 0) + pending };
  },
  async balanceOf(userId) {
    const bal = (await Wallet.getBalance(userId)) || { balance: 0, bonus_lock: 0 };
    const r = await this.reserved(userId);
    return {
      balance: bal.balance || 0,
      bonusLock: bal.bonus_lock || 0,
      reserved: r.total,
      withdrawable: Math.max(0, (bal.balance || 0) - r.total),
    };
  },
  async openRequest(userId) {
    const row = await one(
      `SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id
       WHERE w.user_id = $1 AND w.status IN ('pending', 'approved') ORDER BY w.id DESC LIMIT 1`,
      [userId]
    );
    return this.shape(row);
  },
  async create(userId, body = {}) {
    const user = await User.getById(userId);
    if (!user) return { ok: false, status: 404, code: "INCONNU", error: "Utilisateur introuvable" };
    if (!user.kyc) return { ok: false, status: 403, code: "KYC_REQUIS", error: "KYC requis avant tout retrait" };
    const amount = parseInt(body.amount, 10);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
      return { ok: false, status: 400, code: "MONTANT_INVALIDE", error: `Montant minimum ${MIN_WITHDRAW.toLocaleString("fr-FR")} Ar` };
    }
    const b = await this.balanceOf(userId);
    if (amount > b.withdrawable) {
      return { ok: false, status: 400, code: "SOLDE_INSUFFISANT", error: "Solde disponible insuffisant (bonus et retraits en cours exclus)" };
    }
    const today = await Wallet.withdrawnToday(userId);
    if (today + amount > DAILY_CAP) {
      return { ok: false, status: 400, code: "PLAFOND_ATTEINT", error: `Plafond journalier de ${DAILY_CAP.toLocaleString("fr-FR")} Ar dépassé` };
    }
    const method = normMethod(body.method);
    const phone = body.phone ? String(body.phone).trim().slice(0, 40) : (user.phone || null);
    const inserted = await one(
      `INSERT INTO withdrawals (user_id, amount, method, phone, status) VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [userId, amount, method, phone]
    );
    const reqRow = await one(
      "SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = $1",
      [inserted.id]
    );
    await Notification.create(userId, "retrait_demande", {
      text: `Demande de retrait de ${amount.toLocaleString("fr-FR")} Ar (${method}) enregistrée.`,
      withdrawalId: inserted.id,
    });
    return { ok: true, request: this.shape(reqRow) };
  },
};

/* ---------- Sanctions ---------- */
const Sanction = {
  async latest(userId) {
    return one("SELECT * FROM user_sanctions WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [userId]);
  },
  async isBlocked(userId) {
    const last = await this.latest(userId);
    return !!last && last.kind === "block" && !last.lifted_at;
  },
  async history(userId, limit = 20) {
    return all("SELECT * FROM user_sanctions WHERE user_id = $1 ORDER BY id DESC LIMIT $2", [userId, limit]);
  },
  async add(userId, kind, reason, actorId = null) {
    const now = nowSqlUtc();
    if (kind === "block" || kind === "unblock") {
      await query("UPDATE user_sanctions SET lifted_at = $1 WHERE user_id = $2 AND kind = 'block' AND lifted_at IS NULL", [now, userId]);
    }
    return one(
      "INSERT INTO user_sanctions (user_id, kind, reason, actor_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [userId, kind, reason || null, actorId]
    );
  },
};

/* ---------- KYC ---------- */
const MAX_FACE_BYTES = 2 * 1024 * 1024;
const FACE_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i;

function decodeKycFace(raw, which) {
  const label = which === "verso" ? "verso" : (which === "visage" ? "visage" : "recto");
  const code = which === "verso" ? "VERSO_REQUIRED" : (which === "visage" ? "VISAGE_REQUIRED" : "RECTO_REQUIRED");
  if (typeof raw !== "string" || !raw) {
    return {
      ok: false, code, status: 400,
      error: which === "verso" ? "Le verso de la carte d'identité est obligatoire"
        : which === "visage" ? "Le scan facial (selfie) est obligatoire"
          : "Le recto de la carte d'identité est obligatoire",
    };
  }
  const m = raw.match(FACE_RE);
  if (!m) return { ok: false, code: "FORMAT_INVALIDE", status: 400, error: `Image ${label} : format base64 attendu` };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_FACE_BYTES) return { ok: false, code: "IMAGE_TROP_LOURDE", status: 400, error: `Image ${label} trop lourde (max 2 Mo)` };
  const realExt = detectImageExt(buf);
  if (!imageMagicOk(buf, ext) || realExt === null) {
    return { ok: false, code: "CONTENU_INVALIDE", status: 400, error: `Le contenu de l'image ${label} ne correspond pas à un format accepté` };
  }
  return { ok: true, buf, ext: realExt, base64: m[2] };
}

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const Kyc = {
  async statusOf(userId) {
    const u = await one("SELECT kyc FROM users WHERE id = $1", [userId]);
    const latest = await one(
      "SELECT id, status, reason, submitted_at, reviewed_at FROM kyc_cases WHERE user_id = $1 ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (latest && latest.status === "pending") {
      return { status: "pending", reason: null, caseId: latest.id, submitted_at: latest.submitted_at };
    }
    if (u && u.kyc) return { status: "verified", reason: null, caseId: latest ? latest.id : null };
    if (latest && latest.status === "rejected") {
      return { status: "rejected", reason: latest.reason || "Dossier refusé", caseId: latest.id, reviewed_at: latest.reviewed_at };
    }
    return { status: "none", reason: null };
  },
  async submit(userId, body = {}) {
    const user = await one("SELECT id, kyc FROM users WHERE id = $1", [userId]);
    if (!user) return { ok: false, status: 404, code: "INCONNU", error: "Utilisateur introuvable" };
    if (user.kyc) return { ok: false, status: 400, code: "DEJA_VERIFIE", error: "Compte déjà vérifié" };
    const existing = await one("SELECT id FROM kyc_cases WHERE user_id = $1 AND status = 'pending'", [userId]);
    if (existing) return { ok: false, status: 409, code: "DOSSIER_EN_COURS", error: "Un dossier est déjà en cours d'examen" };

    const cutoff24 = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace("T", " ");
    const recent = await one("SELECT COUNT(*)::int AS c FROM kyc_cases WHERE user_id = $1 AND submitted_at >= $2", [userId, cutoff24]);
    if (recent && recent.c >= 3) {
      return { ok: false, status: 429, code: "TROP_DE_SOUMISSIONS", error: "Trop de demandes sur 24 h (maximum 3)" };
    }

    const r = decodeKycFace(body.recto, "recto");
    if (!r.ok) return r;
    const v = decodeKycFace(body.verso, "verso");
    if (!v.ok) return v;

    const rSha = crypto.createHash("sha256").update(r.buf).digest("hex");
    const vSha = crypto.createHash("sha256").update(v.buf).digest("hex");
    if (rSha === vSha) {
      return { ok: false, status: 400, code: "MEME_IMAGE", error: "Le recto et le verso doivent être deux photos différentes" };
    }

    const faceReq = (await Settings.setting("kyc_face_required")) === true;
    let f = null, fSha = null;
    if (body.visage) {
      f = decodeKycFace(body.visage, "visage");
      if (!f.ok) return f;
      fSha = crypto.createHash("sha256").update(f.buf).digest("hex");
    } else if (faceReq) {
      return { ok: false, status: 400, code: "VISAGE_REQUIRED", error: "Le scan facial (selfie) est obligatoire" };
    }

    const now = nowSqlUtc();
    const row = await one(
      `INSERT INTO kyc_cases
       (user_id, status, recto_path, verso_path, recto_sha, verso_sha, mime_recto, mime_verso, bytes_recto, bytes_verso,
        recto_data, verso_data, face_path, face_mime, face_bytes, face_sha, face_data, face_captured_at, face_consent_at, face_required, submitted_at)
       VALUES ($1,'pending',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id, submitted_at`,
      [
        userId,
        `db://kyc/${userId}/recto.${r.ext}`,
        `db://kyc/${userId}/verso.${v.ext}`,
        rSha, vSha,
        MIME_BY_EXT[r.ext] || "image/jpeg",
        MIME_BY_EXT[v.ext] || "image/jpeg",
        r.buf.length, v.buf.length,
        r.base64, v.base64,
        f ? `db://kyc/${userId}/visage.${f.ext}` : null,
        f ? (MIME_BY_EXT[f.ext] || "image/jpeg") : null,
        f ? f.buf.length : null,
        fSha,
        f ? f.base64 : null,
        f ? now : null,
        f ? now : null,
        faceReq ? 1 : 0,
        now,
      ]
    );
    return { ok: true, caseId: row.id, submitted_at: row.submitted_at };
  },
};

/* ---------- Games & Sessions ---------- */
const GameRecord = {
  async create(p1Id, p2Id, mode, format, wager, game) {
    const r = await one(
      "INSERT INTO games (player1_id, player2_id, mode, format, wager, reason, game, status) VALUES ($1,$2,$3,$4,$5,'en_cours',$6,'live') RETURNING id",
      [p1Id, p2Id, mode, format, wager, game || "fanoron-tsivy"]
    );
    return r.id;
  },
  async finish(id, winnerId, delta1, delta2, moves, reason, elo = null) {
    await query(
      `UPDATE games SET winner_id = $1, delta1 = $2, delta2 = $3, moves_json = $4, reason = $5,
              elo1_before = $6, elo1_after = $7, elo2_before = $8, elo2_after = $9, status = 'finished'
       WHERE id = $10`,
      [
        winnerId, delta1, delta2, JSON.stringify(moves || []), reason,
        elo ? elo.p1Before : null, elo ? elo.p1After : null,
        elo ? elo.p2Before : null, elo ? elo.p2After : null,
        id,
      ]
    );
  },
  async listForUser(userId) {
    return all(
      `SELECT g.*, u1.pseudo as p1_pseudo, u2.pseudo as p2_pseudo
       FROM games g
       LEFT JOIN users u1 ON g.player1_id = u1.id
       LEFT JOIN users u2 ON g.player2_id = u2.id
       WHERE g.player1_id = $1 OR g.player2_id = $1
       ORDER BY g.created_at DESC, g.id DESC LIMIT 50`,
      [userId]
    );
  },
};

const GameSessionStore = {
  async create(id, p1Id, p2Id, mode, format, wager, game = null, gameRecordId = null) {
    await query(
      `INSERT INTO game_sessions (id, player1_id, player2_id, mode, format, wager, game, game_record_id, state_json, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'','playing')`,
      [id, p1Id, p2Id, mode, format, wager, game || null, gameRecordId || null]
    );
  },
  async get(id) {
    return one("SELECT * FROM game_sessions WHERE id = $1", [id]);
  },
  async findPlayingByUser(userId) {
    return one(
      "SELECT * FROM game_sessions WHERE status = 'playing' AND (player1_id = $1 OR player2_id = $1) ORDER BY updated_at DESC, created_at DESC LIMIT 1",
      [userId]
    );
  },
  async updateState(id, stateObj) {
    await query("UPDATE game_sessions SET state_json = $1, updated_at = $2 WHERE id = $3", [
      JSON.stringify(stateObj),
      nowSqlUtc(),
      id,
    ]);
  },
  async setStatus(id, status, moves, winnerId) {
    await query(
      "UPDATE game_sessions SET status = $1, moves_json = COALESCE($2, moves_json), winner_id = COALESCE($3, winner_id), updated_at = $4 WHERE id = $5",
      [status, moves ? JSON.stringify(moves) : null, winnerId || null, nowSqlUtc(), id]
    );
  },
  async delete(id) {
    await query("DELETE FROM game_sessions WHERE id = $1", [id]);
  },
};

/* ---------- Chat, Friends, Challenges, Notifications ---------- */
const Chat = {
  async saveMessage(fromId, toId, text) {
    await query("INSERT INTO chat_messages (from_user_id, to_user_id, text) VALUES ($1,$2,$3)", [fromId, toId, text]);
  },
  async getThread(userId, otherId) {
    return all(
      `SELECT m.*, CASE WHEN m.from_user_id = $1 THEN 'me' ELSE 'them' END as direction
       FROM chat_messages m
       WHERE (m.from_user_id = $1 AND m.to_user_id = $2) OR (m.from_user_id = $2 AND m.to_user_id = $1)
       ORDER BY m.created_at ASC, m.id ASC`,
      [userId, otherId]
    );
  },
  async getContacts(userId) {
    return all(
      `SELECT u.id, u.pseudo, MAX(m.created_at) AS last_at
       FROM chat_messages m
       JOIN users u ON u.id = CASE WHEN m.from_user_id = $1 THEN m.to_user_id ELSE m.from_user_id END
       WHERE m.from_user_id = $1 OR m.to_user_id = $1
       GROUP BY u.id, u.pseudo
       ORDER BY last_at DESC`,
      [userId]
    );
  },
};

const Friend = {
  async add(userId, friendId) {
    if (userId === friendId) return { ok: false, error: "Impossible de s'ajouter soi-même" };
    const exists = await one("SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2", [userId, friendId]);
    if (exists) return { ok: false, error: "Déjà amis" };
    await query("INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, friendId]);
    return { ok: true };
  },
  async remove(userId, friendId) {
    await query("DELETE FROM friends WHERE user_id = $1 AND friend_id = $2", [userId, friendId]);
    return { ok: true };
  },
  async areFriends(userId, friendId) {
    return !!(await one("SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2", [userId, friendId]));
  },
  async list(userId) {
    return all(
      `SELECT u.id, u.pseudo, u.elo, u.wins, u.losses, f.created_at
       FROM friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 ORDER BY u.elo DESC`,
      [userId]
    );
  },
  async search(userId, q) {
    return all(
      "SELECT id, pseudo, elo, wins, losses FROM users WHERE pseudo ILIKE $1 AND id <> $2 ORDER BY elo DESC LIMIT 20",
      [`%${q}%`, userId]
    );
  },
};

const FriendRequest = {
  async send(fromId, toId) {
    if (fromId === toId) return { ok: false, error: "Impossible de s'envoyer une demande à soi-même" };
    if (await Friend.areFriends(fromId, toId)) return { ok: false, error: "Déjà amis" };
    const dup = await one("SELECT id FROM friend_requests WHERE from_id = $1 AND to_id = $2 AND status = 'pending'", [fromId, toId]);
    if (dup) return { ok: false, error: "Demande déjà envoyée", id: dup.id };
    await query("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2 AND status <> 'pending'", [fromId, toId]);
    const r = await one("INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2) RETURNING id", [fromId, toId]);
    return { ok: true, id: r.id };
  },
  async get(id) {
    return one("SELECT * FROM friend_requests WHERE id = $1", [id]);
  },
  async accept(id) {
    await query("UPDATE friend_requests SET status = 'accepted', responded_at = $1 WHERE id = $2", [nowSqlUtc(), id]);
  },
  async decline(id) {
    await query("UPDATE friend_requests SET status = 'declined', responded_at = $1 WHERE id = $2", [nowSqlUtc(), id]);
  },
  async incoming(userId) {
    return all(
      `SELECT fr.id, fr.from_id, fr.created_at, u.pseudo, u.elo, u.avatar, u.province
       FROM friend_requests fr JOIN users u ON u.id = fr.from_id
       WHERE fr.to_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [userId]
    );
  },
  async outgoing(userId) {
    return all(
      `SELECT fr.id, fr.to_id, fr.created_at, u.pseudo, u.elo, u.avatar, u.province
       FROM friend_requests fr JOIN users u ON u.id = fr.to_id
       WHERE fr.from_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [userId]
    );
  },
  async incomingWatermark(userId) {
    const r = await one("SELECT COALESCE(MAX(id), 0)::int AS m FROM friend_requests WHERE to_id = $1", [userId]);
    return r ? r.m : 0;
  },
  async newIncoming(userId) {
    const u = await one("SELECT friends_seen_request_id FROM users WHERE id = $1", [userId]);
    const seen = (u && u.friends_seen_request_id) || 0;
    const r = await one("SELECT COUNT(*)::int AS c FROM friend_requests WHERE to_id = $1 AND status = 'pending' AND id > $2", [userId, seen]);
    return r ? r.c : 0;
  },
  async markSeen(userId) {
    const upto = await this.incomingWatermark(userId);
    const cur = await one("SELECT friends_seen_request_id FROM users WHERE id = $1", [userId]);
    const seen = (cur && cur.friends_seen_request_id) || 0;
    if (upto > seen) await query("UPDATE users SET friends_seen_request_id = $1 WHERE id = $2", [upto, userId]);
    return { seen: Math.max(seen, upto) };
  },
  async pendingBetween(a, b) {
    const row = await one(
      "SELECT id, from_id, to_id FROM friend_requests WHERE status = 'pending' AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))",
      [a, b]
    );
    if (!row) return null;
    return { id: row.id, direction: row.from_id === a ? "outgoing" : "incoming" };
  },
};

const Challenge = {
  async create(fromId, toId, wager, format, game) {
    const id = "DF-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const expiresMs = Date.now() + 15 * 60 * 1000;
    const expiresSql = new Date(expiresMs).toISOString().slice(0, 19).replace("T", " ");
    await query(
      "INSERT INTO challenges (id, from_id, to_id, wager, format, game, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)",
      [id, fromId, toId, wager, format, game || "fanoron-tsivy", expiresSql]
    );
    return { id, expires_at: expiresMs };
  },
  async getByUser(userId) {
    return all(
      `SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo,
              u1.avatar as from_avatar, u2.avatar as to_avatar
       FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
       WHERE c.to_id = $1 AND c.status = 'pending' ORDER BY c.created_at DESC`,
      [userId]
    );
  },
  async get(id) {
    return one(
      `SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo,
              u1.avatar as from_avatar, u2.avatar as to_avatar
       FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
       WHERE c.id = $1`,
      [id]
    );
  },
  async listSent(userId) {
    return all(
      `SELECT c.*, u1.pseudo as from_pseudo, u2.pseudo as to_pseudo, u1.elo as from_elo, u2.elo as to_elo,
              u1.avatar as from_avatar, u2.avatar as to_avatar
       FROM challenges c JOIN users u1 ON c.from_id = u1.id JOIN users u2 ON c.to_id = u2.id
       WHERE c.from_id = $1 ORDER BY c.created_at DESC`,
      [userId]
    );
  },
  async update(id, status) {
    await query("UPDATE challenges SET status = $1 WHERE id = $2", [status, id]);
  },
};

const Notification = {
  async create(userId, type, payload = {}) {
    await query("INSERT INTO notifications (user_id, type, payload_json) VALUES ($1, $2, $3)", [
      userId,
      type,
      JSON.stringify(payload),
    ]);
  },
  async list(userId, limit = 40) {
    const rows = await all(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
      [userId, limit]
    );
    return rows.map((r) => ({
      ...r,
      read: !!r.read,
      payload: (() => { try { return JSON.parse(r.payload_json || "{}"); } catch (_) { return {}; } })(),
    }));
  },
  async unreadCount(userId) {
    const r = await one("SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read = 0", [userId]);
    return r ? r.c : 0;
  },
  async markRead(id, userId) {
    await query("UPDATE notifications SET read = 1 WHERE id = $1 AND user_id = $2", [id, userId]);
  },
  async markAllRead(userId) {
    await query("UPDATE notifications SET read = 1 WHERE user_id = $1", [userId]);
  },
};

/* ---------- Tournois ---------- */
const Tournament = {
  async list() { return all("SELECT * FROM tournaments ORDER BY starts_at ASC"); },
  async get(id) { return one("SELECT * FROM tournaments WHERE id = $1", [id]); },
  async getRegistrations(tournamentId) {
    return all(
      `SELECT u.id, u.pseudo, u.elo FROM tournament_registrations tr
       JOIN users u ON tr.user_id = u.id WHERE tr.tournament_id = $1`,
      [tournamentId]
    );
  },
  async isRegistered(userId, tournamentId) {
    return !!(await one("SELECT 1 FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2", [tournamentId, userId]));
  },
  async register(userId, tournamentId) {
    await query(
      "INSERT INTO tournament_registrations (tournament_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [tournamentId, userId]
    );
  },
};

const TournamentMatch = {
  async create(tournamentId, round, slot, opts = {}) {
    const r = await one(
      `INSERT INTO tournament_matches (tournament_id, round, slot, p1_id, p2_id, status, starts_at, confirm_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        tournamentId, round, slot,
        opts.p1_id || null, opts.p2_id || null,
        opts.status || "a_venir",
        opts.starts_at || null, opts.confirm_deadline || null,
      ]
    );
    return r.id;
  },
  async get(id) {
    return one(
      `SELECT tm.*, u1.pseudo as p1_pseudo, u2.pseudo as p2_pseudo, u1.elo as p1_elo, u2.elo as p2_elo
       FROM tournament_matches tm
       LEFT JOIN users u1 ON tm.p1_id = u1.id
       LEFT JOIN users u2 ON tm.p2_id = u2.id
       WHERE tm.id = $1`,
      [id]
    );
  },
  async listByTournament(tournamentId) {
    return all(
      `SELECT tm.*, u1.pseudo as p1_pseudo, u2.pseudo as p2_pseudo, u1.elo as p1_elo, u2.elo as p2_elo
       FROM tournament_matches tm
       LEFT JOIN users u1 ON tm.p1_id = u1.id
       LEFT JOIN users u2 ON tm.p2_id = u2.id
       WHERE tm.tournament_id = $1 ORDER BY tm.round ASC, tm.slot ASC`,
      [tournamentId]
    );
  },
  async setNext(id, nextId) {
    await query("UPDATE tournament_matches SET next_match_id = $1 WHERE id = $2", [nextId, id]);
  },
  async setPlayer(id, which, userId) {
    const col = which === 1 ? "p1_id" : "p2_id";
    await query(`UPDATE tournament_matches SET ${col} = $1 WHERE id = $2`, [userId, id]);
  },
  async setStatus(id, status) {
    await query("UPDATE tournament_matches SET status = $1 WHERE id = $2", [status, id]);
  },
  async confirm(id, which) {
    const col = which === 1 ? "confirmed_p1" : "confirmed_p2";
    await query(`UPDATE tournament_matches SET ${col} = 1 WHERE id = $1`, [id]);
  },
  async setResult(id, s1, s2, winnerId) {
    await query(
      "UPDATE tournament_matches SET score1 = $1, score2 = $2, winner_id = $3, status = 'termine' WHERE id = $4",
      [s1, s2, winnerId, id]
    );
  },
  async setForfeit(id, winnerId) {
    await query("UPDATE tournament_matches SET winner_id = $1, status = 'forfait' WHERE id = $2", [winnerId, id]);
  },
};

module.exports = {
  nowIso,
  nowSqlUtc,
  toIsoUtc,
  fold,
  Settings,
  Badges,
  PionStyle,
  Skins,
  User,
  Wallet,
  Finance,
  Sanction,
  Kyc,
  GameRecord,
  GameSessionStore,
  Chat,
  Friend,
  FriendRequest,
  Challenge,
  Notification,
  Tournament,
  TournamentMatch,
};
