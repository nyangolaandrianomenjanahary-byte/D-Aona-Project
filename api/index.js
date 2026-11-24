/* =========================================================
   D-aôna (Vercel + Supabase) — Point d'entrée Serverless (/api/*)
   ========================================================= */
"use strict";

const { query, one, all, ensureSchema, getDbUrl } = require("./_lib/db");
const { realtimeConfig, emitUser, emitBroadcast, pruneOldEvents } = require("./_lib/realtime");
const Auth = require("./_lib/auth");
const {
  Settings, Badges, PionStyle, Skins, User, Wallet, Finance, Kyc,
  GameRecord, Chat, Friend, FriendRequest, Notification, Tournament, TournamentMatch,
  toIsoUtc, nowSqlUtc,
} = require("./_lib/stores");
const {
  handleRtAction, pollEvents, expireChallenges, generateBracket, walletPayload,
  rehydrateSession, piecesLeftOf,
} = require("./_lib/game_rt");
const { handleAdmin } = require("./_lib/admin");
const DATA = require("../d-aona-server/data");
const { imageMagicOk } = require("../d-aona-server/image");

function respond(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.headers["cf-connecting-ip"] || "";
  const first = String(fwd).split(",")[0].trim();
  return (first || (req.socket && req.socket.remoteAddress) || "inconnu").slice(0, 64);
}

function bearerToken(req) {
  const h = req.headers["authorization"] || "";
  if (!h.startsWith("Bearer ")) return null;
  const raw = h.slice(7).trim();
  return raw || null;
}

async function readBody(req, maxBytes = 64 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > maxBytes) return { __tooLarge: true };
    try { return JSON.parse(req.body || "{}"); } catch (_) { return {}; }
  }
  return new Promise((resolve) => {
    let raw = "";
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        resolve({ __tooLarge: true });
        return;
      }
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (aborted) return;
      try { resolve(JSON.parse(raw || "{}")); } catch (_) { resolve({}); }
    });
    req.on("error", () => { if (!aborted) resolve({}); });
  });
}

async function sanitizeUser(u) {
  const allUsers = await User.listAll();
  const rank = allUsers.findIndex((p) => p.id === u.id) + 1;
  const badge = rank > 0 ? await Badges.forRank(rank) : null;
  return {
    id: u.id, pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses,
    balance: u.balance, bonus_lock: u.bonus_lock, kyc: !!u.kyc,
    province: u.province || "Antananarivo",
    avatar: u.avatar || null,
    bonus_used: !!u.bonus_used,
    withdrawn_today: await Wallet.withdrawnToday(u.id),
    rank: rank || null,
    badge: badge ? { name: badge.name, icon: badge.icon, color: badge.color } : null,
  };
}

async function selfPayload(u) {
  const k = await Kyc.statusOf(u.id);
  const b = await Finance.balanceOf(u.id);
  const complete = !!(u.first_name && u.last_name && u.birth_date && u.phone && u.avatar && u.bio);
  return {
    ...(await sanitizeUser(u)),
    kyc_status: k.status,
    kyc_reason: k.reason || null,
    reserved: b.reserved,
    withdrawable: b.withdrawable,
    phone: u.phone || null,
    first_name: u.first_name || null,
    last_name: u.last_name || null,
    birth_date: u.birth_date || null,
    bio: u.bio || null,
    profile_complete: complete,
  };
}

async function leaderboardForClient() {
  const users = await User.listAll();
  const badges = await Badges.list();
  const badgeOf = (rank) => badges.find((b) => rank >= b.min && rank <= b.max) || badges[badges.length - 1];
  return users.map((u, idx) => {
    const rank = idx + 1;
    const b = badgeOf(rank);
    return {
      id: u.id, pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses,
      province: u.province || "Antananarivo", avatar: u.avatar || null,
      rank, badge: b ? { name: b.name, icon: b.icon, color: b.color } : null,
    };
  });
}

async function tourneysForClient(userId) {
  const list = await Tournament.list();
  const out = [];
  for (const t of list) {
    const regs = await Tournament.getRegistrations(t.id);
    out.push({
      ...t,
      participants: regs.length,
      registeredCount: regs.length,
      registered: regs.some((r) => r.id === userId),
      results: t.results_json ? (() => { try { return JSON.parse(t.results_json); } catch (_) { return null; } })() : null,
    });
  }
  return out;
}

async function adsActive(position) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await all(
    `SELECT slug AS id, titre, image, repli, lien, debut, fin, position, ordre
     FROM ads
     WHERE position = $1 AND actif = 1
       AND (debut IS NULL OR debut = '' OR debut <= $2)
       AND (fin IS NULL OR fin = '' OR fin >= $2)
     ORDER BY ordre ASC, id ASC`,
    [position, today]
  );
  return rows;
}

async function acceptFriendRequest(res, reqId, user) {
  const row = await FriendRequest.get(reqId);
  if (!row) return respond(res, { error: "Demande introuvable" }, 404);
  await FriendRequest.accept(reqId);
  await Friend.add(row.from_id, row.to_id);
  await Friend.add(row.to_id, row.from_id);
  await emitUser(row.from_id, { type: "friend_update" });
  const other = await User.getById(row.from_id === user.id ? row.to_id : row.from_id);
  return respond(res, { ok: true, status: "accepted", friend: other ? { id: other.id, pseudo: other.pseudo, elo: other.elo } : null });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const rawUrl = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const overridePath = rawUrl.searchParams.get("__path");
  const pathname = overridePath ? (overridePath.startsWith("/") ? overridePath : "/" + overridePath) : rawUrl.pathname;
  const method = req.method;

  /* ---------- Health check (avant ensureSchema pour diagnostiquer vite) ---------- */
  if (method === "GET" && pathname === "/api/health") {
    const hasDb = !!getDbUrl();
    if (!hasDb) return respond(res, { ok: false, error: "DATABASE_URL manquante" }, 503);
    try {
      await ensureSchema();
      await one("SELECT 1 AS ok");
      return respond(res, { ok: true, mode: "vercel-supabase", realtime: realtimeConfig().enabled });
    } catch (err) {
      return respond(res, { ok: false, error: err.message }, 500);
    }
  }

  /* ---------- Config publique (même si DB pas encore configurée, renvoie formats) ---------- */
  if (method === "GET" && pathname === "/api/config") {
    const rt = realtimeConfig();
    return respond(res, {
      serverless: true,
      supabaseUrl: rt.enabled ? rt.url : null,
      supabaseAnonKey: rt.enabled ? rt.anonKey : null,
      realtimeEnabled: rt.enabled,
      formats: DATA.FORMATS,
      games: DATA.GAMES_CATALOG,
      provinces: DATA.PROVINCES,
      operators: DATA.OPERATORS,
    });
  }

  try {
    await ensureSchema();

    /* ---------- Avatars stockés en base (/uploads/avatars/avatar_<id>_*.ext) ---------- */
    if (method === "GET" && pathname.startsWith("/uploads/avatars/")) {
      const fname = pathname.slice("/uploads/avatars/".length);
      const m = fname.match(/^avatar_(\d+)_/);
      if (!m) { res.statusCode = 404; return res.end("Not found"); }
      const row = await one("SELECT mime, data_base64 FROM user_avatars WHERE user_id = $1", [parseInt(m[1], 10)]);
      if (!row) { res.statusCode = 404; return res.end("Not found"); }
      res.statusCode = 200;
      res.setHeader("Content-Type", row.mime || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.end(Buffer.from(row.data_base64, "base64"));
    }

    const ip = clientIp(req);
    const isRateLimited = () => {
      const rl = Auth.rateLimit(ip);
      if (rl.allowed) return false;
      respond(res, { error: `Trop de tentatives — réessayez dans ${rl.retryAfter} s.` }, 429);
      return true;
    };

    /* ---------- Routes publiques ---------- */
    if (method === "POST" && (pathname === "/api/auth/login" || pathname === "/api/auth")) {
      if (isRateLimited()) return;
      const payload = await readBody(req, 2048);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await Auth.login({ pseudo: payload.pseudo, password: payload.password, userAgent: req.headers["user-agent"], ip });
      if (!r.ok) return respond(res, { error: r.error, code: r.code }, r.status);
      return respond(res, { token: r.token, expiresAt: r.expiresAt, user: await selfPayload(r.user) });
    }

    if (method === "POST" && pathname === "/api/auth/register") {
      if (isRateLimited()) return;
      if ((await Settings.setting("registrations_open")) === false) {
        return respond(res, { error: "Les inscriptions sont fermées pour le moment", code: "INSCRIPTIONS_FERMEES" }, 403);
      }
      const payload = await readBody(req, 4096);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await Auth.register({
        pseudo: payload.pseudo, password: payload.password,
        province: payload.province, phone: payload.phone, email: payload.email,
        userAgent: req.headers["user-agent"], ip,
      });
      if (!r.ok) return respond(res, { error: r.error, missing: r.missing }, r.status);
      await emitBroadcast({ type: "leaderboard_update" });
      return respond(res, { token: r.token, expiresAt: r.expiresAt, user: await selfPayload(r.user) });
    }

    if (method === "GET" && pathname === "/api/auth/available") {
      if (isRateLimited()) return;
      const pseudo = Auth.normalizePseudo(rawUrl.searchParams.get("pseudo") || "");
      if (!Auth.isValidPseudo(pseudo)) return respond(res, { pseudo, valid: false, available: false });
      return respond(res, { pseudo, valid: true, available: !(await User.getByPseudo(pseudo)) });
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      const raw = bearerToken(req);
      const sess = raw ? await Auth.resolveSession(raw) : null;
      if (!sess) return respond(res, { error: "Session invalide" }, 401);
      await Auth.logout(raw, { userId: sess.userId, ip, userAgent: req.headers["user-agent"] });
      return respond(res, { ok: true });
    }

    if (method === "GET" && pathname === "/api/ads/active") {
      const position = rawUrl.searchParams.get("position") === "profil" ? "profil" : "accueil";
      return respond(res, { pubs: await adsActive(position) });
    }

    /* ---------- Authentification requise ---------- */
    const rawTok = bearerToken(req);
    const sess = rawTok ? await Auth.resolveSession(rawTok) : null;
    const userId = sess ? sess.userId : null;
    const user = userId ? await User.getById(userId) : null;
    if (!userId) return respond(res, { error: "Non authentifié" }, 401);
    if (!user) return respond(res, { error: "Utilisateur introuvable" }, 404);

    /* ---------- Back-office Admin ---------- */
    if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
      return handleAdmin(req, res, pathname, rawUrl, {
        userId,
        user,
        ip,
        body: () => readBody(req, 512 * 1024),
      });
    }

    /* ---------- Temps réel HTTP + Poll ---------- */
    if (method === "POST" && pathname === "/api/rt") {
      const payload = await readBody(req, 64 * 1024);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await handleRtAction(user, payload);
      return respond(res, r, r.status || 200);
    }

    if (method === "GET" && pathname === "/api/rt/poll") {
      if (Math.random() < 0.05) pruneOldEvents();
      const since = rawUrl.searchParams.get("since") || "0";
      const out = await pollEvents(user.id, since);
      return respond(res, out);
    }

    /* ---------- Mot de passe ---------- */
    if (method === "POST" && pathname === "/api/auth/password") {
      if (isRateLimited()) return;
      const payload = await readBody(req, 2048);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await Auth.changePassword(user.id, payload.currentPassword, payload.newPassword, {
        ip, userAgent: req.headers["user-agent"],
      });
      if (!r.ok) return respond(res, { error: r.error, missing: r.missing }, r.status);
      return respond(res, { ok: true, revokedSessions: r.revokedSessions, mustReconnect: true });
    }

    /* ---------- Profil & User ---------- */
    if (method === "GET" && pathname === "/api/user") {
      return respond(res, {
        user: await selfPayload(user),
        transactions: await Wallet.getTransactions(user.id),
        withdrawal: await Finance.openRequest(user.id),
      });
    }

    if (method === "POST" && pathname === "/api/user/avatar") {
      const payload = await readBody(req, 4 * 1024 * 1024);
      if (payload.__tooLarge) return respond(res, { error: "Image trop lourde (max 2 Mo)" }, 413);
      const dataUrl = payload.avatar || "";
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
      if (!m) return respond(res, { error: "Format image invalide (base64 attendu)" }, 400);
      const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 2 * 1024 * 1024) return respond(res, { error: "Image trop lourde (max 2 Mo)" }, 400);
      if (!imageMagicOk(buf, ext)) return respond(res, { error: "Le contenu de l'image ne correspond pas au format déclaré" }, 400);
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
      await query(
        `INSERT INTO user_avatars (user_id, mime, data_base64, updated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET mime=EXCLUDED.mime, data_base64=EXCLUDED.data_base64, updated_at=EXCLUDED.updated_at`,
        [user.id, mime, m[2], nowSqlUtc()]
      );
      const avatarUrl = `/uploads/avatars/avatar_${user.id}_${Date.now()}.${ext}`;
      await User.update(user.id, { avatar: avatarUrl });
      return respond(res, { ok: true, avatar: avatarUrl });
    }

    if (method === "POST" && pathname === "/api/user/profile") {
      const payload = await readBody(req, 8 * 1024);
      const clean = (v) => (typeof v === "string" ? v.trim() : v === null ? "" : undefined);
      const fields = {};
      const NAME_RE = /^[\p{L}][\p{L}\p{M}'’.\- ]{1,59}$/u;
      for (const key of ["first_name", "last_name"]) {
        const v = clean(payload[key]);
        if (v === undefined) continue;
        if (!NAME_RE.test(v)) return respond(res, { error: "Nom et prénom : 2 à 60 lettres, conformes au CIN.", field: key }, 400);
        fields[key] = v;
      }
      if (payload.birth_date !== undefined) {
        const v = String(clean(payload.birth_date) || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return respond(res, { error: "Date de naissance attendue au format AAAA-MM-JJ.", field: "birth_date" }, 400);
        const d = new Date(v + "T00:00:00Z");
        const age = (new Date() - d) / (365.25 * 24 * 3600 * 1000);
        if (isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d > new Date() || age < 13 || age > 120) {
          return respond(res, { error: "Date de naissance invalide (conforme au CIN).", field: "birth_date" }, 400);
        }
        fields.birth_date = v;
      }
      if (payload.bio !== undefined) {
        const v = String(clean(payload.bio) || "");
        if (!v) return respond(res, { error: "La bio est obligatoire.", field: "bio" }, 400);
        if (v.length > 160) return respond(res, { error: "Bio : 160 caractères maximum.", field: "bio" }, 400);
        fields.bio = v;
      }
      if (payload.phone !== undefined) {
        const v = String(clean(payload.phone) || "").replace(/[\s.\-]/g, "");
        if (!/^03\d{8}$/.test(v) && !/^\+2613\d{8}$/.test(v)) {
          return respond(res, { error: "Numéro invalide (ex. 034 12 345 67).", field: "phone" }, 400);
        }
        fields.phone = v;
      }
      if (!Object.keys(fields).length) return respond(res, { error: "Aucun champ à enregistrer." }, 400);
      try {
        await User.update(user.id, fields);
      } catch (e) {
        if (e && e.code === "23505") return respond(res, { error: "Ce numéro de téléphone est déjà utilisé.", field: "phone" }, 409);
        throw e;
      }
      return respond(res, { ok: true, user: await selfPayload(await User.getById(user.id)) });
    }

    /* ---------- Tournois ---------- */
    if (method === "GET" && pathname === "/api/tournaments") {
      return respond(res, { tournaments: await tourneysForClient(user.id) });
    }

    if (method === "POST" && pathname === "/api/tournaments/join") {
      const payload = await readBody(req);
      const t = await Tournament.get(parseInt(payload.tournamentId, 10));
      if (!t) return respond(res, { error: "Tournoi introuvable" }, 404);
      if (await Tournament.isRegistered(user.id, t.id)) return respond(res, { error: "Deja inscrit" }, 400);
      if (t.starts_at && new Date(t.starts_at).getTime() <= Date.now()) return respond(res, { error: "Tournoi déjà commencé" }, 400);
      const countRow = await one("SELECT COUNT(*)::int AS c FROM tournament_registrations WHERE tournament_id = $1", [t.id]);
      if ((countRow ? countRow.c : 0) >= t.max_players) return respond(res, { error: "Tournoi complet" }, 400);
      if (user.balance < t.entry) return respond(res, { error: "Solde insuffisant" }, 400);
      if (t.entry > 0 && !user.kyc) return respond(res, { error: "KYC requis" }, 403);
      await Tournament.register(user.id, t.id);
      if (t.entry > 0) await Wallet.grantWelcome(user.id);
      await Wallet.spend(user.id, t.entry, `Mise entrée - ${t.name}`);
      await emitUser(user.id, await walletPayload(user.id));
      await Notification.create(user.id, "inscription", { text: `✅ Inscrit au tournoi « ${t.name} »`, tournamentId: t.id, startsAt: t.starts_at });
      const newCount = await one("SELECT COUNT(*)::int AS c FROM tournament_registrations WHERE tournament_id = $1", [t.id]);
      if ((newCount ? newCount.c : 0) >= t.max_players) {
        await query("UPDATE tournaments SET status = 'en_cours' WHERE id = $1 AND status = 'inscriptions'", [t.id]);
        await generateBracket(t.id);
      }
      await emitBroadcast({ type: "tournament_update" });
      return respond(res, { ok: true });
    }

    if (method === "GET" && pathname === "/api/tournaments/my") {
      const regs = await all(
        "SELECT t.* FROM tournaments t JOIN tournament_registrations r ON r.tournament_id = t.id WHERE r.user_id = $1 ORDER BY t.starts_at ASC",
        [user.id]
      );
      const mine = [];
      for (const t of regs) {
        const matches = await TournamentMatch.listByTournament(t.id);
        const myMatches = matches.filter((m) => m.p1_id === user.id || m.p2_id === user.id);
        const played = myMatches.filter((m) => m.status === "termine" || m.status === "forfait").length;
        const next = myMatches.find((m) => m.status === "a_venir" || m.status === "confirmation");
        const won = myMatches.filter((m) => m.winner_id === user.id).length;
        mine.push({
          id: t.id, name: t.name, status: t.status, format: t.format, starts_at: t.starts_at,
          max_players: t.max_players, matchesPlayed: played, matchesTotal: myMatches.length, matchesWon: won,
          nextMatch: next ? {
            id: next.id, round: next.round, starts_at: next.starts_at,
            opponent: next.p1_id === user.id ? next.p2_pseudo : next.p1_pseudo,
            opponentId: next.p1_id === user.id ? next.p2_id : next.p1_id,
            status: next.status,
            confirmed: next.p1_id === user.id ? !!next.confirmed_p1 : !!next.confirmed_p2,
            confirm_deadline: next.confirm_deadline,
          } : null,
        });
      }
      return respond(res, { tournaments: mine });
    }

    if (method === "GET" && /^\/api\/tournaments\/\d+$/.test(pathname)) {
      const id = parseInt(pathname.split("/")[3], 10);
      const t = await Tournament.get(id);
      if (!t) return respond(res, { error: "Tournoi introuvable" }, 404);
      const regs = await Tournament.getRegistrations(id);
      const matches = await TournamentMatch.listByTournament(id);
      return respond(res, {
        tournament: { ...t, participants: regs.length, registeredCount: regs.length },
        registrations: regs, matches, meRegistered: regs.some((r) => r.id === user.id),
      });
    }

    if (method === "POST" && /^\/api\/tournaments\/\d+\/confirm$/.test(pathname)) {
      const tid = parseInt(pathname.split("/")[3], 10);
      const matches = await TournamentMatch.listByTournament(tid);
      const myNext = matches.find((m) => (m.p1_id === user.id || m.p2_id === user.id) && (m.status === "confirmation" || m.status === "a_venir"));
      if (!myNext) return respond(res, { error: "Aucun match à confirmer" }, 404);
      if (myNext.confirm_deadline && new Date() > new Date(myNext.confirm_deadline)) {
        return respond(res, { error: "Fenêtre de confirmation fermée — forfait automatique" }, 400);
      }
      await TournamentMatch.confirm(myNext.id, myNext.p1_id === user.id ? 1 : 2);
      await Notification.create(user.id, "confirmation", { text: `Présence confirmée pour le match #${myNext.id}`, tournamentId: tid });
      return respond(res, { ok: true });
    }

    /* ---------- Classement ---------- */
    if (method === "GET" && pathname === "/api/leaderboard") {
      return respond(res, { leaderboard: await leaderboardForClient() });
    }

    /* ---------- Skins & PionStyle ---------- */
    if (method === "GET" && pathname === "/api/skins") {
      const styles = await PionStyle.get(user.id);
      return respond(res, {
        skins: DATA.SKINS_CATALOG,
        owned: await Skins.listOwned(user.id),
        equipped: await Skins.getEquipped(user.id),
        colors: DATA.PION_COLORS,
        groups: DATA.PION_GROUPS,
        patterns: DATA.PION_PATTERNS,
        shapes: DATA.PION_SHAPES,
        camps: DATA.PION_CAMPS,
        pionStyles: styles,
        pionStyle: styles.light,
      });
    }

    if (method === "POST" && pathname === "/api/pion/style") {
      const payload = await readBody(req);
      const camp = (payload.camp === undefined || payload.camp === null || payload.camp === "")
        ? DATA.PION_DEFAULT_CAMP : String(payload.camp).toLowerCase();
      if (!DATA.pionCamp(camp)) return respond(res, { error: "Camp de pions inconnu" }, 400);
      if (!DATA.pionColor(payload.color)) return respond(res, { error: "Couleur de pion inconnue" }, 400);
      if (!DATA.pionColorFitsCamp(payload.color, camp)) return respond(res, { error: "Couleur incompatible avec ce camp de pions" }, 400);
      const pattern = (payload.pattern === undefined || payload.pattern === null || payload.pattern === "") ? "aucun" : payload.pattern;
      if (!DATA.pionPattern(pattern)) return respond(res, { error: "Motif de pion inconnu" }, 400);
      const shape = (payload.shape === undefined || payload.shape === null || payload.shape === "") ? null : String(payload.shape).toLowerCase();
      if (shape && !DATA.pionShape(shape)) return respond(res, { error: "Forme de pion inconnue" }, 400);
      await PionStyle.set(user.id, camp, payload.color, pattern, shape);
      const styles = await PionStyle.get(user.id);
      return respond(res, { ok: true, camp, pionStyles: styles, pionStyle: styles.light });
    }

    if (method === "POST" && pathname === "/api/skins/buy") {
      const payload = await readBody(req);
      const sk = DATA.SKINS_CATALOG.find((s) => s.id === payload.skinId);
      if (!sk) return respond(res, { error: "Skin introuvable" }, 404);
      if ((await Skins.listOwned(user.id)).includes(sk.id)) return respond(res, { error: "Skin deja possede" }, 400);
      if (sk.price && sk.price > 0) {
        const dispo = (await Finance.balanceOf(user.id)).withdrawable;
        if (dispo < sk.price) return respond(res, { error: "Solde insuffisant" }, 400);
        await Wallet.spend(user.id, sk.price, `Achat ${sk.name}`);
      }
      await Skins.buy(user.id, sk.id);
      const bal = await Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: bal.balance });
    }

    if (method === "POST" && pathname === "/api/skins/equip") {
      const payload = await readBody(req);
      const sk = DATA.SKINS_CATALOG.find((s) => s.id === payload.skinId);
      if (!sk) return respond(res, { error: "Skin introuvable" }, 404);
      if (!DATA.skinSlotMatches(sk, payload.slot || payload.type)) return respond(res, { error: "Skin incompatible avec ce type de pion" }, 400);
      const slot = DATA.skinSlot(sk);
      if (!slot) return respond(res, { error: "Skin non equipable" }, 400);
      if (!(await Skins.listOwned(user.id)).includes(sk.id)) return respond(res, { error: "Skin non possede" }, 403);
      const r = await Skins.equip(user.id, slot, sk.id);
      if (!r.ok) return respond(res, { error: r.error }, 400);
      return respond(res, { ok: true, slot, equipped: await Skins.getEquipped(user.id) });
    }

    /* ---------- Transactions & Wallet ---------- */
    if (method === "GET" && pathname === "/api/transactions") {
      const w = (k) => rawUrl.searchParams.get(k);
      const result = await Wallet.history(user.id, {
        page: w("page"), size: w("size"), period: w("period"), from: w("from"),
        to: w("to"), kind: w("kind"), q: w("q"), method: w("method"),
        status: w("status"), sort: w("sort"),
      });
      return respond(res, { transactions: result.items, total: result.total, page: result.page, size: result.size });
    }

    if (method === "GET" && pathname === "/api/transactions/export") {
      const w = (k) => rawUrl.searchParams.get(k);
      const { items } = await Wallet.history(user.id, {
        size: "all", period: w("period"), from: w("from"), to: w("to"),
        kind: w("kind"), q: w("q"), method: w("method"), status: w("status"), sort: w("sort"),
      });
      const slug = String(user.pseudo || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="d-aona-transactions${slug ? "-" + slug : ""}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      return res.end(DATA.txCsv(items));
    }

    if (method === "POST" && pathname === "/api/deposit") {
      const payload = await readBody(req);
      await Wallet.grantWelcome(user.id);
      const depAmount = parseInt(payload.amount, 10);
      if (Number.isFinite(depAmount) && depAmount < 0) return respond(res, { error: "Montant invalide" }, 400);
      await Wallet.credit(user.id, (Number.isFinite(depAmount) && depAmount !== 0) ? depAmount : 5000, `Dépôt ${String(payload.operator || "MVola").slice(0, 40)}`);
      const bal = await Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: bal.balance, bonusLock: bal.bonus_lock });
    }

    if (method === "POST" && pathname === "/api/withdraw") {
      const payload = await readBody(req);
      const r = await Finance.create(user.id, payload);
      if (!r.ok) return respond(res, { error: r.error, code: r.code }, r.status);
      const b = await Finance.balanceOf(user.id);
      return respond(res, { ok: true, request: r.request, ...b });
    }

    /* ---------- Chat & Amis ---------- */
    if (method === "GET" && pathname === "/api/chat/contacts") {
      const contacts = await Chat.getContacts(user.id);
      const cutoff = new Date(Date.now() - 120000).toISOString();
      const onlineRows = await all("SELECT id, pseudo FROM users WHERE id <> $1 AND last_seen >= $2 LIMIT 50", [user.id, cutoff]);
      return respond(res, { contacts, onlineUsers: onlineRows.map((u) => ({ id: u.id, pseudo: u.pseudo, online: true })) });
    }

    if (method === "GET" && pathname.startsWith("/api/chat/")) {
      const otherPseudo = decodeURIComponent(pathname.slice(10));
      const other = await User.getByPseudo(otherPseudo);
      if (!other) return respond(res, { error: "Utilisateur introuvable" }, 404);
      return respond(res, { messages: await Chat.getThread(user.id, other.id) });
    }

    if (method === "GET" && pathname === "/api/friends") {
      const friends = await Friend.list(user.id);
      const cutoff = new Date(Date.now() - 120000).toISOString();
      const recentRows = await all("SELECT id FROM users WHERE last_seen >= $1", [cutoff]);
      const online = new Set(recentRows.map((r) => r.id));
      return respond(res, {
        friends: friends.map((f) => ({ ...f, online: online.has(f.id) })),
        incoming: await FriendRequest.incoming(user.id),
        outgoing: await FriendRequest.outgoing(user.id),
        newIncoming: await FriendRequest.newIncoming(user.id),
        newSinceId: await FriendRequest.incomingWatermark(user.id),
      });
    }

    if (method === "POST" && pathname === "/api/friends/seen") {
      const w = await FriendRequest.markSeen(user.id);
      return respond(res, { ok: true, newIncoming: 0, newSinceId: w.seen });
    }

    if (method === "POST" && pathname === "/api/friends/request") {
      const payload = await readBody(req);
      const target = await User.getByPseudo((payload.pseudo || "").trim());
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      const pending = await FriendRequest.pendingBetween(user.id, target.id);
      if (pending && pending.direction === "incoming") return acceptFriendRequest(res, pending.id, user);
      const r = await FriendRequest.send(user.id, target.id);
      if (!r.ok) return respond(res, { error: r.error }, 400);
      await emitUser(target.id, { type: "friend_request", id: r.id, from: user.pseudo, fromElo: user.elo });
      return respond(res, { ok: true, requestId: r.id, status: "sent" });
    }

    if (method === "POST" && pathname === "/api/friends/respond") {
      const payload = await readBody(req);
      const reqRow = await FriendRequest.get(parseInt(payload.id, 10));
      if (!reqRow) return respond(res, { error: "Demande introuvable" }, 404);
      if (reqRow.to_id !== user.id) return respond(res, { error: "Non autorisé" }, 403);
      if (reqRow.status !== "pending") return respond(res, { error: "Demande déjà traitée" }, 400);
      if (payload.action === "decline") {
        await FriendRequest.decline(reqRow.id);
        const from = await User.getById(reqRow.from_id);
        await emitUser(reqRow.from_id, { type: "friend_update" });
        return respond(res, { ok: true, status: "declined", from: from ? from.pseudo : null });
      }
      if (payload.action === "accept") return acceptFriendRequest(res, reqRow.id, user);
      return respond(res, { error: "Action invalide" }, 400);
    }

    if (method === "POST" && pathname === "/api/friends") {
      const payload = await readBody(req);
      const target = await User.getByPseudo((payload.pseudo || "").trim());
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      const pending = await FriendRequest.pendingBetween(user.id, target.id);
      if (pending && pending.direction === "incoming") return acceptFriendRequest(res, pending.id, user);
      const r = await FriendRequest.send(user.id, target.id);
      if (!r.ok) return respond(res, { error: r.error }, 400);
      await emitUser(target.id, { type: "friend_request", id: r.id, from: user.pseudo, fromElo: user.elo });
      return respond(res, { ok: true, requestId: r.id, status: "sent" });
    }

    if (method === "DELETE" && pathname.startsWith("/api/friends/")) {
      const pseudo = decodeURIComponent(pathname.slice("/api/friends/".length));
      const target = await User.getByPseudo(pseudo);
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      await Friend.remove(user.id, target.id);
      return respond(res, { ok: true });
    }

    if (method === "GET" && pathname === "/api/users/search") {
      const q = (rawUrl.searchParams.get("q") || "").trim().slice(0, 20);
      if (!q) return respond(res, { users: [] });
      const users = await Friend.search(user.id, q);
      const friends = new Set((await Friend.list(user.id)).map((f) => f.id));
      const sentTo = new Set((await FriendRequest.outgoing(user.id)).map((r) => r.to_id));
      return respond(res, { users: users.map((u) => ({ ...u, isFriend: friends.has(u.id), requestSent: sentTo.has(u.id) })) });
    }

    if (method === "GET" && /^\/api\/users\/\d+$/.test(pathname)) {
      const targetId = parseInt(pathname.split("/").pop(), 10);
      const target = await User.getById(targetId);
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      const friends = new Set((await Friend.list(user.id)).map((f) => f.id));
      const t = await sanitizeUser(target);
      delete t.balance; delete t.bonus_lock; delete t.bonus_used; delete t.withdrawn_today; delete t.kyc;
      const pending = await FriendRequest.pendingBetween(user.id, target.id);
      const friendStatus = friends.has(target.id) ? "friends"
        : pending ? (pending.direction === "outgoing" ? "sent" : "received") : "none";
      return respond(res, {
        user: {
          ...t, isFriend: friends.has(target.id), friendStatus,
          requestId: pending && pending.direction === "incoming" ? pending.id : null,
          online: target.last_seen ? (Date.now() - new Date(target.last_seen).getTime() < 120000) : false,
        },
        games: (await GameRecord.listForUser(target.id)).slice(0, 20),
      });
    }

    /* ---------- Parties & Défis ---------- */
    if (method === "GET" && pathname === "/api/games/history") {
      return respond(res, { games: await GameRecord.listForUser(user.id) });
    }

    if (method === "GET" && pathname === "/api/games/live") {
      const scope = rawUrl.searchParams.get("scope") === "all" ? "all" : "contacts";
      const known = new Set();
      if (scope === "contacts") {
        (await Friend.list(user.id)).forEach((f) => known.add(f.id));
        (await Chat.getContacts(user.id)).forEach((c) => known.add(c.id));
      }
      const rows = await all("SELECT * FROM game_sessions WHERE status = 'playing' AND mode <> 'ai' ORDER BY updated_at DESC LIMIT 60");
      const live = [];
      for (const row of rows) {
        const s = rehydrateSession(row);
        if (!s || s.over || !s.player1.id || !s.player2 || !s.player2.id) continue;
        if (scope === "contacts" && !known.has(s.player1.id) && !known.has(s.player2.id)) continue;
        live.push({
          sessionId: s.sessionId, game: s.game, mode: s.mode, format: s.format.id, wager: s.wager,
          player1: { id: s.player1.id, pseudo: s.player1.pseudo, elo: s.player1.elo },
          player2: { id: s.player2.id, pseudo: s.player2.pseudo, elo: s.player2.elo },
          moves: (s.moves || []).length, phase: s.phase,
          pieces1: piecesLeftOf(s, 1), pieces2: piecesLeftOf(s, 2),
        });
      }
      return respond(res, { live, scope });
    }

    if (method === "GET" && pathname === "/api/challenges") {
      await expireChallenges();
      const { Challenge } = require("./_lib/stores");
      const strip = (c) => ({
        id: c.id, wager: c.wager, format: c.format, game: c.game, status: c.status,
        createdAt: toIsoUtc(c.created_at), expiresAt: toIsoUtc(c.expires_at),
        fromId: c.from_id, toId: c.to_id,
        fromPseudo: c.from_pseudo, fromElo: c.from_elo, fromAvatar: c.from_avatar || null,
        toPseudo: c.to_pseudo, toElo: c.to_elo, toAvatar: c.to_avatar || null,
      });
      return respond(res, {
        received: (await Challenge.getByUser(user.id)).map(strip),
        sent: (await Challenge.listSent(user.id)).map(strip),
      });
    }

    /* ---------- KYC ---------- */
    if (method === "POST" && pathname === "/api/kyc/verify") {
      return respond(res, {
        error: "La vérification immédiate n'existe plus : envoyez le recto ET le verso, un administrateur validera votre dossier.",
        code: "KYC_SUBMIT_REQUIRED",
      }, 410);
    }

    if (method === "POST" && pathname === "/api/kyc/submit") {
      const payload = await readBody(req, 6 * 1024 * 1024);
      if (payload.__tooLarge) return respond(res, { error: "Images trop lourdes (2 Mo maximum par face)" }, 413);
      const r = await Kyc.submit(user.id, payload);
      if (!r.ok) return respond(res, { error: r.error, code: r.code }, r.status);
      return respond(res, { ok: true, kyc_status: "pending", submitted_at: r.submitted_at, caseId: r.caseId });
    }

    /* ---------- Notifications ---------- */
    if (method === "GET" && pathname === "/api/notifications") {
      return respond(res, {
        notifications: await Notification.list(user.id),
        unread: await Notification.unreadCount(user.id),
      });
    }

    if (method === "POST" && /^\/api\/notifications\/\d+\/read$/.test(pathname)) {
      const id = parseInt(pathname.split("/")[3], 10);
      await Notification.markRead(id, user.id);
      return respond(res, { ok: true, unread: await Notification.unreadCount(user.id) });
    }

    if (method === "POST" && pathname === "/api/notifications/read-all") {
      await Notification.markAllRead(user.id);
      return respond(res, { ok: true, unread: 0 });
    }

    return respond(res, { error: "Route introuvable", path: pathname }, 404);
  } catch (err) {
    console.error("[api] erreur:", err);
    return respond(res, { error: err.message || "Erreur interne serveur" }, 500);
  }
};
