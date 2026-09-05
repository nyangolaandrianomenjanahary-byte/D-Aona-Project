/* =========================================================
   D-aôna — Serveur principal (HTTP + WebSocket + API)
   Héberge l'app frontend + serveur multijoueur temps réel.
   Écoute sur 0.0.0.0:8080 pour accès réseau local.
   ========================================================= */
"use strict";

const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const WebSocket = require("ws");

const { db, User, GameRecord, Tournament, Wallet, Chat, Skins, Challenge, GameSessionStore, Friend, FriendRequest, applyInactivityDecay } = require("./db");
const { GameSession, computeEloDelta, legalMoves, checkWin, countPieces, initialGrid } = require("./game");
const DATA = require("./data");

const PORT = 8080;
const ROOT = path.resolve(__dirname, "../D-aona/d-aona-web");
const TICK_MS = 1000;

/* ---------- State serveur (in-memory) ---------- */
const tokens = new Map();          // token -> userId
const connections = new Map();     // ws -> { userId, pseudo }
const userSockets = new Map();     // userId -> ws
const sessions = new Map();        // sessionId -> GameSession (engine)
const spectators = new Map();      // sessionId -> Set<userId> (spectateurs du match)
/* Délai de grâce avant abandon sur déconnexion : une coupure WebSocket
   (souvent un simple blip du tunnel) ne doit PAS compter comme un abandon immédiat. */
const GRACE_MS = 20000;
const disconnectTimers = new Map(); // userId -> { timer, sessionId }
const mmQueues = { blitz: [], rapide: [], pro: [] };
const pendingMatches = new Map();  // key -> { p1, p2, p1Ready, p2Ready, format }
const aiTimers = new Map();        // sessionId -> timer

/* ---------- Utilitaires ---------- */
function genToken() { return crypto.randomBytes(32).toString("hex"); }
function send(ws, msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function sendUser(userId, msg) { const ws = userSockets.get(userId); if (ws) send(ws, msg); }
function broadcast(msg, exceptId = null) {
  for (const [uid, ws] of userSockets) { if (uid !== exceptId && ws.readyState === WebSocket.OPEN) send(ws, msg); }
}
function sanitizeUser(u) {
  const all = User.listAll();
  const rank = all.findIndex((p) => p.id === u.id) + 1;
  const badge = rank > 0 ? DATA.badgeFor(rank) : null;
  return { id: u.id, pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses,
    balance: u.balance, bonus_lock: u.bonus_lock, kyc: !!u.kyc, province: u.province || "Antananarivo",
    avatar: u.avatar || null,
    bonus_used: !!u.bonus_used, withdrawn_today: u.withdrawn_today || 0,
    rank: rank || null,
    badge: badge ? { name: badge.name, icon: badge.icon, color: badge.color } : null };
}

/* ---------- Seed de la base ---------- */
function seedDatabase() {
  // 1. Seed all reference users FIRST (so tournament registrations can find them)
  const seen = new Set();
  const allPlayers = [];
  for (const p of [...DATA.LEADERBOARD_POOL, ...DATA.OPPONENT_POOL]) {
    if (seen.has(p.pseudo)) continue;
    seen.add(p.pseudo);
    allPlayers.push(p);
  }
  for (const p of allPlayers) {
    const user = User.createOrUpdate(p.pseudo);
    const province = p.province && DATA.PROVINCES.includes(p.province) ? p.province
      : DATA.PROVINCES[user.id % DATA.PROVINCES.length];
    db.prepare("UPDATE users SET elo = ?, wins = ?, losses = ?, balance = 5000, province = ? WHERE id = ?")
      .run(p.elo, p.wins || 0, (p.games || 0) - (p.wins || 0), province, user.id);
  }
  // 2. Seed tournaments (registrations will now find existing users)
  Tournament.seed();
  // 3. Pénalité d'inactivité (−30 Elo / mois après 30 j) puis vérification quotidienne
  applyInactivityDecay();
  setInterval(applyInactivityDecay, 24 * 3600 * 1000).unref();
}

/* ---------- Tournament data for client ---------- */
function tourneysForClient(userId) {
  const rows = Tournament.list();
  return rows.map((t) => {
    const regCount = db.prepare("SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ?").get(t.id).c;
    const isReg = userId ? !!Tournament.isRegistered(userId, t.id) : false;
    const startsInSec = t.starts_at ? Math.floor((new Date(t.starts_at) - Date.now()) / 1000) : 0;
    const regs = Tournament.getRegistrations(t.id);
    return {
      id: String(t.id), name: t.name, game: t.game, format: t.format,
      entry: t.entry, maxPlayers: t.max_players, status: t.status,
      minRank: t.min_rank, sponsor: t.sponsor,
      startsInSec: t.status === "inscriptions" ? startsInSec : (t.status === "termine" ? -1 : startsInSec),
      registered: regs.map((r) => r.pseudo), registeredCount: regCount, isRegistered: isReg,
      results: t.results_json ? JSON.parse(t.results_json) : null,
    };
  });
}
/* ---------- Acceptation d'une demande d'ami ----------
   Crée l'amitié dans les DEUX sens, puis envoie le message automatique
   « D-aona » de la part du joueur qui accepte vers celui qui a envoyé. */
function acceptFriendRequest(res, requestId, acceptingUser) {
  const reqRow = FriendRequest.get(requestId);
  if (!reqRow || reqRow.status !== "pending") return respond(res, { error: "Demande déjà traitée" }, 400);
  if (reqRow.to_id !== acceptingUser.id) return respond(res, { error: "Non autorisé" }, 403);
  const sender = User.getById(reqRow.from_id);
  if (!sender) return respond(res, { error: "Joueur introuvable" }, 404);
  FriendRequest.accept(requestId);
  Friend.add(acceptingUser.id, sender.id);
  Friend.add(sender.id, acceptingUser.id);
  // Message automatique « D-aona » : envoyé par celui qui accepte → celui qui a demandé
  const autoText = "D-aona ! 🤝 J'ai accepté ta demande d'ami — on se fait une partie ?";
  Chat.saveMessage(acceptingUser.id, sender.id, autoText);
  const at = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  sendUser(sender.id, { type: "chat_message", from: acceptingUser.pseudo, text: autoText, at });
  sendUser(sender.id, { type: "friend_update" });
  sendUser(acceptingUser.id, { type: "friend_update" });
  return respond(res, { ok: true, status: "accepted", friend: { id: sender.id, pseudo: sender.pseudo, elo: sender.elo } });
}

function leaderboardForClient(userId) {
  return User.listAll().map((p, i) => {
    const rank = i + 1;
    const badge = DATA.badgeFor(rank);
    return {
      rank, id: p.id, pseudo: p.pseudo, elo: p.elo, wins: p.wins,
      games: p.wins + p.losses, province: p.province || "Antananarivo", me: p.id === userId,
      avatar: p.avatar || null,
      badge: { name: badge.name, icon: badge.icon, color: badge.color },
    };
  });
}

/* ---------- Static file serving ---------- */
const MIME = { ".html":"text/html",".css":"text/css",".js":"application/javascript",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".svg":"image/svg+xml",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2",".txt":"text/plain" };
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/" || urlPath === "/index.html") urlPath = "/index.html";
  // Servir les uploads (avatars) depuis le dossier du serveur
  let filePath;
  if (urlPath.startsWith("/uploads/")) {
    filePath = path.normalize(path.join(__dirname, urlPath));
    if (!filePath.startsWith(path.join(__dirname, "uploads"))) { res.writeHead(403); res.end("Forbidden"); return; }
  } else {
    filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (e, data) => {
      if (e) { res.writeHead(500); res.end("Error"); return; }
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
}

/* ---------- REST API ---------- */
function authMiddleware(req) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  return tokens.get(header.slice(7)) || null;
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => data += c);
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
  });
}
function respond(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}

function handleRest(req, res, url, userId) {
  const method = req.method;
  const pathname = url.pathname;
  const user = userId ? User.getById(userId) : null;

  (async () => {
    // POST /api/auth (no auth required)
    if (method === "POST" && pathname === "/api/auth") {
      const payload = await readBody(req);
      const pseudo = (payload.pseudo || "").trim().slice(0, 14).replace(/<[^>]*>/g, "");
      if (!pseudo) return respond(res, { error: "Pseudo requis" }, 400);
      const u = User.createOrUpdate(pseudo);
      const token = genToken();
      tokens.set(token, u.id);
      return respond(res, { token, user: sanitizeUser(u) });
    }

    if (!userId) return respond(res, { error: "Non authentifié" }, 401);
    if (!user) return respond(res, { error: "Utilisateur introuvable" }, 404);

    // GET /api/user
    if (method === "GET" && pathname === "/api/user")
      return respond(res, { user: sanitizeUser(user), transactions: Wallet.getTransactions(user.id) });

    // GET /api/tournaments
    if (method === "GET" && pathname === "/api/tournaments")
      return respond(res, { tournaments: tourneysForClient(user.id) });

    // POST /api/tournaments/join
    if (method === "POST" && pathname === "/api/tournaments/join") {
      const payload = await readBody(req);
      const t = Tournament.get(parseInt(payload.tournamentId));
      if (!t) return respond(res, { error: "Tournoi introuvable" }, 404);
      if (Tournament.isRegistered(user.id, t.id)) return respond(res, { error: "Deja inscrit" }, 400);
      const userRank = DATA.rankFor(user.elo);
      const tRank = DATA.RANKS.find((r) => r.name === t.min_rank);
      if (!tRank || DATA.RANKS.indexOf(userRank) < DATA.RANKS.indexOf(tRank))
        return respond(res, { error: `Rang ${t.min_rank} requis` }, 403);
      const count = db.prepare("SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ?").get(t.id).c;
      if (count >= t.max_players) return respond(res, { error: "Tournoi complet" }, 400);
      if (user.balance < t.entry) return respond(res, { error: `Solde insuffisant` }, 400);
      if (t.entry > 0 && !user.kyc) return respond(res, { error: "KYC requis" }, 403);
      Tournament.register(user.id, t.id);
      if (!user.bonus_used && t.entry > 0) {
        User.update(user.id, { bonus_used: true });
        Wallet.credit(user.id, 1000, "Bonus de bienvenue", true);
      }
      Wallet.spend(user.id, t.entry, `Mise entree - ${t.name}`);
      const bal = Wallet.getBalance(user.id);
      sendUser(user.id, { type: "wallet_update", balance: bal.balance, bonusLock: bal.bonus_lock });
      broadcast({ type: "tournament_update" });
      return respond(res, { ok: true });
    }

    // GET /api/leaderboard
    if (method === "GET" && pathname === "/api/leaderboard")
      return respond(res, { leaderboard: leaderboardForClient(user.id) });

    // POST /api/user/avatar — upload photo de profil (base64)
    if (method === "POST" && pathname === "/api/user/avatar") {
      const payload = await readBody(req);
      const dataUrl = payload.avatar || "";
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (!m) return respond(res, { error: "Format image invalide (base64 attendu)" }, 400);
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 2 * 1024 * 1024) return respond(res, { error: "Image trop lourde (max 2 Mo)" }, 400);
      const dir = path.join(__dirname, "uploads", "avatars");
      fs.mkdirSync(dir, { recursive: true });
      const fname = `avatar_${user.id}_${Date.now()}.${ext}`;
      const fpath = path.join(dir, fname);
      fs.writeFileSync(fpath, buf);
      User.update(user.id, { avatar: `/uploads/avatars/${fname}` });
      return respond(res, { ok: true, avatar: `/uploads/avatars/${fname}` });
    }

    // GET /api/skins
    if (method === "GET" && pathname === "/api/skins")
      return respond(res, { skins: DATA.SKINS_CATALOG, owned: Skins.listOwned(user.id), equipped: Skins.getEquipped(user.id) });

    // POST /api/skins/buy
    if (method === "POST" && pathname === "/api/skins/buy") {
      const payload = await readBody(req);
      const sk = DATA.SKINS_CATALOG.find((s) => s.id === payload.skinId);
      if (!sk) return respond(res, { error: "Skin introuvable" }, 404);
      if (sk.price && sk.price > 0) {
        if (user.balance < sk.price) return respond(res, { error: "Solde insuffisant" }, 400);
        Wallet.spend(user.id, sk.price, `Achat ${sk.name}`);
      }
      Skins.buy(user.id, sk.id);
      User.update(user.id, { balance: (user.balance || 0) - (sk.price || 0) });
      const bal = Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: bal.balance });
    }

    // POST /api/skins/equip
    if (method === "POST" && pathname === "/api/skins/equip") {
      const payload = await readBody(req);
      const sk = DATA.SKINS_CATALOG.find((s) => s.id === payload.skinId);
      if (!sk) return respond(res, { error: "Skin introuvable" }, 404);
      if (!Skins.listOwned(user.id).includes(sk.id)) return respond(res, { error: "Skin non possede" }, 403);
      Skins.equip(user.id, sk.kind, sk.id);
      return respond(res, { ok: true });
    }

    // GET /api/transactions
    if (method === "GET" && pathname === "/api/transactions")
      return respond(res, { transactions: Wallet.getTransactions(user.id) });

    // GET /api/chat/contacts
    if (method === "GET" && pathname === "/api/chat/contacts") {
      const contacts = Chat.getContacts(user.id);
      const onlineUsers = [];
      for (const [uid, conn] of connections) {
        if (uid !== user.id) onlineUsers.push({ id: uid, pseudo: conn.pseudo, online: true });
      }
      return respond(res, { contacts, onlineUsers });
    }

    // GET /api/chat/:pseudo
    if (method === "GET" && pathname.startsWith("/api/chat/")) {
      const otherPseudo = decodeURIComponent(pathname.slice(10));
      const other = User.getByPseudo(otherPseudo);
      if (!other) return respond(res, { error: "Utilisateur introuvable" }, 404);
      return respond(res, { messages: Chat.getThread(user.id, other.id) });
    }

    // GET /api/friends — liste de mes amis + demandes d'ami (reçues / envoyées)
    if (method === "GET" && pathname === "/api/friends") {
      const friends = Friend.list(user.id);
      const online = new Set();
      for (const [uid, conn] of connections) if (uid !== user.id) online.add(uid);
      return respond(res, {
        friends: friends.map((f) => ({ ...f, online: online.has(f.id) })),
        incoming: FriendRequest.incoming(user.id),
        outgoing: FriendRequest.outgoing(user.id),
      });
    }

    // POST /api/friends/request — envoyer une demande d'ami par pseudo
    if (method === "POST" && pathname === "/api/friends/request") {
      const payload = await readBody(req);
      const pseudo = (payload.pseudo || "").trim();
      const target = User.getByPseudo(pseudo);
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      // Si l'autre m'a déjà envoyé une demande → acceptation mutuelle directe
      const pending = FriendRequest.pendingBetween(user.id, target.id);
      if (pending && pending.direction === "incoming") {
        return acceptFriendRequest(res, pending.id, user);
      }
      const r = FriendRequest.send(user.id, target.id);
      if (!r.ok) return respond(res, { error: r.error }, 400);
      sendUser(target.id, { type: "friend_request", id: r.id, from: user.pseudo, fromElo: user.elo });
      return respond(res, { ok: true, requestId: r.id, status: "sent" });
    }

    // POST /api/friends/respond — accepter ou refuser une demande reçue { id, action: "accept"|"decline" }
    if (method === "POST" && pathname === "/api/friends/respond") {
      const payload = await readBody(req);
      const reqRow = FriendRequest.get(parseInt(payload.id));
      if (!reqRow) return respond(res, { error: "Demande introuvable" }, 404);
      if (reqRow.to_id !== user.id) return respond(res, { error: "Non autorisé" }, 403);
      if (reqRow.status !== "pending") return respond(res, { error: "Demande déjà traitée" }, 400);
      if (payload.action === "decline") {
        FriendRequest.decline(reqRow.id);
        const from = User.getById(reqRow.from_id);
        sendUser(reqRow.from_id, { type: "friend_update" });
        return respond(res, { ok: true, status: "declined", from: from ? from.pseudo : null });
      }
      if (payload.action === "accept") return acceptFriendRequest(res, reqRow.id, user);
      return respond(res, { error: "Action invalide" }, 400);
    }

    // POST /api/friends — rétrocompat : transforme l'ajout direct en demande d'ami
    if (method === "POST" && pathname === "/api/friends") {
      const payload = await readBody(req);
      const pseudo = (payload.pseudo || "").trim();
      const target = User.getByPseudo(pseudo);
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      const pending = FriendRequest.pendingBetween(user.id, target.id);
      if (pending && pending.direction === "incoming")
        return acceptFriendRequest(res, pending.id, user);
      const r = FriendRequest.send(user.id, target.id);
      if (!r.ok) return respond(res, { error: r.error }, 400);
      sendUser(target.id, { type: "friend_request", id: r.id, from: user.pseudo, fromElo: user.elo });
      return respond(res, { ok: true, requestId: r.id, status: "sent" });
    }

    // DELETE /api/friends/:pseudo — retirer un ami
    if (method === "DELETE" && pathname.startsWith("/api/friends/")) {
      const pseudo = decodeURIComponent(pathname.slice("/api/friends/".length));
      const target = User.getByPseudo(pseudo);
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      Friend.remove(user.id, target.id);
      return respond(res, { ok: true });
    }

    // GET /api/users/search?q= — rechercher des joueurs
    if (method === "GET" && pathname === "/api/users/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 20);
      if (!q) return respond(res, { users: [] });
      const users = Friend.search(user.id, q);
      const friends = new Set(Friend.list(user.id).map((f) => f.id));
      const sentTo = new Set(FriendRequest.outgoing(user.id).map((r) => r.to_id));
      return respond(res, { users: users.map((u) => ({ ...u, isFriend: friends.has(u.id), requestSent: sentTo.has(u.id) })) });
    }

    // GET /api/users/:id — profil public d'un joueur (par son ID unique, pas son pseudo)
    if (method === "GET" && /^\/api\/users\/\d+$/.test(pathname)) {
      const targetId = parseInt(pathname.split("/").pop());
      const target = User.getById(targetId);
      if (!target) return respond(res, { error: "Joueur introuvable" }, 404);
      const friends = new Set(Friend.list(user.id).map((f) => f.id));
      const online = new Set();
      for (const [uid] of connections) online.add(uid);
      const t = sanitizeUser(target);
      delete t.balance; delete t.bonus_lock; delete t.bonus_used; delete t.withdrawn_today; delete t.kyc;
      // Statut d'amitié : "friends" | "sent" (demande envoyée) | "received" (demande reçue) | "none"
      const pending = FriendRequest.pendingBetween(user.id, target.id);
      const friendStatus = friends.has(target.id) ? "friends"
        : pending ? (pending.direction === "outgoing" ? "sent" : "received") : "none";
      return respond(res, {
        user: { ...t, isFriend: friends.has(target.id), friendStatus,
          requestId: pending && pending.direction === "incoming" ? pending.id : null,
          online: online.has(target.id) },
        games: GameRecord.listForUser(target.id).slice(0, 20),
      });
    }

    // GET /api/config
    if (method === "GET" && pathname === "/api/config")
      return respond(res, { formats: DATA.FORMATS, ranks: DATA.RANKS, games: DATA.GAMES_CATALOG, provinces: DATA.PROVINCES, operators: DATA.OPERATORS });

    // GET /api/games/history
    if (method === "GET" && pathname === "/api/games/history")
      return respond(res, { games: GameRecord.listForUser(user.id) });

    // GET /api/games/live — parties en cours des connaissances (amis + contacts)
    if (method === "GET" && pathname === "/api/games/live") {
      const known = new Set();
      Friend.list(user.id).forEach((f) => known.add(f.id));
      Chat.getContacts(user.id).forEach((c) => known.add(c.id));
      const live = [];
      for (const s of sessions.values()) {
        if (s.over || s.mode === "ai") continue;
        if (!s.player1.id || !s.player2 || !s.player2.id) continue;
        if (!known.has(s.player1.id) && !known.has(s.player2.id)) continue;
        live.push({
          sessionId: s.sessionId, mode: s.mode, format: s.format.id, wager: s.wager,
          player1: { id: s.player1.id, pseudo: s.player1.pseudo, elo: s.player1.elo },
          player2: { id: s.player2.id, pseudo: s.player2.pseudo, elo: s.player2.elo },
          moves: (s.moves || []).length, phase: s.phase,
        });
      }
      return respond(res, { live });
    }

    // POST /api/kyc/verify — persiste la vérification d'identité (la simulation
    // locale côté client) pour que les fonctions serveur (défis avec mise,
    // entrée de tournoi…) voient kyc=true au même titre que l'UI.
    if (method === "POST" && pathname === "/api/kyc/verify") {
      User.update(user.id, { kyc: 1 });
      return respond(res, { ok: true, kyc: true, user: User.getById(user.id) });
    }

    // POST /api/deposit
    if (method === "POST" && pathname === "/api/deposit") {
      const payload = await readBody(req);
      if (!user.kyc) Wallet.credit(user.id, 5000, "Credit de bienvenue", true);
      Wallet.credit(user.id, parseInt(payload.amount) || 5000, `Depot ${payload.operator || "MVola"}`);
      const bal = Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: bal.balance, bonusLock: bal.bonus_lock });
    }

    // POST /api/withdraw
    if (method === "POST" && pathname === "/api/withdraw") {
      const payload = await readBody(req);
      const amount = parseInt(payload.amount) || 0;
      if (amount < 1000) return respond(res, { error: "Minimum 1000 Ar" }, 400);
      const bal = Wallet.getBalance(user.id);
      const available = bal.balance - bal.bonus_lock;
      if (amount > available) return respond(res, { error: "Solde insuffisant" }, 400);
      Wallet.spend(user.id, amount, `Retrait ${payload.operator || "MVola"}`);
      const nBal = Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: nBal.balance, bonusLock: nBal.bonus_lock });
    }

    respond(res, { error: "Route non trouvee" }, 404);
  })().catch((err) => {
    console.error("REST error:", err);
    respond(res, { error: "Erreur serveur" }, 500);
  });
}

/* ---------- WebSocket handler ---------- */
function handleWsMessage(ws, msg) {
  const conn = connections.get(ws);

  // Auth is always allowed
  if (msg.type === "auth") {
    const userId = tokens.get(msg.token);
    if (!userId) { send(ws, { type: "error", message: "Token invalide" }); return; }
    const user = User.getById(userId);
    if (!user) { send(ws, { type: "error", message: "Utilisateur introuvable" }); return; }
    connections.set(ws, { userId: user.id, pseudo: user.pseudo });
    userSockets.set(user.id, ws);
    // Reconnexion : annule le délai de grâce d'abandon en cours, puis re-synchronise l'état.
    const pend = disconnectTimers.get(user.id);
    if (pend) { clearTimeout(pend.timer); disconnectTimers.delete(user.id); }
    const curSession = findUserSession(user.id);
    if (curSession) dispatchGameState(curSession);
    const challenges = Challenge.getByUser(user.id);
    if (challenges.length) send(ws, { type: "challenges_update", challenges });
    return;
  }

  // Auth required for all other messages
  if (!conn) { send(ws, { type: "error", message: "Non authentifie" }); return; }
  const user = User.getById(conn.userId);
  if (!user) return;

  switch (msg.type) {
    case "find_match": {
      const fmt = msg.format;
      const mode = msg.mode || "online";
      if (mmQueues[fmt] === undefined) mmQueues[fmt] = [];
      const opponent = mmQueues[fmt].find((e) => e.userId !== conn.userId && e.mode === "online");
      if (opponent && mode === "online") {
        mmQueues[fmt] = mmQueues[fmt].filter((e) => e.userId !== conn.userId && e.userId !== opponent.userId);
        const key = "PM-" + Math.random().toString(36).slice(2, 8).toUpperCase();
        const p1 = User.getById(conn.userId);
        const p2 = User.getById(opponent.userId);
        pendingMatches.set(key, { p1: conn.userId, p2: opponent.userId, p1Ready: false, p2Ready: false, format: fmt });
        sendUser(conn.userId, { type: "match_found", matchKey: key, opponent: { pseudo: p2.pseudo, elo: p2.elo, id: p2.id }, format: fmt, playerNum: 1 });
        sendUser(opponent.userId, { type: "match_found", matchKey: key, opponent: { pseudo: p1.pseudo, elo: p1.elo, id: p1.id }, format: fmt, playerNum: 2 });
      } else if (mode === "ai") {
        createGameSession(conn.userId, null, "ai", fmt, 0);
      } else {
        mmQueues[fmt].push({ userId: conn.userId, pseudo: conn.pseudo, mode });
        send(ws, { type: "matchmaking", status: "searching" });
      }
      break;
    }
    case "cancel_match": {
      for (const fmt of Object.keys(mmQueues)) mmQueues[fmt] = mmQueues[fmt].filter((e) => e.userId !== conn.userId);
      // retirer des matchs en attente
      for (const [key, pm] of pendingMatches) {
        if (pm.p1 === conn.userId || pm.p2 === conn.userId) {
          pendingMatches.delete(key);
          const otherId = pm.p1 === conn.userId ? pm.p2 : pm.p1;
          sendUser(otherId, { type: "match_cancelled", matchKey: key });
        }
      }
      break;
    }
    case "accept_match": {
      const key = msg.matchKey;
      const pm = pendingMatches.get(key);
      if (!pm) { send(ws, { type: "error", message: "Match introuvable" }); return; }
      if (conn.userId === pm.p1) pm.p1Ready = true;
      else if (conn.userId === pm.p2) pm.p2Ready = true;
      else return;
      sendUser(pm.p1, { type: "match_status", matchKey: key, p1Ready: pm.p1Ready, p2Ready: pm.p2Ready });
      sendUser(pm.p2, { type: "match_status", matchKey: key, p1Ready: pm.p1Ready, p2Ready: pm.p2Ready });
      if (pm.p1Ready && pm.p2Ready) {
        pendingMatches.delete(key);
        createGameSession(pm.p1, pm.p2, "online", pm.format, 0);
      }
      break;
    }
    case "move": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.over) return;
      const result = session.applyMove(msg.move);
      if (!result.ok) { send(ws, { type: "error", message: result.error, sessionId: msg.sessionId }); return; }
      GameSessionStore.updateState(msg.sessionId, session.getState());
      dispatchGameState(session);
      if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
      else if (session.turn === 2 && session.mode === "ai") scheduleAiMove(session.sessionId);
      break;
    }
    case "pick_side": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.phase !== "choose") { send(ws, { type: "error", message: "Choix indisponible", sessionId: msg.sessionId }); return; }
      const playerNum = conn.userId === session.player1.id ? 1 : 2;
      const result = session.pickSide(playerNum, msg.side);
      if (result.error) send(ws, { type: "error", message: result.error, sessionId: msg.sessionId });
      // Mode IA (entraînement en ligne) : l'IA (joueur 2) reçoit automatiquement
      // la face restante — le tirage se résout dès que le joueur 1 a choisi.
      if (session.mode === "ai" && session.phase === "choose" && playerNum === 1 && session.choices[2] === null) {
        const remaining = session.choices[1] === "pile" ? "face" : "pile";
        session.pickSide(2, remaining);
      }
      GameSessionStore.updateState(msg.sessionId, session.getState());
      dispatchGameState(session);
      if (session.phase === "play" && session.turn === 2 && session.mode === "ai") scheduleAiMove(session.sessionId);
      break;
    }
    case "resign": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.over) return;
      const playerNum = conn.userId === session.player1.id ? 1 : 2;
      const result = session.resign(playerNum);
      if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
      break;
    }
    case "end_chain": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.over || !session.chain) return;
      const result = session.endChain();
      GameSessionStore.updateState(msg.sessionId, session.getState());
      dispatchGameState(session);
      if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
      else if (session.turn === 2 && session.mode === "ai") scheduleAiMove(session.sessionId);
      break;
    }
    case "sync_game": {
      // Resynchronisation à la (re)connexion : renvoie l'état autoritaire courant.
      const session = (msg.sessionId && sessions.get(msg.sessionId)) || findUserSession(conn.userId);
      if (!session || session.over) break;
      dispatchGameState(session);
      break;
    }
    case "spectate": {
      // Un spectateur (connaissance) demande à suivre un match en direct.
      const session = sessions.get(msg.sessionId);
      if (!session || session.over) { send(ws, { type: "error", message: "Match introuvable ou déjà terminé" }); return; }
      if (session.player1.id === conn.userId || (session.player2 && session.player2.id === conn.userId)) {
        send(ws, { type: "error", message: "Vous êtes joueur de ce match" }); return;
      }
      if (!spectators.has(session.sessionId)) spectators.set(session.sessionId, new Set());
      spectators.get(session.sessionId).add(conn.userId);
      send(ws, { type: "spectate_state", sessionId: session.sessionId, state: session.getState() });
      break;
    }
    case "unspectate": {
      const set = spectators.get(msg.sessionId);
      if (set) { set.delete(conn.userId); if (!set.size) spectators.delete(msg.sessionId); }
      break;
    }
    case "chat_message": {
      const otherUser = User.getByPseudo(msg.toPseudo);
      if (!otherUser) { send(ws, { type: "error", message: "Joueur introuvable" }); return; }
      Chat.saveMessage(conn.userId, otherUser.id, msg.text);
      const at = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      sendUser(otherUser.id, { type: "chat_message", from: user.pseudo, text: msg.text, at });
      send(ws, { type: "chat_message", from: user.pseudo, to: otherUser.pseudo, text: msg.text, at, direction: "me" });
      break;
    }
    case "send_challenge": {
      const targetUser = User.getByPseudo(msg.toPseudo);
      if (!targetUser) { send(ws, { type: "error", message: "Joueur introuvable" }); return; }
      const wager = parseInt(msg.wager) || 0;
      if (wager < 500) { send(ws, { type: "error", message: "Mise minimale de 500 Ar requise — les défis gratuits ne sont pas autorisés" }); return; }
      if (!user.kyc) { send(ws, { type: "error", message: "KYC requis" }); return; }
      if (user.balance < wager) { send(ws, { type: "error", message: "Solde insuffisant" }); return; }
      Wallet.spend(user.id, wager, `Mise defi vs ${targetUser.pseudo}`);
      const ch = Challenge.create(user.id, targetUser.id, wager, msg.format);
      sendUser(targetUser.id, { type: "challenge_received", challenge: {
        id: ch.id, from: user.pseudo, fromElo: user.elo, wager, format: msg.format, expiresAt: ch.expires_at
      }});
      send(ws, { type: "challenge_sent", challengeId: ch.id, to: targetUser.pseudo });
      break;
    }
    case "accept_challenge": {
      const ch = Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending") { send(ws, { type: "error", message: "Defi invalide" }); return; }
      if (ch.to_id !== user.id) { send(ws, { type: "error", message: "Pas votre defi" }); return; }
      const fromUser = User.getById(ch.from_id);
      if (ch.wager > 0) {
        if (!user.kyc) { send(ws, { type: "error", message: "KYC requis" }); return; }
        if (user.balance < ch.wager) { send(ws, { type: "error", message: "Solde insuffisant" }); return; }
        Wallet.spend(user.id, ch.wager, `Mise defi vs ${fromUser.pseudo}`);
      }
      Challenge.update(msg.challengeId, "accepted");
      createGameSession(fromUser.id, user.id, "defi", ch.format, ch.wager);
      sendUser(fromUser.id, { type: "challenge_accepted", challengeId: msg.challengeId });
      break;
    }
    case "reject_challenge": {
      const ch = Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending" || ch.to_id !== user.id) return;
      Challenge.update(msg.challengeId, "rejected");
      // Refund sender
      if (ch.wager > 0) {
        Wallet.credit(ch.from_id, ch.wager, "Defi refuse - remboursement");
        sendUser(ch.from_id, { type: "wallet_update", balance: Wallet.getBalance(ch.from_id).balance });
      }
      sendUser(ch.from_id, { type: "challenge_status", challengeId: msg.challengeId, status: "rejected" });
      break;
    }
    case "simulate_tournament":
      simulateTournament(conn.userId, parseInt(msg.tournamentId));
      break;
    case "ping":
      send(ws, { type: "pong" });
      break;
  }
}

/* ---------- Game helpers ---------- */
function dispatchGameState(session) {
  const p1ws = userSockets.get(session.player1.id);
  const p2ws = session.player2 && session.player2.id !== 0 ? userSockets.get(session.player2.id) : null;
  const st = session.getState();
  if (p1ws) send(p1ws, { type: "game_state", sessionId: session.sessionId, state: st });
  if (p2ws) send(p2ws, { type: "game_state", sessionId: session.sessionId, state: st });
  // Diffusion aux spectateurs du match (lecture seule)
  const spec = spectators.get(session.sessionId);
  if (spec) for (const uid of spec) {
    const sws = userSockets.get(uid);
    if (sws) send(sws, { type: "spectate_state", sessionId: session.sessionId, state: st });
  }
}

function findUserSession(userId) {
  for (const s of sessions.values()) {
    if (s.over) continue;
    if (s.player1.id === userId) return s;
    if (s.player2 && s.player2.id === userId) return s;
  }
  return null;
}

function createGameSession(p1Id, p2Id, mode, formatId, wager) {
  const sessionId = "GS-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const format = DATA.FORMATS.find((f) => f.id === formatId) || DATA.FORMATS[0];
  const p1 = p1Id ? User.getById(p1Id) : null;
  let p2;
  if (mode === "ai" || !p2Id) {
    const aiPseudo = DATA.OPPONENT_POOL[Math.floor(Math.random() * DATA.OPPONENT_POOL.length)].pseudo;
    p2 = { id: 0, pseudo: aiPseudo, elo: Math.max(600, (p1?.elo || 1100) - 60), region: "Madagascar" };
  } else {
    p2 = User.getById(p2Id);
  }
  const p1Obj = p1 || { id: 0, pseudo: "Spectateur", elo: 1000, region: "Madagascar" };
  const gs = new GameSession(sessionId, p1Obj, p2, mode, format, wager);
  gs.gameRecordId = GameRecord.create(p1Obj.id, p2.id, mode, formatId, wager);
  sessions.set(sessionId, gs);
  GameSessionStore.create(sessionId, p1Obj.id, p2.id, mode, formatId, wager);

  if (mode === "ai") {
    sendUser(p1Obj.id, { type: "game_start", sessionId, playerNum: 1,
      state: gs.getState(), opponent: p2, mode, format, wager });
    setTimeout(() => scheduleAiMove(sessionId), 1000);
  } else {
    sendUser(p1Obj.id, { type: "game_start", sessionId, playerNum: 1,
      state: gs.getState(), opponent: p2, mode, format, wager });
    sendUser(p2.id, { type: "game_start", sessionId, playerNum: 2,
      state: gs.getState(), opponent: p1Obj, mode, format, wager });
  }
  broadcast({ type: "live_update" });
}

function scheduleAiMove(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.over || session.turn !== 2) return;
  const timer = setTimeout(() => aiMove(sessionId), 800 + Math.random() * 1200);
  aiTimers.set(sessionId, timer);
}

function aiMove(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.over || session.turn !== 2) return;
  aiTimers.delete(sessionId);
  const moves = session.getLegalMoves();
  if (!moves.length) { handleGameEnd(session, 1, "blocage"); return; }
  const caps = moves.filter((m) => m.cap.length);
  let chosen;
  if (caps.length) {
    const best = Math.max(...caps.map((x) => x.cap.length));
    const pool = caps.filter((x) => x.cap.length === best || (Math.random() < 0.25 && x.cap.length === best - 1));
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else {
    chosen = moves[Math.floor(Math.random() * moves.length)];
  }
  const result = session.applyMove(chosen);
  GameSessionStore.updateState(sessionId, session.getState());
  const p1ws = userSockets.get(session.player1.id);
  if (p1ws) send(p1ws, { type: result.gameOver ? "game_end" : "game_state", sessionId, state: result.state });
  if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
  else if (session.turn === 2 && session.mode === "ai") scheduleAiMove(sessionId);
}

function handleGameEnd(session, winner, reason) {
  if (session._ended) return; // Guard against double-end
  session._ended = true;
  session.over = true;
  const timer = aiTimers.get(session.sessionId);
  if (timer) { clearTimeout(timer); aiTimers.delete(session.sessionId); }

  const isRealGame = session.mode !== "ai" && session.player2.id !== 0;
  const deltas = session.finish(winner);
  const p1Left = countPieces(session.grid, 1);
  const p2Left = countPieces(session.grid, 2);

  // Update user ELO
  const winnerId = winner === 1 ? session.player1.id : (isRealGame ? session.player2.id : null);
  if (winner === 1) {
    db.prepare("UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?").run(deltas.delta1, session.player1.id);
  } else {
    db.prepare("UPDATE users SET elo = elo + ?, losses = losses + 1 WHERE id = ?").run(deltas.delta1, session.player1.id);
  }
  if (isRealGame) {
    if (winner === 2) {
      db.prepare("UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?").run(deltas.delta2, session.player2.id);
    } else {
      db.prepare("UPDATE users SET elo = elo + ?, losses = losses + 1 WHERE id = ?").run(deltas.delta2, session.player2.id);
    }
  }

  // Wager payout (defi mode)
  let gain = 0;
  if (session.mode === "defi" && session.wager > 0) {
    if (winner === 1) {
      gain = Math.round(session.wager * 2 * 0.9);
      Wallet.credit(session.player1.id, gain, `Gain defi vs ${session.player2.pseudo}`);
    } else if (isRealGame && winner === 2) {
      gain = Math.round(session.wager * 2 * 0.9);
      Wallet.credit(session.player2.id, gain, `Gain defi vs ${session.player1.pseudo}`);
    }
  }

  // Finish game record
  if (session.gameRecordId) {
    GameRecord.finish(session.gameRecordId, winnerId, deltas.delta1, deltas.delta2, session.moves, reason);
  }
  // Finish game session
  GameSessionStore.setStatus(session.sessionId, "finished", session.moves, winnerId);

  // Send results
  const result1 = {
    winner, reason, mode: session.mode, format: session.format, moves: session.moves.length,
    opponent: session.player2.pseudo, meLeft: p1Left, oppLeft: p2Left,
    delta: deltas.delta1, gain: winner === 1 ? gain : 0,
  };
  if (session.player1.id !== 0) sendUser(session.player1.id, { type: "game_end", sessionId: session.sessionId, result: result1 });
  if (isRealGame && session.player2.id !== 0) {
    const result2 = { ...result1, opponent: session.player1.pseudo, delta: deltas.delta2,
      meLeft: p2Left, oppLeft: p1Left, gain: winner === 2 ? gain : 0 };
    sendUser(session.player2.id, { type: "game_end", sessionId: session.sessionId, result: result2 });
  }

  // Update wallet for players
  const bal1 = Wallet.getBalance(session.player1.id);
  if (bal1) sendUser(session.player1.id, { type: "wallet_update", balance: bal1.balance, bonusLock: bal1.bonus_lock });
  if (isRealGame && session.player2.id !== 0) {
    const bal2 = Wallet.getBalance(session.player2.id);
    if (bal2) sendUser(session.player2.id, { type: "wallet_update", balance: bal2.balance, bonusLock: bal2.bonus_lock });
  }

  // Notifier les spectateurs de la fin du match
  const spec = spectators.get(session.sessionId);
  if (spec) {
    const winnerPseudo = winner === 1 ? session.player1.pseudo : session.player2.pseudo;
    for (const uid of spec) sendUser(uid, { type: "spectate_end", sessionId: session.sessionId, winner, winnerPseudo, reason });
    spectators.delete(session.sessionId);
  }

  // Clean up
  sessions.delete(session.sessionId);
  GameSessionStore.delete(session.sessionId);
  broadcast({ type: "live_update" });
}

/* ---------- Tournament simulation ---------- */
function simulateTournament(userId, tournamentId) {
  const t = Tournament.get(tournamentId);
  if (!t) return;
  const regs = Tournament.getRegistrations(tournamentId);
  const botList = ["KantoV","ZoFighter","NadiaBe","BemaT","DeraMG","FenoAria","LovaTms","Sariaka","Faniry_","TokyRabe"];
  while (regs.length < t.max_players) {
    const bp = botList.find((b) => !regs.some((r) => r.pseudo === b));
    if (!bp) break;
    const bu = User.getByPseudo(bp);
    regs.push({ id: bu?.id || 999, pseudo: bp, elo: bu?.elo || 1000 });
  }

  const ws = userSockets.get(userId);
  const steps = ["Quarts de finale...", "Demi-finales...", "Finale...", "Distribution du cashprice..."];
  steps.forEach((s, i) => {
    setTimeout(() => { if (ws && ws.readyState === WebSocket.OPEN) send(ws, { type: "tournament_sim_step", tournamentId, step: s }); }, 900 + i * 1050);
  });

  setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const userRecord = User.getById(userId);
    const mePseudo = userRecord ? userRecord.pseudo : null;
    const others = regs.filter((r) => r.pseudo !== mePseudo);
    const r1 = Math.random() < 0.55, r2 = r1 && Math.random() < 0.55, r3 = r2 && Math.random() < 0.55;
    let place = r3 ? 1 : r2 ? 2 : (r1 && Math.random() < 0.5 ? 3 : 0);
    const pool = [...others];
    const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]?.pseudo || "—";
    const results = {
      first: place === 1 ? mePseudo : pick(),
      second: place === 2 ? mePseudo : pick(),
      third: place === 3 ? mePseudo : pick(),
    };
    Tournament.setResults(tournamentId, results);
    const net = t.entry * t.max_players - 3 * t.entry;
    let gained = 0;
    if (place === 1) { gained = Math.round(t.entry + net * 0.5); Wallet.credit(userId, gained, `Cashprice 1re place - ${t.name}`); }
    else if (place === 2) { gained = Math.round(t.entry + net * 0.25); Wallet.credit(userId, gained, `Cashprice 2e place - ${t.name}`); }
    else if (place === 3) { gained = t.entry; Wallet.credit(userId, gained, `Remboursement mise (3e place) - ${t.name}`); }
    const bal = Wallet.getBalance(userId);
    if (bal) sendUser(userId, { type: "wallet_update", balance: bal.balance, bonusLock: bal.bonus_lock });
    broadcast({ type: "tournament_update" });
    send(ws, { type: "tournament_sim_result", tournamentId, results, place, gained });
  }, 900 + steps.length * 1050 + 700);
}

/* ---------- Game loop ---------- */
function gameLoop() {
  for (const [id, session] of sessions) {
    if (session.over) continue;
    // Si le joueur dont c'est le tour est hors-ligne (déconnexion), on marque une
    // pause (horloge figée) pour laisser le délai de grâce agir — pas de perte par temps.
    const activeId = session.turn === 1 ? session.player1.id : (session.player2 ? session.player2.id : 0);
    if (activeId !== 0 && !userSockets.has(activeId)) continue;
    const timeout = session.tickClock();
    if (timeout) {
      handleGameEnd(session, timeout.winner, timeout.reason);
    } else if (session.clock[session.turn] % 5 === 0) {
      dispatchGameState(session);
    }
  }
  // Expire challenges
  const expired = db.prepare("SELECT * FROM challenges WHERE status='pending' AND expires_at < datetime('now')").all();
  for (const c of expired) {
    Challenge.update(c.id, "expired");
    sendUser(c.from_id, { type: "challenge_status", challengeId: c.id, status: "expired" });
    if (c.wager > 0) {
      Wallet.credit(c.from_id, c.wager, "Defi expire - remboursement");
      sendUser(c.from_id, { type: "wallet_update", balance: Wallet.getBalance(c.from_id).balance });
    }
  }
  // Auto-matchmake
  for (const [fmt, queue] of Object.entries(mmQueues)) {
    if (queue.length >= 2) {
      queue.sort((a, b) => (a.elo || 0) - (b.elo || 0));
      const pairs = [];
      for (let i = 0; i < queue.length - 1; i += 2) pairs.push([queue[i], queue[i + 1]]);
      queue.length = 0;
      for (const [a, b] of pairs) createGameSession(a.userId, b.userId, "online", fmt, 0);
    }
  }
}

/* ---------- WebSocket disconnect ---------- */
function handleDisconnect(ws) {
  const conn = connections.get(ws);
  if (!conn) return;
  for (const fmt of Object.keys(mmQueues)) mmQueues[fmt] = mmQueues[fmt].filter((e) => e.userId !== conn.userId);
  // Déconnexion ≠ abandon immédiat : laisser un délai de grâce pour la reconnexion.
  if (!disconnectTimers.has(conn.userId)) {
    for (const [id, session] of sessions) {
      const inThis = session.player1.id === conn.userId || (session.player2 && session.player2.id === conn.userId);
      if (inThis && !session.over) {
        const timer = setTimeout(() => {
          disconnectTimers.delete(conn.userId);
          const s = sessions.get(id);
          if (s && !s.over) {
            handleGameEnd(s, s.player1.id === conn.userId ? 2 : 1, "abandon");
            sessions.delete(id);
            GameSessionStore.delete(id);
          }
        }, GRACE_MS);
        disconnectTimers.set(conn.userId, { timer, sessionId: id });
        break;
      }
    }
  }
  userSockets.delete(conn.userId);
  connections.delete(ws);
  // Retirer l'utilisateur des spectates en cours
  for (const [sid, set] of spectators) {
    if (set.delete(conn.userId) && !set.size) spectators.delete(sid);
  }
}

/* ---------- Démarrage ---------- */
function start() {
  seedDatabase();

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, `http://${req.headers.host || "localhost:" + PORT}`);
    if (url.pathname.startsWith("/api/")) {
      handleRest(req, res, url, authMiddleware(req));
    } else {
      serveStatic(req, res);
    }
  });

  const wss = new WebSocket.Server({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (typeof msg === "string") { /* raw string, parse */ }
        handleWsMessage(ws, typeof msg === "string" ? JSON.parse(data.toString()) : msg);
      } catch (err) {
        send(ws, { type: "error", message: "Message invalide" });
      }
    });
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", () => {});
  });

  setInterval(gameLoop, TICK_MS);

  server.listen(PORT, "0.0.0.0", () => {
    console.log("\n=== D-aôna Server (v1.1 — Link Remote) ===");
    console.log(`HTTP + WebSocket sur ws://0.0.0.0:${PORT}`);
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
      }
    }
    console.log("\nLien pour tester avec d'autres appareils :");
    if (ips.length) { for (const ip of ips) console.log(`  http://${ip}:${PORT}`); }
    else { console.log(`  http://localhost:${PORT}`); }
    console.log("\nPartagez ce lien avec vos amis sur le même réseau WiFi / Bluetooth PAN.");
    console.log("Ctrl+C pour arrêter.\n");
  });
}

start();
module.exports = { start, seedDatabase, gameLoop, handleWsMessage, createGameSession, simulateTournament };
