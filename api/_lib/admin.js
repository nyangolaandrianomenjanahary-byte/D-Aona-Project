/* =========================================================
   D-aôna (Vercel + Supabase) — Back-office Administration (/api/admin/*)
   ========================================================= */
"use strict";

const { query, one, all, tx } = require("./db");
const Perms = require("../../apps/api/admin/permissions");
const DATA = require("../../apps/api/data");
const { User, Wallet, Finance, Sanction, Notification, Settings, nowSqlUtc } = require("./stores");
const { emitUser, emitBroadcast } = require("./realtime");
const { generateBracket, walletPayload } = require("./game_rt");

function respond(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function refuse(res, r) {
  return respond(res, { error: r.error || "Accès refusé", code: r.code || "ACCES_REFUSE" }, r.status || 403);
}

async function audit({ actorId = null, actorPseudo = null, action, target = null, detail = null, ip = null }) {
  try {
    await query(
      "INSERT INTO admin_audit (actor_id, actor_pseudo, action, target, detail_json, ip) VALUES ($1,$2,$3,$4,$5,$6)",
      [actorId, actorPseudo, String(action).slice(0, 80), target ? String(target).slice(0, 120) : null, detail ? JSON.stringify(detail) : null, ip]
    );
  } catch (_) {}
}

async function rolesOf(userId) {
  if (!userId) return [];
  const rows = await all("SELECT role_id FROM admin_assignments WHERE user_id = $1", [userId]);
  return rows.map((r) => r.role_id);
}

async function isModuleEnabled(modId) {
  const row = await one("SELECT enabled FROM admin_modules WHERE id = $1", [modId]);
  return !row || !!row.enabled;
}

async function rightsOf(userId) {
  const roles = await rolesOf(userId);
  const out = {};
  if (!roles.length) return out;
  if (roles.includes("super_admin")) return Perms.fullRights();
  const rows = await all(
    "SELECT DISTINCT module, action FROM admin_grants WHERE role_id = ANY($1::text[]) AND allowed = 1",
    [roles]
  );
  for (const r of rows) {
    if (!out[r.module]) out[r.module] = [];
    if (!out[r.module].includes(r.action)) out[r.module].push(r.action);
  }
  return out;
}

async function authorise(userId, perm) {
  if (!userId) return { ok: false, status: 401, code: "NON_AUTHENTIFIE", error: "Non authentifié" };
  const roles = await rolesOf(userId);
  if (!roles.length) return { ok: false, status: 403, code: "ACCES_REFUSE", error: "Accès refusé" };
  if (!Perms.isPermission(perm)) return { ok: false, status: 403, code: "PERM_INCONNUE", error: "Permission inconnue" };
  const [mod, act] = perm.split(".");
  if (!(await isModuleEnabled(mod))) {
    return { ok: false, status: 403, code: "MODULE_DESACTIVE", error: `Module « ${mod} » désactivé` };
  }
  if (roles.includes("super_admin")) return { ok: true, roles };
  const rights = await rightsOf(userId);
  if (Array.isArray(rights[mod]) && rights[mod].includes(act)) return { ok: true, roles };
  return { ok: false, status: 403, code: "PERMISSION_MANQUANTE", error: `Permission requise : ${perm}` };
}

async function listModulesPayload() {
  const rows = await all("SELECT id, enabled, updated_at FROM admin_modules");
  const state = new Map(rows.map((r) => [r.id, !!r.enabled]));
  const updated = new Map(rows.map((r) => [r.id, r.updated_at || null]));
  return Perms.ALL_MODULES.map((id) => ({
    id,
    label: Perms.MODULES[id].label,
    desc: Perms.MODULES[id].desc || null,
    group: Perms.MODULES[id].group || null,
    core: !!Perms.MODULES[id].core,
    actions: Perms.MODULES[id].actions,
    enabled: state.get(id) !== false,
    updated_at: updated.get(id) || null,
  }));
}

async function mePayload(userId) {
  const roles = await rolesOf(userId);
  const rights = await rightsOf(userId);
  const permissions = [];
  for (const [mod, acts] of Object.entries(rights)) {
    for (const a of acts) permissions.push(`${mod}.${a}`);
  }
  return {
    roles,
    permissions,
    rights,
    modules: await listModulesPayload(),
    catalogue: Object.fromEntries(Object.entries(Perms.MODULES).map(([id, m]) => [id, m.actions])),
    all: Perms.allPermissions(),
    superAdmin: roles.includes("super_admin"),
  };
}

async function handleAdmin(req, res, pathname, url, ctx) {
  const method = req.method;
  const parts = pathname.slice("/api/admin".length).split("/").filter(Boolean);
  const ip = ctx.ip || null;
  const actor = { id: ctx.userId || null, pseudo: (ctx.user && ctx.user.pseudo) || null };

  const guard = async (perm) => {
    const g = await authorise(ctx.userId, perm);
    if (!g.ok && method !== "GET") {
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "acces.refuse", target: pathname, detail: { code: g.code }, ip });
    }
    if (!g.ok) { refuse(res, g); return false; }
    return true;
  };

  if (method === "GET" && (parts.length === 0 || parts[0] === "me")) {
    const roles = await rolesOf(ctx.userId);
    if (!roles.length) return refuse(res, { status: 403, code: "ACCES_REFUSE", error: "Accès refusé" });
    return respond(res, { ...(await mePayload(ctx.userId)), userId: ctx.userId, pseudo: actor.pseudo });
  }

  /* ---------- Overview ---------- */
  if (method === "GET" && parts[0] === "overview" && parts.length === 1) {
    if (!(await guard("overview.read"))) return;
    const oneCount = async (sql, p = []) => {
      const r = await one(sql, p);
      return r ? Number(r.c || 0) : 0;
    };
    const kyc = {
      pending: await oneCount("SELECT COUNT(*)::int AS c FROM kyc_cases WHERE status = 'pending'"),
      verified: await oneCount("SELECT COUNT(*)::int AS c FROM kyc_cases WHERE status = 'verified'"),
      rejected: await oneCount("SELECT COUNT(*)::int AS c FROM kyc_cases WHERE status = 'rejected'"),
    };
    const disputes = {
      open: await oneCount("SELECT COUNT(*)::int AS c FROM disputes WHERE status IN ('open','investigating')"),
      resolved: await oneCount("SELECT COUNT(*)::int AS c FROM disputes WHERE status = 'resolved'"),
    };
    const withdrawals = {
      pending: await oneCount("SELECT COUNT(*)::int AS c FROM withdrawals WHERE status = 'pending'"),
      approved: await oneCount("SELECT COUNT(*)::int AS c FROM withdrawals WHERE status = 'approved'"),
    };
    const activityRows = await all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*)::int AS games
       FROM games
       WHERE COALESCE(status, '') <> 'cancelled'
       GROUP BY day ORDER BY day DESC LIMIT 7`
    );
    const byDay = new Map(activityRows.map((r) => [r.day, r.games]));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() + 3 * 3600 * 1000 - i * 86400000).toISOString().slice(0, 10);
      days.push({ day: d, games: byDay.get(d) || 0 });
    }
    const todayMada = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const players = await one(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(CASE WHEN substr(last_seen, 1, 10) >= $1 THEN 1 ELSE 0 END), 0)::int AS today,
              COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) >= $2 THEN 1 ELSE 0 END), 0)::int AS news
       FROM users`,
      [todayMada, weekAgo]
    );
    const todayDefi = await oneCount("SELECT COUNT(*)::int AS c FROM games WHERE substr(created_at, 1, 10) = $1 AND mode = 'defi'", [todayMada]);
    const todayOnline = await oneCount("SELECT COUNT(*)::int AS c FROM games WHERE substr(created_at, 1, 10) = $1 AND mode = 'online'", [todayMada]);
    const todayAutres = await oneCount("SELECT COUNT(*)::int AS c FROM games WHERE substr(created_at, 1, 10) = $1 AND mode NOT IN ('defi','online')", [todayMada]);
    const liveGames = await oneCount("SELECT COUNT(*)::int AS c FROM games WHERE status = 'live'");
    const live = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(wager),0)::bigint AS per_side, COALESCE(SUM(wager*2),0)::bigint AS pot FROM game_sessions WHERE status = 'playing'");
    const liveByGame = await all("SELECT NULLIF(game,'') AS game, COUNT(*)::int AS sessions, COALESCE(SUM(wager*2),0)::bigint AS pot FROM game_sessions WHERE status = 'playing' GROUP BY game ORDER BY pot DESC");
    const openRegistrations = await oneCount("SELECT COUNT(*)::int AS c FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id WHERE t.status = 'inscriptions'");
    return respond(res, {
      players: players || { total: 0, today: 0, news: 0 },
      gamesToday: todayDefi + todayOnline,
      gamesTodaySplit: { defi: todayDefi, online: todayOnline, autres: todayAutres },
      liveGames,
      liveWagers: {
        total: Number(live ? live.pot : 0),
        perSide: Number(live ? live.per_side : 0),
        sessions: live ? live.n : 0,
        byGame: liveByGame.map((r) => ({ game: r.game || null, sessions: r.sessions, pot: Number(r.pot || 0) })),
      },
      openRegistrations,
      kyc, disputes, withdrawals,
      activity: days,
      queue: [
        { id: "kyc", label: "Dossiers KYC en attente", count: kyc.pending, perm: "kyc.read" },
        { id: "withdrawals", label: "Demandes de retrait", count: withdrawals.pending + withdrawals.approved, perm: "withdrawals.read" },
        { id: "disputes", label: "Litiges ouverts", count: disputes.open, perm: "disputes.read" },
      ],
    });
  }

  /* ---------- Modules ---------- */
  if (parts[0] === "modules") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("modules.read"))) return;
      return respond(res, { modules: await listModulesPayload() });
    }
    if (method === "POST" && parts.length === 2) {
      if (!(await guard("modules.edit"))) return;
      const b = await ctx.body();
      if (!b.enabled && Perms.isCore(parts[1])) return refuse(res, { status: 409, code: "MODULE_SOCLE", error: "Module socle : il ne peut pas être désactivé" });
      const r = await query("UPDATE admin_modules SET enabled = $1, updated_at = $2 WHERE id = $3", [b.enabled ? 1 : 0, nowSqlUtc(), parts[1]]);
      if (!r.rowCount) return refuse(res, { status: 404, code: "MODULE_INCONNU", error: "Module inconnu" });
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "modules.toggle", target: `module:${parts[1]}`, detail: { enabled: !!b.enabled }, ip });
      return respond(res, { ok: true, modules: await listModulesPayload() });
    }
  }

  /* ---------- Roles & Assignments ---------- */
  if (parts[0] === "roles") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("roles.read"))) return;
      const roles = await all("SELECT * FROM admin_roles ORDER BY protected DESC, id ASC");
      const grants = await all("SELECT role_id, module, action, allowed FROM admin_grants");
      const counts = await all("SELECT role_id, COUNT(*)::int AS c FROM admin_assignments GROUP BY role_id");
      const countBy = new Map(counts.map((c) => [c.role_id, c.c]));
      const byRole = new Map();
      for (const g of grants) {
        if (!byRole.has(g.role_id)) byRole.set(g.role_id, {});
        const map = byRole.get(g.role_id);
        if (!map[g.module]) map[g.module] = {};
        map[g.module][g.action] = !!g.allowed;
      }
      const fullRightsMap = () => {
        const out = {};
        for (const m of Perms.ALL_MODULES) {
          out[m] = {};
          for (const a of Perms.MODULES[m].actions) out[m][a] = true;
        }
        return out;
      };
      const out = roles.map((role) => ({
        ...role,
        protected: !!role.protected,
        members: countBy.get(role.id) || 0,
        rights: role.protected ? fullRightsMap() : (byRole.get(role.id) || {}),
      }));
      return respond(res, { roles: out, modules: await listModulesPayload(), actions: Perms.ACTIONS });
    }
    if (method === "POST" && parts.length === 2) {
      if (!(await guard("roles.edit"))) return;
      const roleId = parts[1];
      if (roleId === "super_admin") return refuse(res, { status: 409, code: "ROLE_PROTEGE", error: "Rôle protégé non modifiable" });
      const b = await ctx.body();
      const changes = Array.isArray(b.changes) ? b.changes : [];
      for (const ch of changes) {
        if (!Perms.isPermission(`${ch.module}.${ch.action}`)) continue;
        await query(
          `INSERT INTO admin_grants (role_id, module, action, allowed) VALUES ($1,$2,$3,$4)
           ON CONFLICT (role_id, module, action) DO UPDATE SET allowed = EXCLUDED.allowed`,
          [roleId, ch.module, ch.action, ch.allowed ? 1 : 0]
        );
      }
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "roles.update", target: `role:${roleId}`, detail: { count: changes.length }, ip });
      return respond(res, { ok: true });
    }
  }

  if (parts[0] === "assignments") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("roles.read"))) return;
      const rows = await all(
        `SELECT a.user_id, a.role_id, a.granted_at, u.pseudo, u.email
         FROM admin_assignments a JOIN users u ON u.id = a.user_id ORDER BY u.pseudo ASC`
      );
      return respond(res, { assignments: rows });
    }
    if (method === "POST" && parts.length === 1) {
      if (!(await guard("roles.edit"))) return;
      const b = await ctx.body();
      const target = b.email ? await User.getByEmail(b.email) : (b.pseudo ? await User.getByPseudo(b.pseudo) : await User.getById(parseInt(b.userId, 10)));
      if (!target) return refuse(res, { status: 404, code: "JOUEUR_INCONNU", error: "Joueur introuvable" });
      const roleId = b.role || b.roleId;
      if (!Perms.ROLES[roleId]) return refuse(res, { status: 400, code: "ROLE_INCONNU", error: "Rôle inconnu" });
      const action = b.action || "grant";
      if (action === "grant") {
        await query("INSERT INTO admin_assignments (user_id, role_id, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [target.id, roleId, actor.id]);
      } else if (action === "revoke") {
        if (roleId === "super_admin") {
          const cnt = await one("SELECT COUNT(*)::int AS c FROM admin_assignments WHERE role_id = 'super_admin'");
          if (cnt && cnt.c <= 1) return refuse(res, { status: 409, code: "DERNIER_SUPER", error: "Impossible de retirer le dernier super administrateur" });
        }
        await query("DELETE FROM admin_assignments WHERE user_id = $1 AND role_id = $2", [target.id, roleId]);
      }
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: `roles.${action}`, target: `user:${target.id}`, detail: { pseudo: target.pseudo, role: roleId }, ip });
      return respond(res, { ok: true, userId: target.id, roles: await rolesOf(target.id) });
    }
  }

  /* ---------- Audit ---------- */
  if (method === "GET" && parts[0] === "audit" && parts.length === 1) {
    if (!(await guard("audit.read"))) return;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 100, 1), 500);
    const rows = await all("SELECT * FROM admin_audit ORDER BY id DESC LIMIT $1", [limit]);
    const entries = rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor_id: r.actor_id,
      actor_pseudo: r.actor_pseudo,
      action: r.action,
      target: r.target,
      detail: r.detail_json ? (() => { try { return JSON.parse(r.detail_json); } catch (_) { return null; } })() : null,
      ip: r.ip,
    }));
    return respond(res, { entries });
  }

  /* ---------- Users & Sanctions ---------- */
  if (parts[0] === "users") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("users.read"))) return;
      const q = (url.searchParams.get("q") || "").trim();
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 200, 1), 500);
      const users = q
        ? await all("SELECT id, pseudo, email, phone, elo, wins, losses, balance, bonus_lock, kyc, province, avatar, created_at, last_seen FROM users WHERE pseudo ILIKE $1 ORDER BY elo DESC LIMIT $2", [`%${q}%`, limit])
        : await all("SELECT id, pseudo, email, phone, elo, wins, losses, balance, bonus_lock, kyc, province, avatar, created_at, last_seen FROM users ORDER BY elo DESC LIMIT $1", [limit]);
      const kycRows = await all("SELECT user_id, status FROM kyc_cases ORDER BY id ASC");
      const kycMap = new Map(kycRows.map((r) => [r.user_id, r.status]));
      const blkRows = await all("SELECT user_id, reason FROM user_sanctions WHERE kind = 'block' AND lifted_at IS NULL");
      const blkMap = new Map(blkRows.map((r) => [r.user_id, r.reason]));
      const roleRows = await all("SELECT user_id, role_id FROM admin_assignments ORDER BY role_id");
      const roleMap = new Map();
      for (const r of roleRows) {
        if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, []);
        roleMap.get(r.user_id).push(r.role_id);
      }
      const lgRows = await all(
        `SELECT player_id, MAX(t) AS t FROM (
           SELECT player1_id AS player_id, updated_at AS t FROM game_sessions
           UNION ALL SELECT player2_id, updated_at FROM game_sessions
           UNION ALL SELECT player1_id, created_at FROM games
           UNION ALL SELECT player2_id, created_at FROM games
         ) s GROUP BY player_id`
      );
      const lgMap = new Map(lgRows.map((r) => [r.player_id, r.t]));
      return respond(res, {
        users: users.map((u) => ({
          ...u,
          kyc: !!u.kyc,
          kyc_status: u.kyc ? "verified" : (kycMap.get(u.id) || "none"),
          roles: roleMap.get(u.id) || [],
          blocked: blkMap.has(u.id),
          sanction_reason: blkMap.get(u.id) || null,
          last_game_at: lgMap.get(u.id) || null,
        })),
      });
    }
    if (method === "GET" && parts.length === 2) {
      if (!(await guard("users.read"))) return;
      const id = parseInt(parts[1], 10);
      const u = await User.getById(id);
      if (!u) return refuse(res, { status: 404, code: "JOUEUR_INCONNU", error: "Joueur introuvable" });
      const jeu = await one(
        `SELECT MAX(t) AS t FROM (
           SELECT MAX(updated_at) AS t FROM game_sessions WHERE player1_id = $1 OR player2_id = $1
           UNION ALL SELECT MAX(created_at) AS t FROM games WHERE player1_id = $1 OR player2_id = $1
         ) s`,
        [id]
      );
      const c = await one(
        `SELECT id, status, reason, submitted_at, reviewed_at,
                recto_path, verso_path, bytes_recto, bytes_verso, recto_sha, verso_sha,
                face_path, face_bytes, face_captured_at, retention_until
         FROM kyc_cases WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
        [id]
      );
      const blk = await one(
        "SELECT reason FROM user_sanctions WHERE user_id = $1 AND kind = 'block' AND lifted_at IS NULL ORDER BY id DESC LIMIT 1",
        [id]
      );
      return respond(res, {
        id: u.id,
        pseudo: u.pseudo,
        phone: u.phone || null,
        email: u.email || null,
        province: u.province || null,
        avatar: u.avatar || null,
        elo: u.elo,
        wins: u.wins,
        losses: u.losses,
        balance: u.balance,
        bonus_lock: u.bonus_lock,
        created_at: u.created_at,
        last_seen: u.last_seen,
        last_game_at: (jeu && jeu.t) || null,
        kyc_status: u.kyc ? "verified" : (c ? c.status : "none"),
        kyc_case: c ? {
          id: c.id,
          status: c.status,
          reason: c.reason || null,
          submitted_at: c.submitted_at,
          reviewed_at: c.reviewed_at,
          faces: { recto: !!c.recto_path, verso: !!c.verso_path },
          bytes: { recto: c.bytes_recto, verso: c.bytes_verso },
          sha8: { recto: String(c.recto_sha || "").slice(0, 8), verso: String(c.verso_sha || "").slice(0, 8) },
          face: { present: !!c.face_path, captured_at: c.face_captured_at || null },
          retention_until: c.retention_until || null,
        } : null,
        roles: await rolesOf(id),
        blocked: !!blk,
        sanction_reason: blk ? blk.reason : null,
      });
    }
    if (method === "POST" && parts.length === 2) {
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      const act = b.action === "revoke-kyc" ? "kyc_revoke" : b.action;
      if (!(await guard(act === "block" || act === "unblock" || act === "warning" || act === "kyc_revoke" ? "users.review" : "users.edit"))) return;
      const target = await User.getById(id);
      if (!target) return refuse(res, { status: 404, code: "JOUEUR_INCONNU", error: "Joueur introuvable" });
      if (["block", "unblock", "warning", "kyc_revoke"].includes(act)) {
        await Sanction.add(id, act, b.reason || null, actor.id);
        if (act === "kyc_revoke") await User.update(id, { kyc: 0 });
        if (act === "block") await query("UPDATE sessions SET revoked_at = $1, revoked_reason = 'sanction_block' WHERE user_id = $2 AND revoked_at IS NULL", [nowSqlUtc(), id]);
      } else if (act === "unlock") {
        await query("UPDATE auth_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [id]);
      }
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: `users.${act}`, target: `user:${id}`, detail: { reason: b.reason || null }, ip });
      return respond(res, { ok: true, blocked: await Sanction.isBlocked(id) });
    }
  }

  /* ---------- KYC ---------- */
  if (parts[0] === "kyc") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("kyc.read"))) return;
      const status = url.searchParams.get("status") || "pending";
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 100, 1), 300);
      const rows = status === "all"
        ? await all("SELECT k.id, k.user_id, k.status, k.reason, k.submitted_at, k.reviewed_at, k.bytes_recto, k.bytes_verso, k.face_path, k.face_required, u.pseudo, u.email, u.phone, u.first_name, u.last_name, u.birth_date FROM kyc_cases k LEFT JOIN users u ON u.id = k.user_id ORDER BY k.id DESC LIMIT $1", [limit])
        : await all("SELECT k.id, k.user_id, k.status, k.reason, k.submitted_at, k.reviewed_at, k.bytes_recto, k.bytes_verso, k.face_path, k.face_required, u.pseudo, u.email, u.phone, u.first_name, u.last_name, u.birth_date FROM kyc_cases k LEFT JOIN users u ON u.id = k.user_id WHERE k.status = $1 ORDER BY k.id ASC LIMIT $2", [status, limit]);
      const countRows = await all("SELECT status, COUNT(*)::int AS c FROM kyc_cases GROUP BY status");
      const counts = { pending: 0, verified: 0, rejected: 0 };
      for (const r of countRows) counts[r.status] = r.c;
      return respond(res, {
        counts,
        cases: rows.map((c) => ({ ...c, has_face: !!c.face_path, hasFace: !!c.face_path, faceRequired: !!c.face_required })),
      });
    }
    if (method === "GET" && parts.length === 4 && parts[2] === "doc") {
      if (!(await guard("kyc.read"))) return;
      const caseId = parseInt(parts[1], 10);
      const face = parts[3] === "verso" ? "verso" : (parts[3] === "visage" ? "visage" : "recto");
      const row = await one("SELECT recto_data, mime_recto, verso_data, mime_verso, face_data, face_mime FROM kyc_cases WHERE id = $1", [caseId]);
      if (!row) return refuse(res, { status: 404, code: "DOSSIER_INCONNU", error: "Dossier introuvable" });
      const b64 = face === "verso" ? row.verso_data : (face === "visage" ? row.face_data : row.recto_data);
      const mime = face === "verso" ? row.mime_verso : (face === "visage" ? row.face_mime : row.mime_recto);
      if (!b64) return refuse(res, { status: 404, code: "PIECE_ABSENTE", error: "Pièce introuvable" });
      const buf = Buffer.from(b64, "base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", mime || "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      return res.end(buf);
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "open") {
      if (!(await guard("kyc.read"))) return;
      const caseId = parseInt(parts[1], 10);
      const row = await one("SELECT id, user_id, status FROM kyc_cases WHERE id = $1", [caseId]);
      if (!row) return refuse(res, { status: 404, code: "DOSSIER_INCONNU", error: "Dossier introuvable" });
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "kyc.open", target: `kyc:${caseId}`, detail: { userId: row.user_id, status: row.status }, ip });
      return respond(res, { ok: true, caseId, status: row.status });
    }
    if (method === "POST" && parts.length === 3 && (parts[2] === "approve" || parts[2] === "reject")) {
      if (!(await guard("kyc.review"))) return;
      const caseId = parseInt(parts[1], 10);
      const b = await ctx.body();
      const decision = parts[2];
      const row = await one("SELECT * FROM kyc_cases WHERE id = $1", [caseId]);
      if (!row) return refuse(res, { status: 404, code: "DOSSIER_INCONNU", error: "Dossier introuvable" });
      if (row.status !== "pending") return refuse(res, { status: 409, code: "DEJA_TRAITE", error: "Dossier déjà traité" });
      if (decision === "reject" && (!b.reason || !String(b.reason).trim())) {
        return refuse(res, { status: 400, code: "MOTIF_REQUIS", error: "Motif obligatoire pour un refus" });
      }
      if (decision === "approve" && row.face_required && !row.face_data) {
        return refuse(res, { status: 400, code: "VISAGE_REQUIS", error: "Selfie requis pour valider ce dossier" });
      }
      const newStatus = decision === "approve" ? "verified" : "rejected";
      const now = nowSqlUtc();
      await tx(async (c) => {
        await c.query(
          "UPDATE kyc_cases SET status = $1, reason = $2, reviewed_at = $3, reviewer_id = $4 WHERE id = $5",
          [newStatus, b.reason ? String(b.reason).trim().slice(0, 300) : null, now, actor.id, caseId]
        );
        if (decision === "approve") await c.query("UPDATE users SET kyc = 1 WHERE id = $1", [row.user_id]);
      });
      await Notification.create(row.user_id, "kyc", {
        text: decision === "approve" ? "✅ Votre identité (KYC) a été vérifiée." : `❌ Dossier KYC refusé : ${b.reason}`,
      });
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: `kyc.${decision}`, target: `kyc:${caseId}`, detail: { userId: row.user_id, reason: b.reason || null }, ip });
      return respond(res, { ok: true, status: newStatus });
    }
  }

  /* ---------- Finance & Withdrawals ---------- */
  if (parts[0] === "finance" && method === "GET" && parts.length === 1) {
    if (!(await guard("finance.read"))) return;
    const sum = await one("SELECT COALESCE(SUM(balance),0)::bigint AS bal, COALESCE(SUM(bonus_lock),0)::bigint AS lock, COUNT(*)::int AS players FROM users");
    const wd = await one(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount ELSE 0 END), 0)::bigint AS engaged,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0)::bigint AS paid,
         COALESCE(SUM(CASE WHEN status = 'rejected' THEN amount ELSE 0 END), 0)::bigint AS refused
       FROM withdrawals`
    );
    const flows = await all("SELECT dir, COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS count FROM transactions GROUP BY dir");
    const byDir = Object.fromEntries(flows.map((f) => [f.dir, { total: Number(f.total || 0), count: f.count }]));
    return respond(res, {
      players: sum ? sum.players : 0,
      balance: Number(sum ? sum.bal : 0),
      bonus: Number(sum ? sum.lock : 0),
      engaged: Number(wd ? wd.engaged : 0),
      paid: Number(wd ? wd.paid : 0),
      refused: Number(wd ? wd.refused : 0),
      inflow: byDir.in || { total: 0, count: 0 },
      outflow: byDir.out || { total: 0, count: 0 },
    });
  }

  if (parts[0] === "accounting" && method === "GET" && parts.length === 1) {
    if (!(await guard(url.searchParams.get("format") === "csv" ? "finance.export" : "finance.read"))) return;
    const rows = await all(
      "SELECT t.*, u.pseudo FROM transactions t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 500"
    );
    if (url.searchParams.get("format") === "csv") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="d-aona-accounting.csv"');
      return res.end(DATA.txCsv(rows));
    }
    const byActivity = {};
    for (const r of rows) {
      const k = DATA.txKind ? DATA.txKind(r) : (r.dir || "autre");
      byActivity[k] = (byActivity[k] || 0) + Number(r.amount || 0);
    }
    return respond(res, { transactions: rows, ledger: rows, byActivity });
  }

  if (parts[0] === "withdrawals") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("withdrawals.read"))) return;
      const status = url.searchParams.get("status") || "all";
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 100, 1), 500);
      const rows = ["pending", "approved", "rejected", "paid"].includes(status)
        ? await all("SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.status = $1 ORDER BY w.id ASC LIMIT $2", [status, limit])
        : await all("SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id ORDER BY CASE w.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, w.id DESC LIMIT $1", [limit]);
      return respond(res, {
        withdrawals: rows.map((r) => Finance.shape(r)),
        methods: Finance.METHODS,
        dailyCap: Finance.DAILY_CAP,
        minAmount: Finance.MIN_AMOUNT,
      });
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "review") {
      if (!(await guard("withdrawals.review"))) return;
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      const row = await one("SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = $1", [id]);
      if (!row) return refuse(res, { status: 404, code: "INCONNU", error: "Demande introuvable" });
      if (row.status !== "pending") return refuse(res, { status: 409, code: "STATUT_INVALIDE", error: "Demande déjà instruite" });
      if (b.decision === "reject" && (!b.reason || !String(b.reason).trim())) {
        return refuse(res, { status: 400, code: "MOTIF_REQUIS", error: "Motif obligatoire pour un refus" });
      }
      const nextStatus = b.decision === "approve" ? "approved" : "rejected";
      await query(
        "UPDATE withdrawals SET status = $1, reason = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $5",
        [nextStatus, b.reason ? String(b.reason).trim().slice(0, 300) : null, actor.id, nowSqlUtc(), id]
      );
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: `withdrawals.${b.decision}`, target: `withdrawal:${id}`, detail: { amount: row.amount, pseudo: row.pseudo }, ip });
      return respond(res, { ok: true, request: { ...Finance.shape(row), status: nextStatus } });
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "pay") {
      if (!(await guard("withdrawals.review"))) return;
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      if (!b.reference || !String(b.reference).trim()) return refuse(res, { status: 400, code: "REFERENCE_REQUISE", error: "Référence de transfert obligatoire" });
      const row = await one("SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = $1", [id]);
      if (!row) return refuse(res, { status: 404, code: "INCONNU", error: "Demande introuvable" });
      if (row.status !== "approved") return refuse(res, { status: 409, code: "STATUT_INVALIDE", error: "La demande doit être approuvée avant paiement" });
      const ok = await Wallet.spendWithdrawable(row.user_id, row.amount, `Retrait ${row.method}`, `withdrawal:${id}`);
      if (!ok) return refuse(res, { status: 400, code: "SOLDE_INSUFFISANT", error: "Solde disponible insuffisant" });
      const ref = String(b.reference).trim().slice(0, 80);
      await query("UPDATE withdrawals SET status = 'paid', reference = $1, paid_by = $2, paid_at = $3 WHERE id = $4", [ref, actor.id, nowSqlUtc(), id]);
      await emitUser(row.user_id, await walletPayload(row.user_id));
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "withdrawals.pay", target: `withdrawal:${id}`, detail: { amount: row.amount, pseudo: row.pseudo, reference: ref }, ip });
      return respond(res, { ok: true, request: { ...Finance.shape(row), status: "paid", reference: ref } });
    }
  }

  /* ---------- Ads / Campaigns ---------- */
  if (parts[0] === "ads") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("campaigns.read"))) return;
      const ads = await all("SELECT * FROM ads ORDER BY position ASC, ordre ASC, id ASC");
      return respond(res, { ads });
    }
    if (method === "POST" && parts.length === 1) {
      if (!(await guard("campaigns.create"))) return;
      const b = await ctx.body();
      const slug = String(b.slug || b.id || "ad-" + Date.now()).trim().slice(0, 60);
      const r = await one(
        "INSERT INTO ads (slug, titre, image, repli, lien, debut, fin, position, actif, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [slug, b.titre || "", b.image || "", b.repli || null, b.lien || null, b.debut || null, b.fin || null, b.position || "accueil", b.actif !== false ? 1 : 0, parseInt(b.ordre, 10) || 0]
      );
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "campaigns.create", target: `ad:${r.id}`, detail: { slug }, ip });
      return respond(res, { ok: true, ad: r });
    }
    if (method === "POST" && parts.length === 2) {
      if (!(await guard("campaigns.edit"))) return;
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      if (Object.keys(b).length === 1 && b.actif !== undefined) {
        await query("UPDATE ads SET actif = $1, updated_at = $2 WHERE id = $3", [b.actif ? 1 : 0, nowSqlUtc(), id]);
      } else {
        await query(
          "UPDATE ads SET titre = COALESCE($1, titre), image = COALESCE($2, image), repli = $3, lien = $4, debut = $5, fin = $6, position = COALESCE($7, position), actif = COALESCE($8, actif), ordre = COALESCE($9, ordre), updated_at = $10 WHERE id = $11",
          [b.titre, b.image, b.repli || null, b.lien || null, b.debut || null, b.fin || null, b.position, b.actif === undefined ? null : (b.actif ? 1 : 0), b.ordre === undefined ? null : (parseInt(b.ordre, 10) || 0), nowSqlUtc(), id]
        );
      }
      const ad = await one("SELECT * FROM ads WHERE id = $1", [id]);
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "campaigns.edit", target: `ad:${id}`, ip });
      return respond(res, { ok: true, ad });
    }
    if (method === "DELETE" && parts.length === 2) {
      if (!(await guard("campaigns.delete"))) return;
      const id = parseInt(parts[1], 10);
      await query("DELETE FROM ads WHERE id = $1", [id]);
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "campaigns.delete", target: `ad:${id}`, ip });
      return respond(res, { ok: true });
    }
  }

  /* ---------- Games, Matches, Disputes, Tournaments, Ranking, Settings ---------- */
  if (parts[0] === "games") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("games.read"))) return;
      return respond(res, { games: await all("SELECT * FROM admin_games ORDER BY status ASC, name ASC") });
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "status") {
      if (!(await guard("games.edit"))) return;
      const b = await ctx.body();
      await query("UPDATE admin_games SET status = $1, updated_at = $2 WHERE slug = $3", [b.status, nowSqlUtc(), parts[1]]);
      return respond(res, { ok: true });
    }
    if (method === "POST" && parts.length === 2) {
      if (!(await guard("games.edit"))) return;
      const b = await ctx.body();
      await query(
        `INSERT INTO admin_games (slug, name, variant, status, duration, ranked, min_elo, rules, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, variant=EXCLUDED.variant, status=EXCLUDED.status,
         duration=EXCLUDED.duration, ranked=EXCLUDED.ranked, min_elo=EXCLUDED.min_elo, rules=EXCLUDED.rules, version=admin_games.version+1, updated_at=EXCLUDED.updated_at`,
        [parts[1], b.name || parts[1], b.variant || null, b.status || "active", parseInt(b.duration, 10) || 30, b.ranked ? 1 : 0, parseInt(b.min_elo, 10) || 0, b.rules || null, nowSqlUtc()]
      );
      return respond(res, { ok: true, game: await one("SELECT * FROM admin_games WHERE slug = $1", [parts[1]]) });
    }
  }

  if (parts[0] === "matches") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("matches.read"))) return;
      const status = url.searchParams.get("status") || "all";
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 200, 1), 500);
      const matches = status === "all"
        ? await all("SELECT g.*, u1.pseudo AS p1_pseudo, u2.pseudo AS p2_pseudo FROM games g LEFT JOIN users u1 ON u1.id=g.player1_id LEFT JOIN users u2 ON u2.id=g.player2_id ORDER BY g.id DESC LIMIT $1", [limit])
        : await all("SELECT g.*, u1.pseudo AS p1_pseudo, u2.pseudo AS p2_pseudo FROM games g LEFT JOIN users u1 ON u1.id=g.player1_id LEFT JOIN users u2 ON u2.id=g.player2_id WHERE g.status = $1 ORDER BY g.id DESC LIMIT $2", [status, limit]);
      return respond(res, { matches });
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "result") {
      if (!(await guard("matches.review"))) return;
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      await query("UPDATE games SET status = $1, reason = $2 WHERE id = $3", [b.decision === "void" ? "cancelled" : "finished", b.reason || "Décision admin", id]);
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "matches.result", target: `match:${id}`, detail: b, ip });
      return respond(res, { ok: true });
    }
  }

  if (parts[0] === "disputes") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("disputes.read"))) return;
      const status = url.searchParams.get("status") || "all";
      const disputes = status === "all"
        ? await all("SELECT d.*, u.pseudo FROM disputes d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 200")
        : await all("SELECT d.*, u.pseudo FROM disputes d LEFT JOIN users u ON u.id=d.user_id WHERE d.status = $1 ORDER BY d.id DESC LIMIT 200", [status]);
      return respond(res, { disputes });
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "resolve") {
      if (!(await guard("disputes.review"))) return;
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      await query("UPDATE disputes SET status = $1, outcome = $2, resolution = $3, resolved_by = $4, resolved_at = $5 WHERE id = $6", [
        b.status || "resolved", b.outcome || "none", b.resolution || null, actor.id, nowSqlUtc(), id,
      ]);
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "disputes.resolve", target: `dispute:${id}`, detail: b, ip });
      return respond(res, { ok: true });
    }
  }

  if (parts[0] === "tournaments") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("tournaments.read"))) return;
      const rows = await all(
        `SELECT t.*, (SELECT COUNT(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id) AS registered
         FROM tournaments t ORDER BY t.starts_at DESC`
      );
      return respond(res, { tournaments: rows.map((t) => ({ ...t, maxPlayers: t.max_players, startsAt: t.starts_at })) });
    }
    if (method === "POST" && parts.length === 1) {
      if (!(await guard("tournaments.create"))) return;
      const b = await ctx.body();
      const row = await one(
        `INSERT INTO tournaments (name, game, format, entry, max_players, status, min_rank, sponsor, starts_at, match_duration_min, interval_min)
         VALUES ($1,$2,$3,$4,$5,'inscriptions',$6,$7,$8,$9,$10) RETURNING *`,
        [b.name, b.game || "Fanorona", b.format || "rapide", parseInt(b.entry, 10) || 0, parseInt(b.maxPlayers || b.max_players, 10) || 8, b.minRank || "Bronze", b.sponsor || null, b.startsAt || b.starts_at || new Date(Date.now() + 86400000).toISOString(), parseInt(b.matchDurationMin, 10) || 5, b.intervalMin !== undefined ? parseInt(b.intervalMin, 10) : 5]
      );
      await emitBroadcast({ type: "tournament_update" });
      return respond(res, { ok: true, tournament: row });
    }
    if (method === "POST" && parts.length === 2) {
      if (!(await guard("tournaments.edit"))) return;
      const id = parseInt(parts[1], 10);
      const b = await ctx.body();
      if (b.action === "cancel") {
        await query("UPDATE tournaments SET status = 'annule' WHERE id = $1", [id]);
        await emitBroadcast({ type: "tournament_update" });
        return respond(res, { ok: true });
      }
      if (b.action === "bracket") {
        await generateBracket(id);
        return respond(res, { ok: true });
      }
      return respond(res, { ok: true });
    }
  }

  if (parts[0] === "ranking" && method === "GET" && parts.length === 1) {
    if (!(await guard("ranking.read"))) return;
    const badges = await all("SELECT * FROM badges ORDER BY min_rank ASC");
    const top = await all("SELECT id, pseudo, elo, wins, losses, province FROM users ORDER BY elo DESC LIMIT 50");
    return respond(res, { badges, top });
  }

  if (parts[0] === "badges") {
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("ranking.read"))) return;
      return respond(res, { badges: await all("SELECT * FROM badges ORDER BY min_rank ASC") });
    }
    if (method === "POST" && parts.length === 1) {
      if (!(await guard("ranking.edit"))) return;
      const b = await ctx.body();
      const list = Array.isArray(b.badges) ? b.badges : [];
      await tx(async (c) => {
        await c.query("DELETE FROM badges");
        for (const bg of list) {
          await c.query("INSERT INTO badges (name, icon, color, ink, min_rank, max_rank) VALUES ($1,$2,$3,$4,$5,$6)", [
            bg.name, bg.icon || "🏅", bg.color || "#8a8fa3", bg.ink || "#525669", parseInt(bg.min_rank ?? bg.min, 10) || 1, bg.max_rank || bg.max || null,
          ]);
        }
      });
      return respond(res, { ok: true, badges: await all("SELECT * FROM badges ORDER BY min_rank ASC") });
    }
  }

  if (parts[0] === "settings") {
    const DEFAULTS = {
      platform_name: { type: "text", value: "D-aôna", label: "Nom de la plateforme" },
      contact: { type: "text", value: "admin@daona.mg", label: "Contact de support" },
      timezone: { type: "text", value: "Indian/Antananarivo", label: "Fuseau horaire" },
      registrations_open: { type: "bool", value: "true", label: "Inscriptions ouvertes" },
      maintenance: { type: "bool", value: "false", label: "Mode maintenance" },
      kyc_face_required: { type: "bool", value: "false", label: "Exiger le scan facial (KYC)" },
    };
    const buildSettings = async () => {
      const rows = await all("SELECT key, value, updated_at FROM platform_settings");
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const out = {};
      for (const [key, def] of Object.entries(DEFAULTS)) {
        const dbKey = key === "maintenance" ? "maintenance_mode" : key;
        const row = byKey.get(key) || byKey.get(dbKey);
        const raw = row ? row.value : def.value;
        out[key] = {
          key,
          label: def.label,
          type: def.type,
          value: def.type === "bool" ? (raw === "1" || raw === "true") : raw,
          updatedAt: row ? row.updated_at : null,
        };
      }
      return out;
    };
    if (method === "GET" && parts.length === 1) {
      if (!(await guard("settings.read"))) return;
      return respond(res, { settings: await buildSettings() });
    }
    if (method === "POST" && parts.length === 1) {
      if (!(await guard("settings.edit"))) return;
      const b = await ctx.body();
      const map = {
        platform_name: b.platformName ?? b.platform_name,
        contact: b.contact,
        timezone: b.timezone,
        registrations_open: b.registrationsOpen ?? b.registrations_open,
        maintenance_mode: b.maintenanceMode ?? b.maintenance_mode ?? b.maintenance,
        kyc_face_required: b.kycFaceRequired ?? b.kyc_face_required,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v === undefined) continue;
        await query(
          "INSERT INTO platform_settings (key, value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at",
          [k, typeof v === "boolean" ? (v ? "true" : "false") : String(v), nowSqlUtc()]
        );
      }
      await query("UPDATE platform_settings SET value = (COALESCE(NULLIF(value,'')::int,0)+1)::text, updated_at = $1 WHERE key = 'revision'", [nowSqlUtc()]);
      await audit({ actorId: actor.id, actorPseudo: actor.pseudo, action: "settings.edit", target: "platform_settings", detail: map, ip });
      return respond(res, { ok: true, settings: await buildSettings() });
    }
  }

  return refuse(res, { status: 404, code: "ROUTE_INCONNUE", error: "Route admin introuvable" });
}

module.exports = { handleAdmin };
