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

const { db, User, GameRecord, Tournament, Wallet, Chat, Skins, PionStyle, Challenge, GameSessionStore, Friend, FriendRequest, Notification, TournamentMatch, applyInactivityDecay } = require("./db");
const { GameSession, computeEloDelta, legalMoves, checkWin, countPieces, initialGrid } = require("./game");
/* Registre des plateaux heberges par le serveur : le socle ne nomme aucun jeu,
   il demande « <game> » au registre et recoit le module qui expose le contrat
   « moteur + session » (Tsivy, Dimy, Telo). */
const Registry = require("./games/registry");
const DATA = require("./data");
const Auth = require("./auth");

const PORT = parseInt(process.env.D_AONA_PORT || process.env.PORT || "8080", 10);
const TICK_MS = 1000;

/* ---------- State serveur (in-memory) ---------- */
const {
  connections, userSockets, sessions, spectators,
  disconnectTimers, pendingMatches, aiTimers,
} = require("./live/state");
const mm = require("./live/matchmaking");
/* Sessions en base (table `sessions`, jeton haché) : aucune Map de jetons ici. */
/* Délai de grâce avant abandon sur déconnexion : une coupure WebSocket
   (souvent un simple blip du tunnel) ne doit PAS compter comme un abandon immédiat.
   Surchargeable par l'environnement pour les SONDES uniquement (elles ne peuvent
   pas attendre vingt secondes par scénario) ; la valeur par défaut ne bouge pas. */
const GRACE_MS = parseInt(process.env.D_AONA_GRACE_MS || "20000", 10);
/* Plafond du fil « parties en direct » (vue publique, scope=all) : la page
   Match n'affiche pas plus de matchs à la fois, la liste reste lisible et la
   réponse bornée même si le serveur hébergeait des centaines de parties. */
const LIVE_FEED_MAX = 60;

/* ---------- Utilitaires ---------- */
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
    bonus_used: !!u.bonus_used,
    /* Somme des retraits du JOUR, calculée sur l'historique (Wallet.withdrawnToday) :
       la colonne `withdrawn_today` n'était entretenue par personne et restait à 0. */
    withdrawn_today: Wallet.withdrawnToday(u.id),
    rank: rank || null,
    badge: badge ? { name: badge.name, icon: badge.icon, color: badge.color } : null };
}

/* ---------- Limitation de débit du chat ----------
   Un fil de discussion n'a aucune raison d'accepter des dizaines de messages
   par seconde : fenêtre glissante simple par joueur (20 messages / 10 s).
   Les entrées des joueurs inactifs sont purgées à chaque tick (gameLoop). */
const CHAT_RATE_MAX = 20;
const CHAT_RATE_WINDOW_MS = 10000;
const chatRate = new Map(); // userId -> { count, since }
function allowChatMessage(userId) {
  const nowMs = Date.now();
  const e = chatRate.get(userId);
  if (!e || nowMs - e.since >= CHAT_RATE_WINDOW_MS) { chatRate.set(userId, { count: 1, since: nowMs }); return true; }
  e.count += 1;
  return e.count <= CHAT_RATE_MAX;
}

/* ---------- Signature binaire des images (upload d'avatar) ----------
   Le type DÉCLARÉ (extension du dataURL) doit correspondre au CONTENU réel :
   sans ce contrôle, un fichier HTML renommé « .png » serait stocké puis servi
   depuis la même origine. Les formats acceptés sont déjà sans SVG (liste du
   dataURL) ; ceci ferme le dernier écart (contenu ≠ déclaration). */
function imageMagicOk(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === "png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  if (ext === "jpg") return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  if (ext === "gif") { const h = buf.slice(0, 6).toString("ascii"); return h === "GIF87a" || h === "GIF89a"; }
  if (ext === "webp") return buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  return false;
}

/* ---------- Seed de la base ----------
   Désactivé par défaut : la base reste dans l'état où elle est. Réactivation
   explicite pour une base de démonstration : D_AONA_SEED=1. */
const SEED_ENABLED = process.env.D_AONA_SEED === "1";
function seedDatabase() {
  if (!SEED_ENABLED) return;
  // 1. Comptes de référence d'abord (les inscriptions aux tournois doivent les trouver)
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
  // 2. Tournois (les inscrits sont désormais en base)
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
      sponsor: t.sponsor,
      startsInSec: t.status === "inscriptions" ? startsInSec : (t.status === "termine" ? -1 : startsInSec),
      registered: regs.map((r) => r.pseudo), registeredCount: regCount, isRegistered: isReg,
      /* Les pseudos SEULS ne suffisent pas à l'interface : pour rendre un nom
         cliquable il faut l'identifiant (un pseudo peut être modifié). On expose
         donc la liste des inscrits avec id + pseudo + photo, en plus de la liste
         de pseudos conservée pour la compatibilité des vues existantes. */
      registeredUsers: regs.map((r) => ({ id: r.id, pseudo: r.pseudo, elo: r.elo, avatar: r.avatar || null })),
      results: t.results_json ? JSON.parse(t.results_json) : null,
    };
  });
}
/* ---------- Acceptation d'une demande d'ami ----------
   Crée l'amitié dans les DEUX sens, puis envoie le message automatique
   « De aona ? Masahy amiko ? » de la part du joueur qui a DEMANDÉ vers
   celui qui a accepté. */
function acceptFriendRequest(res, requestId, acceptingUser) {
  const reqRow = FriendRequest.get(requestId);
  if (!reqRow || reqRow.status !== "pending") return respond(res, { error: "Demande déjà traitée" }, 400);
  if (reqRow.to_id !== acceptingUser.id) return respond(res, { error: "Non autorisé" }, 403);
  const sender = User.getById(reqRow.from_id);
  if (!sender) return respond(res, { error: "Joueur introuvable" }, 404);
  FriendRequest.accept(requestId);
  Friend.add(acceptingUser.id, sender.id);
  Friend.add(sender.id, acceptingUser.id);
  // Message automatique : envoyé par le DEMANDEUR → celui qui a accepté
  const autoText = "De aona ? Masahy amiko ?";
  Chat.saveMessage(sender.id, acceptingUser.id, autoText);
  const at = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  sendUser(acceptingUser.id, { type: "chat_message", from: sender.pseudo, text: autoText, at });
  sendUser(sender.id, { type: "friend_update" });
  sendUser(acceptingUser.id, { type: "friend_update" });
  return respond(res, { ok: true, status: "accepted", friend: { id: sender.id, pseudo: sender.pseudo, elo: sender.elo } });
}

/* Elo courant d'un joueur, lu EN BASE (et non dans un état mémorisé) : `null` si
   le joueur n'existe pas — c'est le cas du camp « IA », dont l'id vaut 0. */
function readElo(userId) {
  if (!userId) return null;
  const row = db.prepare("SELECT elo FROM users WHERE id = ?").get(userId);
  return row ? row.elo : null;
}

/* Charge utile UNIQUE du portefeuille poussée au client.
   Un `wallet_update` qui ne portait que `balance` faisait écraser `bonusLock`
   côté client avec `undefined` : « Solde disponible » (calculé `solde − bonus
   verrouillé`) s'affichait alors « NaN Ar ». Une seule fabrique, donc plus
   aucune émission partielle possible — c'est la donnée qui garantit l'affichage,
   pas la discipline des appelants. */
function walletPayload(userId) {
  const b = Wallet.getBalance(userId) || {};
  return { type: "wallet_update", balance: b.balance, bonusLock: b.bonus_lock };
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

/* ---------- HTTP : utilitaires extraits dans http.js ---------- */
const { serveStatic, clientIp, bearerToken, authMiddleware, isRateLimited, readBody, respond } = require("./http");

function handleRest(req, res, url, userId) {
  const method = req.method;
  const pathname = url.pathname;
  const user = userId ? User.getById(userId) : null;

  (async () => {
    /* ---------- Authentification ----------------------------------------
       Rappel du défaut corrigé : l'ancienne route créait ou ouvrait un
       compte à partir du SEUL pseudo, sans aucun secret. Connaître un
       pseudo suffisait donc à prendre la main sur le compte d'autrui.
       Ces routes ne renvoient jamais de mot de passe ni d'empreinte. */
    if (method === "POST" && (pathname === "/api/auth/login" || pathname === "/api/auth")) {
      if (isRateLimited(req, res)) return;
      const payload = await readBody(req, 1024);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await Auth.login({
        pseudo: payload.pseudo, password: payload.password,
        userAgent: req.headers["user-agent"], ip: clientIp(req),
      });
      if (!r.ok) return respond(res, { error: r.error }, r.status);
      return respond(res, { token: r.token, expiresAt: r.expiresAt, user: sanitizeUser(r.user) });
    }

    if (method === "POST" && pathname === "/api/auth/register") {
      if (isRateLimited(req, res)) return;
      const payload = await readBody(req, 2048);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await Auth.register({
        pseudo: payload.pseudo, password: payload.password,
        province: payload.province, phone: payload.phone, email: payload.email,
        userAgent: req.headers["user-agent"], ip: clientIp(req),
      });
      if (!r.ok) return respond(res, { error: r.error, missing: r.missing }, r.status);
      /* Un nouveau compte entre dans le classement : les AUTRES clients doivent
         l'apprendre sans recharger leur page. C'est le seul moyen pour que
         « le nouveau joueur apparaît » autrement qu'au prochain rechargement —
         la requête /api/leaderboard, elle, renvoie déjà tout le monde. */
      broadcast({ type: "leaderboard_update" });
      return respond(res, { token: r.token, expiresAt: r.expiresAt, user: sanitizeUser(r.user) });
    }

    /* Disponibilité d'un pseudo, AVANT création du compte.
       L'écran d'inscription ne peut pas deviner l'état de la table `users` :
       la courte liste de pseudos codée en dur dans le frontend divergeait des
       98 comptes réellement en base, et l'inscription finissait en 409 « déjà
       pris » — un refus que l'utilisateur ne voyait pas. Publique, donc
       limitée en débit ; ne révèle que « libre / pris ». */
    if (method === "GET" && pathname === "/api/auth/available") {
      if (isRateLimited(req, res)) return;
      const pseudo = Auth.normalizePseudo(url.searchParams.get("pseudo") || "");
      if (!Auth.isValidPseudo(pseudo)) return respond(res, { pseudo, valid: false, available: false });
      return respond(res, { pseudo, valid: true, available: !User.getByPseudo(pseudo) });
    }

    /* Déconnexion : révoque la session côté SERVEUR. Un simple effacement
       du jeton côté client laissait la session valide en base — donc
       rejouable si le jeton avait fuité. */
    if (method === "POST" && pathname === "/api/auth/logout") {
      const raw = bearerToken(req);
      if (!raw || !Auth.resolveSession(raw)) return respond(res, { error: "Session invalide" }, 401);
      Auth.logout(raw, { userId, ip: clientIp(req), userAgent: req.headers["user-agent"] });
      return respond(res, { ok: true });
    }

    if (!userId) return respond(res, { error: "Non authentifié" }, 401);
    if (!user) return respond(res, { error: "Utilisateur introuvable" }, 404);

    /* Changement de mot de passe (session requise).
       Révoque toutes les sessions : si le changement fait suite à un
       soupçon de compromission, les sessions ouvertes ailleurs tombent. */
    if (method === "POST" && pathname === "/api/auth/password") {
      if (isRateLimited(req, res)) return;
      const payload = await readBody(req, 1024);
      if (payload.__tooLarge) return respond(res, { error: "Requête trop volumineuse" }, 413);
      const r = await Auth.changePassword(user.id, payload.currentPassword, payload.newPassword, {
        ip: clientIp(req), userAgent: req.headers["user-agent"],
      });
      if (!r.ok) return respond(res, { error: r.error, missing: r.missing }, r.status);
      return respond(res, { ok: true, revokedSessions: r.revokedSessions, mustReconnect: true });
    }

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
      /* Un tournoi dont l'heure de début est passée n'accepte plus d'inscription. */
      if (t.starts_at && new Date(t.starts_at).getTime() <= Date.now())
        return respond(res, { error: "Tournoi déjà commencé" }, 400);
      /* La colonne `tournaments.min_rank` reste en base (historique) mais n'est jamais lue. */
      const count = db.prepare("SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ?").get(t.id).c;
      if (count >= t.max_players) return respond(res, { error: "Tournoi complet" }, 400);
      if (user.balance < t.entry) return respond(res, { error: `Solde insuffisant` }, 400);
      if (t.entry > 0 && !user.kyc) return respond(res, { error: "KYC requis" }, 403);
      Tournament.register(user.id, t.id);
      if (!user.bonus_used && t.entry > 0) {
        User.update(user.id, { bonus_used: true });
        Wallet.credit(user.id, 1000, "Bonus de bienvenue", true);
      }
      Wallet.spend(user.id, t.entry, `Mise entrée - ${t.name}`);
      const bal = Wallet.getBalance(user.id);
      sendUser(user.id, walletPayload(user.id));
      Notification.create(user.id, "inscription", { text: `✅ Inscrit au tournoi « ${t.name} »`, tournamentId: t.id, startsAt: t.starts_at });
      // Si le tournoi vient d'être complété → générer le bracket et notifier
      const newCount = db.prepare("SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ?").get(t.id).c;
      if (newCount >= t.max_players) {
        db.prepare("UPDATE tournaments SET status = 'en_cours' WHERE id = ? AND status = 'inscriptions'").run(t.id);
        generateBracket(t.id);
      }
      broadcast({ type: "tournament_update" });
      return respond(res, { ok: true });
    }

    // GET /api/leaderboard
    if (method === "GET" && pathname === "/api/leaderboard")
      return respond(res, { leaderboard: leaderboardForClient(user.id) });

    // POST /api/user/avatar — upload photo de profil (base64)
    if (method === "POST" && pathname === "/api/user/avatar") {
      /* Plafond explicite : une image de 2 Mo occupe ~2,7 Mo encodée en
         base64. Partout ailleurs, l'API se contente du défaut de 64 Ko. */
      const payload = await readBody(req, 4 * 1024 * 1024);
      if (payload.__tooLarge) return respond(res, { error: "Image trop lourde (max 2 Mo)" }, 413);
      const dataUrl = payload.avatar || "";
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (!m) return respond(res, { error: "Format image invalide (base64 attendu)" }, 400);
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 2 * 1024 * 1024) return respond(res, { error: "Image trop lourde (max 2 Mo)" }, 400);
      /* Le type déclaré doit correspondre au CONTENU réel (voir imageMagicOk). */
      if (!imageMagicOk(buf, ext)) return respond(res, { error: "Le contenu de l'image ne correspond pas au format déclaré" }, 400);
      const dir = path.join(__dirname, "uploads", "avatars");
      fs.mkdirSync(dir, { recursive: true });
      const fname = `avatar_${user.id}_${Date.now()}.${ext}`;
      const fpath = path.join(dir, fname);
      fs.writeFileSync(fpath, buf);
      User.update(user.id, { avatar: `/uploads/avatars/${fname}` });
      return respond(res, { ok: true, avatar: `/uploads/avatars/${fname}` });
    }

    // GET /api/skins
    if (method === "GET" && pathname === "/api/skins") {
      /* Apparence des pions : DEUX camps (les miens / ceux de l'adversaire), donc
         deux apparences enregistrées et lues séparément. `colors` reste le
         catalogue complet — chaque couleur porte son `group` (« clair » /
         « sombre ») — et `camps` dit à quel camp chaque groupe s'applique : c'est
         ce qui permet au client de n'offrir que les couleurs de la catégorie. */
      const styles = PionStyle.get(user.id);
      return respond(res, {
        skins: DATA.SKINS_CATALOG,               // chaque skin porte son `type` (LIGHT/DARK) et son prix
        owned: Skins.listOwned(user.id),
        equipped: Skins.getEquipped(user.id),    // { pions_light, pions_dark, plateau, effet }
        colors: DATA.PION_COLORS,
        groups: DATA.PION_GROUPS,
        patterns: DATA.PION_PATTERNS,
        shapes: DATA.PION_SHAPES,                // ronde / carrée / triangulaire
        camps: DATA.PION_CAMPS,                  // light → mes pions, dark → ceux de l'adversaire
        pionStyles: styles,                      // { light: {color,pattern}, dark: {…} }
        /* Compatibilité : `pionStyle` reste l'apparence des pions DU JOUEUR (camp
           `light`) — c'est exactement ce que portait l'ancienne ligne unique, et
           les clients d'avant cette version ne lisent que ces deux champs. La
           source de vérité est `pionStyles`. */
        pionStyle: styles.light,
      });
    }

    // POST /api/pion/style — couleur et motif d'un camp (deux choix indépendants)
    if (method === "POST" && pathname === "/api/pion/style") {
      const payload = await readBody(req);
      /* Le camp est DÉCLARÉ par le client (`light` par défaut : les clients d'avant
         cette version ne l'envoient pas) puis VÉRIFIÉ — jamais cru. */
      const camp = (payload.camp === undefined || payload.camp === null || payload.camp === "")
        ? DATA.PION_DEFAULT_CAMP
        : String(payload.camp).toLowerCase();
      /* Validation contre les CATALOGUES serveur : un identifiant absent est
         refusé (400) et rien n'est écrit. C'est ce qui interdit d'enregistrer un
         « skin » combiné ou une couleur inventée par un appel direct. */
      if (!DATA.pionCamp(camp))
        return respond(res, { error: "Camp de pions inconnu" }, 400);
      if (!DATA.pionColor(payload.color))
        return respond(res, { error: "Couleur de pion inconnue" }, 400);
      if (!DATA.pionPattern(payload.pattern))
        return respond(res, { error: "Motif de pion inconnu" }, 400);
      /* La FORME (ronde / carrée / triangulaire) est un TROISIÈME axe, validé comme
         les deux autres contre le catalogue serveur. Un client d'avant cette version
         ne l'envoie pas : la forme ENREGISTRÉE est alors conservée telle quelle (un
         changement de couleur depuis un ancien client ne remet pas la silhouette à
         zéro) — mais une forme INCONNUE est refusée (400), jamais remplacée en
         silence : le client ne peut pas croire avoir enregistré autre chose. */
      const shapeBrut = payload.shape;
      const shape = (shapeBrut === undefined || shapeBrut === null || shapeBrut === "")
        ? null
        : String(shapeBrut).toLowerCase();
      if (shape !== null && !DATA.pionShape(shape))
        return respond(res, { error: "Forme de pion inconnue" }, 400);
      /* ÉTANCHÉITÉ : la couleur doit appartenir au GROUPE du camp visé. Une
         couleur sombre (« Noir », « Bleu marine »…) ne peut donc JAMAIS être
         enregistrée pour les pions clairs, ni une couleur claire pour les sombres
         — y compris par appel direct à l'API, sans passer par l'interface. */
      if (!DATA.pionColorFitsCamp(payload.color, camp)) {
        const c = DATA.pionColor(payload.color), k = DATA.pionCamp(camp);
        return respond(res, {
          error: `Couleur ${c.group === "clair" ? "claire" : "sombre"} : les ${k.label.toLowerCase()} n'acceptent que les couleurs ${k.group === "clair" ? "claires" : "sombres"}`,
        }, 400);
      }
      PionStyle.set(user.id, camp, payload.color, payload.pattern, shape || undefined);
      const styles = PionStyle.get(user.id);
      return respond(res, { ok: true, camp, pionStyles: styles, pionStyle: styles.light });
    }

    // POST /api/skins/buy
    if (method === "POST" && pathname === "/api/skins/buy") {
      const payload = await readBody(req);
      const sk = DATA.SKINS_CATALOG.find((s) => s.id === payload.skinId);
      if (!sk) return respond(res, { error: "Skin introuvable" }, 404);
      /* Déjà possédé : refus AVANT tout débit — un double appel ne peut pas
         retirer le prix deux fois. */
      if (Skins.listOwned(user.id).includes(sk.id))
        return respond(res, { error: "Skin deja possede" }, 400);
      /* Un skin clair et son pendant sombre : deux transactions distinctes. */
      if (sk.price && sk.price > 0) {
        if (user.balance < sk.price) return respond(res, { error: "Solde insuffisant" }, 400);
        Wallet.spend(user.id, sk.price, `Achat ${sk.name}`);
      }
      Skins.buy(user.id, sk.id);
      const bal = Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: bal.balance });
    }

    // POST /api/skins/equip
    if (method === "POST" && pathname === "/api/skins/equip") {
      const payload = await readBody(req);
      const sk = DATA.SKINS_CATALOG.find((s) => s.id === payload.skinId);
      if (!sk) return respond(res, { error: "Skin introuvable" }, 404);
      /* Le slot est DÉDUIT DU TYPE du skin (catalogue serveur) : un skin LIGHT
         ne peut viser que les pions clairs, un skin DARK que les pions sombres.
         `type`/`slot` envoyés par le client ne sont qu'une revendication : s'ils
         contredisent le catalogue, l'équipement est refusé (400) — un appel
         direct ne peut pas forcer un skin incompatible sur un camp. */
      if (!DATA.skinSlotMatches(sk, payload.slot || payload.type))
        return respond(res, { error: "Skin incompatible avec ce type de pion" }, 400);
      const slot = DATA.skinSlot(sk);
      if (!slot) return respond(res, { error: "Skin non equipable" }, 400);
      if (!Skins.listOwned(user.id).includes(sk.id)) return respond(res, { error: "Skin non possede" }, 403);
      const r = Skins.equip(user.id, slot, sk.id);
      if (!r.ok) return respond(res, { error: r.error }, 400);
      return respond(res, { ok: true, slot, equipped: Skins.getEquipped(user.id) });
    }

    // GET /api/transactions — historique paginé de l'écran Wallet.
    // Paramètres (tous facultatifs) : page, size (nombre ou « all »), period
    // (all|recent|old), from/to (AAAA-MM-JJ), kind, q, method, status, sort
    // (asc|desc). Sans paramètre, le comportement historique est conservé :
    // les 50 derniers mouvements. Chaque ligne porte son `kind` (famille) et
    // son `method` (moyen), calculés par le serveur — le client affiche.
    if (method === "GET" && pathname === "/api/transactions") {
      const qs = new URL(req.url, "http://x").searchParams;
      const w = (key) => qs.get(key);
      const result = Wallet.history(user.id, {
        page: w("page"), size: w("size"), period: w("period"), from: w("from"),
        to: w("to"), kind: w("kind"), q: w("q"), method: w("method"),
        status: w("status"), sort: w("sort"),
      });
      return respond(res, { transactions: result.items, total: result.total, page: result.page, size: result.size });
    }

    // GET /api/transactions/export — même historique que l'écran (mêmes
    // filtres) mais COMPLET et en CSV, généré côté serveur : l'export ne
    // dépend donc pas de la page affichée. Le nom de fichier n'expose que le
    // pseudo translittéré (un en-tête HTTP ne transporte pas d'accent).
    if (method === "GET" && pathname === "/api/transactions/export") {
      const qs = new URL(req.url, "http://x").searchParams;
      const w = (key) => qs.get(key);
      const { items } = Wallet.history(user.id, {
        size: "all", period: w("period"), from: w("from"), to: w("to"),
        kind: w("kind"), q: w("q"), method: w("method"), status: w("status"), sort: w("sort"),
      });
      const slug = String(user.pseudo || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="d-aona-transactions${slug ? "-" + slug : ""}.csv"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(DATA.txCsv(items));
    }

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
        /* Demandes arrivées DEPUIS la dernière ouverture de l'écran Amis : c'est
           la seule source du badge de l'icône Amis (voir POST /api/friends/seen). */
        newIncoming: FriendRequest.newIncoming(user.id),
        /* Filigrane serveur (dernière demande reçue) : le client s'en sert pour
           ignorer une réponse partie AVANT qu'il n'ait consulté l'écran — sans lui,
           le badge se rallumait aussitôt après avoir été éteint. */
        newSinceId: FriendRequest.incomingWatermark(user.id),
      });
    }

    // POST /api/friends/seen — « j'ai vu l'écran Amis » : le badge retombe à zéro
    /* Repère persisté en BASE (migration 007) : le badge doit rester éteint
       après un rechargement, sinon il se rallumerait à chaque visite. */
    if (method === "POST" && pathname === "/api/friends/seen") {
      const w = FriendRequest.markSeen(user.id);
      return respond(res, { ok: true, newIncoming: 0, newSinceId: w.seen });
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
      return respond(res, { formats: DATA.FORMATS, games: DATA.GAMES_CATALOG, provinces: DATA.PROVINCES, operators: DATA.OPERATORS });

    // GET /api/games/history
    if (method === "GET" && pathname === "/api/games/history")
      return respond(res, { games: GameRecord.listForUser(user.id) });

    // GET /api/games/live — parties en cours (écran Match, onglet « En direct »).
    //   ?scope=contacts (défaut) : uniquement les amis + contacts — c'est le
    //      périmètre historique, celui qui protège la vie privée des joueurs.
    //   ?scope=all : toutes les parties non-IA en cours (filtre « Toutes les
    //      parties »). Les parties d'entraînement (mode « ai ») n'y figurent
    //      jamais, et la liste est plafonnée : c'est un fil de découverte, pas
    //      un export de l'activité du serveur.
    if (method === "GET" && pathname === "/api/games/live") {
      const scope = url.searchParams.get("scope") === "all" ? "all" : "contacts";
      const known = new Set();
      if (scope === "contacts") {
        Friend.list(user.id).forEach((f) => known.add(f.id));
        Chat.getContacts(user.id).forEach((c) => known.add(c.id));
      }
      const live = [];
      for (const s of sessions.values()) {
        if (s.over || s.mode === "ai") continue;
        if (!s.player1.id || !s.player2 || !s.player2.id) continue;
        if (scope === "contacts" && !known.has(s.player1.id) && !known.has(s.player2.id)) continue;
        live.push({
          sessionId: s.sessionId, game: s.game, mode: s.mode, format: s.format.id, wager: s.wager,
          player1: { id: s.player1.id, pseudo: s.player1.pseudo, elo: s.player1.elo },
          player2: { id: s.player2.id, pseudo: s.player2.pseudo, elo: s.player2.elo },
          moves: (s.moves || []).length, phase: s.phase,
          /* Pions restants : la seule mesure de « score » que le serveur puisse
             prouver (GameSession n'a pas de compteur de manches). Le fil ne
             montre donc jamais un score inventé. */
          pieces1: piecesLeftOf(s, 1), pieces2: piecesLeftOf(s, 2),
        });
        if (live.length >= LIVE_FEED_MAX) break;
      }
      return respond(res, { live, scope });
    }

    // GET /api/challenges — défis REÇUS (en attente) et ENVOYÉS (tous statuts).
    // L'onglet « Défis » montre les deux colonnes ; le client n'avait jusqu'ici
    // que les défis reçus (poussés par WebSocket).
    if (method === "GET" && pathname === "/api/challenges") {
      /* `createdAt` / `expiresAt` sont les seules sources du compte à rebours de
         la carte de défi : le client ne fabrique aucune durée. Normalisées en
         ISO-UTC, elles se parsent de la même façon dans tous les fuseaux. La
         date SQLite brute n'est PAS exposée : « 2026-09-17 20:39:46 » se lirait
         comme une heure locale côté navigateur. */
      const strip = (c) => ({
        id: c.id, wager: c.wager, format: c.format, game: c.game, status: c.status,
        createdAt: toIsoUtc(c.created_at), expiresAt: toIsoUtc(c.expires_at),
        /* Identifiants des DEUX camps : sans eux, l'interface ne peut pas ouvrir
           le profil d'un joueur par son id (elle n'a que des pseudos, qui peuvent
           être modifiés). */
        fromId: c.from_id, toId: c.to_id,
        fromPseudo: c.from_pseudo, fromElo: c.from_elo, fromAvatar: c.from_avatar || null,
        toPseudo: c.to_pseudo, toElo: c.to_elo, toAvatar: c.to_avatar || null,
      });
      return respond(res, {
        received: Challenge.getByUser(user.id).map(strip),
        sent: Challenge.listSent(user.id).map(strip),
      });
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
      /* Bonus de bienvenue : UNE SEULE FOIS par compte.
         L'ancien code le recréditait à CHAQUE dépôt tant que le KYC n'était pas
         fait : 5 000 Ar bloqués (non retirables, mais dépensables en mises et en
         entrées de tournoi) s'ajoutaient indéfiniment, dépôt après dépôt. */
      if (!user.kyc && !user.bonus_used) {
        Wallet.credit(user.id, 5000, "Crédit de bienvenue", true);
        db.prepare("UPDATE users SET bonus_used = 1 WHERE id = ?").run(user.id);
      }
      /* Montant : entier positif. Valeur absente ou zéro → 5 000 (comportement
         historique) ; valeur NÉGATIVE refusée — un « dépôt » négatif débiterait
         le wallet au lieu de le créditer. Libellé d'opérateur borné (40). */
      const depAmount = parseInt(payload.amount, 10);
      if (Number.isFinite(depAmount) && depAmount < 0) return respond(res, { error: "Montant invalide" }, 400);
      Wallet.credit(user.id, (Number.isFinite(depAmount) && depAmount !== 0) ? depAmount : 5000, `Dépôt ${String(payload.operator || "MVola").slice(0, 40)}`);
      const bal = Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: bal.balance, bonusLock: bal.bonus_lock });
    }

    // POST /api/withdraw
    if (method === "POST" && pathname === "/api/withdraw") {
      const payload = await readBody(req);
      const amount = parseInt(payload.amount) || 0;
      if (amount < 1000) return respond(res, { error: "Minimum 1000 Ar" }, 400);
      /* Plafond QUOTIDIEN (500 000 Ar/jour) appliqué côté serveur, sur la somme
         réelle des retraits du jour : le formulaire client l'affiche, la règle
         vit ici. */
      const withdrawnToday = Wallet.withdrawnToday(user.id);
      if (amount > 500000 - withdrawnToday)
        return respond(res, { error: "Plafond quotidien de retrait atteint (max. 500 000 Ar/jour)" }, 400);
      const bal = Wallet.getBalance(user.id);
      const available = bal.balance - bal.bonus_lock;
      if (amount > available) return respond(res, { error: "Solde insuffisant" }, 400);
      Wallet.spend(user.id, amount, `Retrait ${String(payload.operator || "MVola").slice(0, 40)}`);
      const nBal = Wallet.getBalance(user.id);
      return respond(res, { ok: true, balance: nBal.balance, bonusLock: nBal.bonus_lock });
    }

    // ---------- Notifications centralisées ----------

    // GET /api/notifications — historique trié (récent → ancien) + compteur non lus
    if (method === "GET" && pathname === "/api/notifications") {
      return respond(res, {
        notifications: Notification.list(user.id),
        unread: Notification.unreadCount(user.id),
      });
    }

    // POST /api/notifications/:id/read — marquer une notification comme lue
    if (method === "POST" && /^\/api\/notifications\/\d+\/read$/.test(pathname)) {
      const id = parseInt(pathname.split("/")[3]);
      Notification.markRead(id, user.id);
      return respond(res, { ok: true, unread: Notification.unreadCount(user.id) });
    }

    // POST /api/notifications/read-all — tout marquer comme lu
    if (method === "POST" && pathname === "/api/notifications/read-all") {
      Notification.markAllRead(user.id);
      return respond(res, { ok: true, unread: 0 });
    }

    // ---------- Tournois : détail, bracket, confirmation, mes tournois ----------

    // GET /api/tournaments/my — tournois où le joueur est inscrit (accueil)
    if (method === "GET" && pathname === "/api/tournaments/my") {
      const regs = db.prepare(`
        SELECT t.* FROM tournaments t
        JOIN tournament_registrations r ON r.tournament_id = t.id
        WHERE r.user_id = ? ORDER BY t.starts_at ASC
      `).all(user.id);
      const mine = regs.map((t) => {
        const matches = TournamentMatch.listByTournament(t.id);
        const myMatches = matches.filter((m) => m.p1_id === user.id || m.p2_id === user.id);
        const played = myMatches.filter((m) => m.status === "termine" || m.status === "forfait").length;
        const next = myMatches.find((m) => m.status === "a_venir" || m.status === "confirmation");
        const won = myMatches.filter((m) => m.winner_id === user.id).length;
        return {
          id: t.id, name: t.name, status: t.status, format: t.format, starts_at: t.starts_at,
          max_players: t.max_players,
          matchesPlayed: played, matchesTotal: myMatches.length, matchesWon: won,
          nextMatch: next ? {
            id: next.id, round: next.round, starts_at: next.starts_at,
            opponent: next.p1_id === user.id ? next.p2_pseudo : next.p1_pseudo,
            /* Identifiant de l'adversaire : sans lui, aucun lien fiable vers son
               profil (le pseudo n'est pas une clé). */
            opponentId: next.p1_id === user.id ? next.p2_id : next.p1_id,
            status: next.status,
            confirmed: next.p1_id === user.id ? !!next.confirmed_p1 : !!next.confirmed_p2,
            confirm_deadline: next.confirm_deadline,
          } : null,
        };
      });
      return respond(res, { tournaments: mine });
    }

    // GET /api/tournaments/:id — détail complet + bracket
    if (method === "GET" && /^\/api\/tournaments\/\d+$/.test(pathname)) {
      const id = parseInt(pathname.split("/")[3]);
      const t = Tournament.get(id);
      if (!t) return respond(res, { error: "Tournoi introuvable" }, 404);
      const regs = Tournament.getRegistrations(id);
      const matches = TournamentMatch.listByTournament(id);
      return respond(res, {
        tournament: { ...t, participants: regs.length, registeredCount: regs.length },
        registrations: regs,
        matches,
        meRegistered: regs.some((r) => r.id === user.id),
      });
    }

    // POST /api/tournaments/:id/confirm — confirmation de présence au prochain match
    if (method === "POST" && /^\/api\/tournaments\/\d+\/confirm$/.test(pathname)) {
      const tid = parseInt(pathname.split("/")[3]);
      const matches = TournamentMatch.listByTournament(tid);
      const myNext = matches.find((m) => (m.p1_id === user.id || m.p2_id === user.id) && (m.status === "confirmation" || m.status === "a_venir"));
      if (!myNext) return respond(res, { error: "Aucun match à confirmer" }, 404);
      // Vérifier fenêtre de confirmation
      if (myNext.confirm_deadline) {
        const nowD = new Date();
        const deadline = new Date(myNext.confirm_deadline);
        if (nowD > deadline) return respond(res, { error: "Fenêtre de confirmation fermée — forfait automatique" }, 400);
      }
      const which = myNext.p1_id === user.id ? 1 : 2;
      TournamentMatch.confirm(myNext.id, which);
      Notification.create(user.id, "confirmation", { text: `Présence confirmée pour le match #${myNext.id}`, tournamentId: tid });
      sendUser(user.id, { type: "tournament_update", tournamentId: tid });
      return respond(res, { ok: true, match: TournamentMatch.get(myNext.id) });
    }

    respond(res, { error: "Route non trouvee" }, 404);
  })().catch((err) => {
    console.error("REST error:", err);
    respond(res, { error: "Erreur serveur" }, 500);
  });
}

/* Les dates SQLite sortent en « YYYY-MM-DD HH:MM:SS » (UTC, sans suffixe).
   `new Date("2026-09-17 12:34:56")` est interprété comme une heure LOCALE par
   les navigateurs : le compte à rebours d'un défi serait décalé du fuseau.
   On normalise donc en ISO-UTC avant l'envoi. Accepte aussi un timestamp ms
   (ce que renvoie Challenge.create juste après l'insertion). */
function toIsoUtc(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v).toISOString();
  const s = String(v).trim();
  if (/Z$|[+-]\d\d:?\d\d$/.test(s)) return s;
  return new Date(s.replace(" ", "T") + "Z").toISOString();
}

/* Liste des défis en attente d'un joueur, prête pour le client : les dates sont
   normalisées en ISO-UTC, exactement comme dans l'API REST — sinon le compte à
   rebours de la carte de défi se décalerait du fuseau (SQLite renvoie des dates
   « locales à l'œil » alors qu'elles sont en UTC). */
function challengeFeed(userId) {
  return Challenge.getByUser(userId).map((c) => ({
    ...c, created_at: toIsoUtc(c.created_at), expires_at: toIsoUtc(c.expires_at),
  }));
}

/* Numéro du joueur à l'origine d'un message WS : 1, 2 — ou 0 si l'émetteur
   n'est pas joueur de cette partie (spectateur, tiers). Contrôle
   d'appartenance des actions de partie : sans lui, n'importe quel client
   connecté pouvait jouer — ou abandonner — à la place d'un joueur. */
function playerNumOf(session, userId) {
  if (session.player1 && session.player1.id === userId) return 1;
  if (session.player2 && session.player2.id === userId) return 2;
  return 0;
}

/* ---------- WebSocket handler ---------- */
function handleWsMessage(ws, msg) {
  const conn = connections.get(ws);

  // Auth is always allowed
  if (msg.type === "auth") {
    /* Validation EN BASE : session existante, non expirée, non révoquée. */
    const session = Auth.resolveSession(msg.token);
    if (!session) { send(ws, { type: "error", message: "Session invalide ou expirée" }); return; }
    const user = User.getById(session.userId);
    if (!user) { send(ws, { type: "error", message: "Utilisateur introuvable" }); return; }
    connections.set(ws, { userId: user.id, pseudo: user.pseudo });
    userSockets.set(user.id, ws);
    // Reconnexion : annule les délais de grâce d'abandon en cours, puis re-synchronise l'état.
    /* UN délai par partie en cours (voir handleDisconnect) : on les annule TOUS,
       sinon une partie restait programmée pour l'abandon alors que le joueur
       venait de revenir. */
    for (const [key, e] of disconnectTimers) {
      if (e.userId !== user.id) continue;
      clearTimeout(e.timer);
      disconnectTimers.delete(key);
    }
    const curSession = findUserSession(user.id);
    if (curSession) dispatchGameState(curSession);
    const challenges = challengeFeed(user.id);
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
      const game = msg.game || mm.DEFAULT_GAME;
      const mode = msg.mode || "online";
      /* Le demandeur ne sort de la file qu une fois l adversaire trouve :
         tant que personne ne se presente, il reste en attente. */
      const opponent = mode === "online" ? mm.takeOpponent(game, fmt, conn.userId) : null;
      if (opponent) {
        const key = "PM-" + crypto.randomBytes(4).toString("hex").toUpperCase();
        const p1 = User.getById(conn.userId);
        const p2 = User.getById(opponent.userId);
        pendingMatches.set(key, { p1: conn.userId, p2: opponent.userId, p1Ready: false, p2Ready: false, format: fmt, game });
        sendUser(conn.userId, { type: "match_found", matchKey: key, opponent: { pseudo: p2.pseudo, elo: p2.elo, id: p2.id }, format: fmt, game, playerNum: 1 });
        sendUser(opponent.userId, { type: "match_found", matchKey: key, opponent: { pseudo: p1.pseudo, elo: p1.elo, id: p1.id }, format: fmt, game, playerNum: 2 });
      } else if (mode === "ai") {
        createGameSession(conn.userId, null, "ai", fmt, 0, game);
      } else {
        mm.enqueue(game, fmt, { userId: conn.userId, pseudo: conn.pseudo, mode });
        send(ws, { type: "matchmaking", status: "searching" });
      }
      break;
    }
    case "cancel_match": {
      mm.removeUser(conn.userId);
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
        createGameSession(pm.p1, pm.p2, "online", pm.format, 0, pm.game);
      }
      break;
    }
    case "move": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.over) return;
      /* Anti-triche : seul le joueur DONT C'EST LE TOUR peut jouer. */
      if (session.phase === "play" && playerNumOf(session, conn.userId) !== session.turn) {
        send(ws, { type: "error", message: "Ce n'est pas votre tour", sessionId: msg.sessionId });
        return;
      }
      const result = session.applyMove(msg.move);
      if (!result.ok) { send(ws, { type: "error", message: result.error, sessionId: msg.sessionId }); return; }
      persistSession(session);
      dispatchGameState(session);
      if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
      else if (session.turn === 2 && session.mode === "ai") scheduleAiMove(session.sessionId);
      break;
    }
    case "pick_side": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.phase !== "choose") { send(ws, { type: "error", message: "Choix indisponible", sessionId: msg.sessionId }); return; }
      const playerNum = playerNumOf(session, conn.userId);
      /* Un tiers (spectateur) ne choisit pas une face à la place d'un joueur. */
      if (!playerNum) { send(ws, { type: "error", message: "Vous n'êtes pas joueur de cette partie", sessionId: msg.sessionId }); return; }
      const result = session.pickSide(playerNum, msg.side);
      if (result.error) send(ws, { type: "error", message: result.error, sessionId: msg.sessionId });
      // Mode IA (entraînement en ligne) : l'IA (joueur 2) reçoit automatiquement
      // la face restante — le tirage se résout dès que le joueur 1 a choisi.
      if (session.mode === "ai" && session.phase === "choose" && playerNum === 1 && session.choices[2] === null) {
        const remaining = session.choices[1] === "pile" ? "face" : "pile";
        session.pickSide(2, remaining);
      }
      persistSession(session);
      dispatchGameState(session);
      if (session.phase === "play" && session.turn === 2 && session.mode === "ai") scheduleAiMove(session.sessionId);
      break;
    }
    case "resign": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.over) return;
      const playerNum = playerNumOf(session, conn.userId);
      /* Un tiers ne peut pas abandonner à la place d'un joueur. */
      if (!playerNum) { send(ws, { type: "error", message: "Vous n'êtes pas joueur de cette partie", sessionId: msg.sessionId }); return; }
      const result = session.resign(playerNum);
      if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
      break;
    }
    case "end_chain": {
      const session = sessions.get(msg.sessionId);
      if (!session || session.over || !session.chain) return;
      /* Seul le joueur en chaîne peut la terminer. */
      if (playerNumOf(session, conn.userId) !== session.turn) {
        send(ws, { type: "error", message: "Ce n'est pas votre tour", sessionId: msg.sessionId });
        return;
      }
      const result = session.endChain();
      persistSession(session);
      dispatchGameState(session);
      if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
      else if (session.turn === 2 && session.mode === "ai") scheduleAiMove(session.sessionId);
      break;
    }
    case "sync_game": {
      // Resynchronisation à la (re)connexion : renvoie l'état autoritaire courant.
      const session = (msg.sessionId && sessions.get(msg.sessionId)) || findUserSession(conn.userId);
      /* RIEN À REPRENDRE : on le DIT. Sans cette réponse, un client qui a perdu
         sa session (redémarrage du serveur) gardait un bandeau « Reprendre »
         qui ne menait nulle part. Le contrat est le même pour tous les jeux. */
      if (!session || session.over) { send(ws, { type: "no_active_game" }); break; }
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
      send(ws, { type: "spectate_state", sessionId: session.sessionId, game: session.game, state: session.getState() });
      break;
    }
    case "unspectate": {
      const set = spectators.get(msg.sessionId);
      if (set) { set.delete(conn.userId); if (!set.size) spectators.delete(msg.sessionId); }
      break;
    }
    case "chat_message": {
      /* Bornes SERVEUR : un client modifié peut ignorer les limites du
         formulaire — type, longueur et caractères de contrôle se vérifient ici.
         (L'échappement HTML vit au rendu côté client.) */
      if (typeof msg.toPseudo !== "string" || typeof msg.text !== "string") {
        send(ws, { type: "error", message: "Message invalide" }); return;
      }
      if (!allowChatMessage(conn.userId)) {
        send(ws, { type: "error", message: "Trop de messages — patientez un instant" }); return;
      }
      const text = msg.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 500);
      if (!text.trim()) { send(ws, { type: "error", message: "Message vide" }); return; }
      const otherUser = User.getByPseudo(msg.toPseudo);
      if (!otherUser) { send(ws, { type: "error", message: "Joueur introuvable" }); return; }
      Chat.saveMessage(conn.userId, otherUser.id, text);
      const at = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      sendUser(otherUser.id, { type: "chat_message", from: user.pseudo, text, at });
      send(ws, { type: "chat_message", from: user.pseudo, to: otherUser.pseudo, text, at, direction: "me" });
      break;
    }
    case "send_challenge": {
      const targetUser = User.getByPseudo(msg.toPseudo);
      if (!targetUser) { send(ws, { type: "error", message: "Joueur introuvable" }); return; }
      const wager = parseInt(msg.wager) || 0;
      /* Le defi porte le PLATEAU : l envoyeur choisit un Tsivy, un Dimy ou un
         Telo dans l assistant, et le destinataire accepte CE plateau-la. */
      const game = Registry.has(msg.game) ? msg.game : Registry.DEFAULT;
      if (wager < 500) { send(ws, { type: "error", message: "Mise minimale de 500 Ar requise — les défis gratuits ne sont pas autorisés" }); return; }
      if (!user.kyc) { send(ws, { type: "error", message: "KYC requis" }); return; }
      if (user.balance < wager) { send(ws, { type: "error", message: "Solde insuffisant" }); return; }
      Wallet.spend(user.id, wager, `Mise défi vs ${targetUser.pseudo}`);
      const ch = Challenge.create(user.id, targetUser.id, wager, msg.format, game);
      /* Le solde affiché doit suivre le débit : sans cette poussée, la barre du
         haut continuait d'annoncer l'ancien solde après un défi avec mise. */
      send(ws, walletPayload(user.id));
      sendUser(targetUser.id, { type: "challenge_received", challenge: {
        id: ch.id, from: user.pseudo, fromId: user.id, fromAvatar: user.avatar || null, fromElo: user.elo, wager, format: msg.format, game,
        createdAt: toIsoUtc(Date.now()), expiresAt: toIsoUtc(ch.expires_at)
      }});
      send(ws, { type: "challenge_sent", challengeId: ch.id, to: targetUser.pseudo, game });
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
        Wallet.spend(user.id, ch.wager, `Mise défi vs ${fromUser.pseudo}`);
        /* Même règle que pour l'envoi : la mise engagée se voit tout de suite. */
        send(ws, walletPayload(user.id));
      }
      Challenge.update(msg.challengeId, "accepted");
      createGameSession(fromUser.id, user.id, "defi", ch.format, ch.wager, ch.game);
      sendUser(fromUser.id, { type: "challenge_accepted", challengeId: msg.challengeId });
      break;
    }
    /* Annulation par l'EXPÉDITEUR (bouton « Annuler le défi » de l'onglet
       Défis) : miroir exact du refus — la mise repart chez l'envoyeur, le défi
       sort des « en attente », et le destinataire voit sa carte disparaître
       sans avoir à recharger (même poussée que celle de la reconnexion). */
    case "cancel_challenge": {
      const ch = Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending" || ch.from_id !== user.id) return;
      Challenge.update(msg.challengeId, "cancelled");
      if (ch.wager > 0) {
        Wallet.credit(ch.from_id, ch.wager, "Défi annulé - remboursement");
        send(ws, walletPayload(ch.from_id));
      }
      send(ws, { type: "challenge_status", challengeId: msg.challengeId, status: "cancelled" });
      const targeted = challengeFeed(ch.to_id);
      sendUser(ch.to_id, { type: "challenges_update", challenges: targeted });
      break;
    }
    case "reject_challenge": {
      const ch = Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending" || ch.to_id !== user.id) return;
      Challenge.update(msg.challengeId, "rejected");
      // Refund sender
      if (ch.wager > 0) {
        Wallet.credit(ch.from_id, ch.wager, "Défi refusé - remboursement");
        sendUser(ch.from_id, walletPayload(ch.from_id));
      }
      sendUser(ch.from_id, { type: "challenge_status", challengeId: msg.challengeId, status: "rejected" });
      break;
    }
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
  /* `game` et `playerNum` voyagent avec l etat : le client sait QUEL plateau
     peindre et QUEL camp il tient, sans dependre de ce qu il croyait lancer
     (reprise apres rechargement, defi recu, matchmaking). Deux champs, une
     seule regle pour tous les plateaux — un jeu futur n a rien a ajouter. */
  const game = session.game;
  if (p1ws) send(p1ws, { type: "game_state", sessionId: session.sessionId, game, playerNum: 1, state: st });
  if (p2ws) send(p2ws, { type: "game_state", sessionId: session.sessionId, game, playerNum: 2, state: st });
  // Diffusion aux spectateurs du match (lecture seule)
  const spec = spectators.get(session.sessionId);
  if (spec) for (const uid of spec) {
    const sws = userSockets.get(uid);
    if (sws) send(sws, { type: "spectate_state", sessionId: session.sessionId, game, state: st });
  }
}

/* Session EN COURS d un joueur. La plus RÉCENTE l emporte : `sessions` garde
   l ordre d insertion, et une vieille partie restée ouverte (adversaire
   parti) ne doit pas masquer celle qui vient de commencer. */
function findUserSession(userId) {
  let found = null;
  for (const s of sessions.values()) {
    if (s.over) continue;
    if (s.player1.id === userId || (s.player2 && s.player2.id === userId)) found = s;
  }
  return found;
}

/* ---------- PERSISTANCE DES PARTIES (reprise après redémarrage) ----------
   `state_json` ne retenait que l'état PUBLIÉ (`getState()`), qui ne suffit pas
   à reconstruire une session : il manque les champs INTERNES du jeu (choix du
   tirage, chaîne de prises, horloge restante réelle…). On y range donc désormais
   un INSTANTANÉ de la session : toutes ses propriétés propres, telles quelles.

   Le socle ne connaît aucun de ces champs — il photographie l'objet et le
   reconstruit à l'identique. C'est ce qui rend la reprise disponible pour tout
   plateau présent ou futur sans une ligne de plus (`test/variantes.js` verrouille
   l'aller-retour état de session ⇄ instantané sur les trois plateaux). */
const SNAPSHOT_V = 1;

function persistSession(session) {
  if (!session || !session.sessionId) return;
  let snap;
  try { snap = JSON.parse(JSON.stringify(session)); } catch (e) { return; }
  GameSessionStore.updateState(session.sessionId, { v: SNAPSHOT_V, session: snap });
}

/* Recharge les parties que le processus n'a pas eu le temps de clore (arrêt,
   plantage, redéploiement). Une ligne dont l'instantané est illisible — ancien
   format, plateau retiré du registre — est close en `abandoned` : on ne devine
   jamais une partie à moitié, et le client reçoit `no_active_game` plutôt qu'un
   plateau fantôme.

   Les horloges ne repartent pas toutes seules : `gameLoop` ne fait tic-tac que
   si le joueur au trait a une socket ouverte. Une partie rechargée sans personne
   en ligne reste donc figée jusqu'au retour d'un joueur. */
function rehydrateSessions() {
  let rows = [];
  try {
    rows = db.prepare("SELECT * FROM game_sessions WHERE status = 'playing'").all();
  } catch (e) {
    console.error("reprise : lecture des sessions impossible", e);
    return;
  }
  let n = 0;
  for (const row of rows) {
    let snap = null;
    try {
      const data = JSON.parse(row.state_json || "");
      if (data && data.v === SNAPSHOT_V && data.session) snap = data.session;
    } catch (e) { snap = null; }
    const mod = snap && Registry.has(snap.game) ? Registry.get(snap.game) : null;
    const valide = !!(mod && mod.GameSession && snap.sessionId === row.id
      && snap.player1 && snap.player1.id === row.player1_id
      && snap.clock && snap.mode && !snap.over);
    if (!valide) { GameSessionStore.setStatus(row.id, "abandoned", null, null); continue; }
    /* Même classe de session que la partie d'origine : les méthodes viennent du
       prototype du jeu, les données de l'instantané. */
    const session = Object.create(mod.GameSession.prototype);
    Object.assign(session, snap);
    sessions.set(row.id, session);
    n++;
    /* Le minuteur de l'IA vit dans un `setTimeout` : il est mort avec le
       processus. Si la partie reprend sur son tour, on le réarme. */
    if (session.mode === "ai" && session.turn === 2) {
      setTimeout(() => scheduleAiMove(session.sessionId), 1500);
    }
  }
  if (n) console.log(`[reprise] ${n} partie(s) rechargée(s) depuis la base`);
}

function createGameSession(p1Id, p2Id, mode, formatId, wager, gameId) {
  const sessionId = "GS-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const format = DATA.FORMATS.find((f) => f.id === formatId) || DATA.FORMATS[0];
  /* Le PLATEAU vient du registre. Un identifiant inconnu (vieux client qui
     n envoie pas `game`) retombe sur le jeu par defaut — celui qui existait
     avant l ouverture des autres plateaux, donc jamais une surprise. */
  const game = Registry.has(gameId) ? gameId : Registry.DEFAULT;
  const Session = Registry.get(game).GameSession;
  const p1 = p1Id ? User.getById(p1Id) : null;
  let p2;
  if (mode === "ai" || !p2Id) {
    const aiPseudo = DATA.OPPONENT_POOL[Math.floor(Math.random() * DATA.OPPONENT_POOL.length)].pseudo;
    p2 = { id: 0, pseudo: aiPseudo, elo: Math.max(600, (p1?.elo || 1100) - 60), region: "Madagascar" };
  } else {
    p2 = User.getById(p2Id);
  }
  const p1Obj = p1 || { id: 0, pseudo: "Spectateur", elo: 1000, region: "Madagascar" };
  /* Apparences des pions des DEUX joueurs, posées sur les objets joueurs — comme le
     reste du profil, et AVANT la construction de la session (l'état les publie dès
     le premier `getState`). Le plateau se peint par propriétaire : sans l'apparence
     de l'adversaire, le client n'aurait que la sienne et l'appliquerait aux pions
     d'en face. L'IA (`id: 0`) n'a pas de compte : ses deux apparences sont celles de
     `PION_DEFAULTS` (le pion Vato), jamais celles du joueur. */
  p1Obj.pionStyles = PionStyle.get(p1Obj.id);
  p2.pionStyles = p2.id ? PionStyle.get(p2.id) : { light: { ...DATA.PION_DEFAULTS.light }, dark: { ...DATA.PION_DEFAULTS.dark } };
  const gs = new Session(sessionId, p1Obj, p2, mode, format, wager);
  gs.game = game;
  gs.gameRecordId = GameRecord.create(p1Obj.id, p2.id, mode, formatId, wager, game);
  sessions.set(sessionId, gs);
  GameSessionStore.create(sessionId, p1Obj.id, p2.id, mode, formatId, wager);
  /* Persistée DES LA CREATION : une partie ouverte puis laissée sans le moindre
     coup (tirage en cours, adversaire qui n'a pas encore joue) doit survivre a
     un redemarrage comme les autres. */
  persistSession(gs);

  if (mode === "ai") {
    sendUser(p1Obj.id, { type: "game_start", sessionId, playerNum: 1, game,
      state: gs.getState(), opponent: p2, mode, format, wager });
    setTimeout(() => scheduleAiMove(sessionId), 1000);
  } else {
    sendUser(p1Obj.id, { type: "game_start", sessionId, playerNum: 1, game,
      state: gs.getState(), opponent: p2, mode, format, wager });
    sendUser(p2.id, { type: "game_start", sessionId, playerNum: 2, game,
      state: gs.getState(), opponent: p1Obj, mode, format, wager });
  }
  broadcast({ type: "live_update" });
  return sessionId;
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
  const caps = moves.filter((m) => Array.isArray(m.cap) && m.cap.length);
  let chosen;
  if (caps.length) {
    const best = Math.max(...caps.map((x) => x.cap.length));
    const pool = caps.filter((x) => x.cap.length === best || (Math.random() < 0.25 && x.cap.length === best - 1));
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else {
    chosen = moves[Math.floor(Math.random() * moves.length)];
  }
  const result = session.applyMove(chosen);
  persistSession(session);
  const p1ws = userSockets.get(session.player1.id);
  if (p1ws) send(p1ws, { type: result.gameOver ? "game_end" : "game_state", sessionId, state: result.state });
  if (result.gameOver) handleGameEnd(session, result.winner, result.reason);
  else if (session.turn === 2 && session.mode === "ai") scheduleAiMove(sessionId);
}

/* Pions restants d un camp, quel que soit le plateau : la session du Tsivy
   expose `grid` (5x9), celles des variantes exposent `piecesLeft(side)`. */
function piecesLeftOf(session, side) {
  if (typeof session.piecesLeft === "function") return session.piecesLeft(side);
  return countPieces(session.grid, side);
}

function handleGameEnd(session, winner, reason) {
  if (session._ended) return; // Guard against double-end
  session._ended = true;
  session.over = true;
  const timer = aiTimers.get(session.sessionId);
  if (timer) { clearTimeout(timer); aiTimers.delete(session.sessionId); }

  const isRealGame = session.mode !== "ai" && session.player2.id !== 0;
  const deltas = session.finish(winner);
  const p1Left = piecesLeftOf(session, 1);
  const p2Left = piecesLeftOf(session, 2);

  /* NULLE : le Telo (triple repetition) et le Dimy (60 demi-coups sans prise)
     peuvent finir sans vainqueur — `winner` vaut alors 0 ou null. Ce n est ni
     une victoire ni une defaite : `session.finish` rend un demi-point aux deux
     camps, et les compteurs `wins` / `losses` ne bougent pas. */
  const draw = winner !== 1 && winner !== 2;
  // Update user ELO
  const winnerId = draw ? null : winner === 1 ? session.player1.id : (isRealGame ? session.player2.id : null);
  /* Instantané AVANT/APRÈS (migration 006) : on lit l'Elo RÉELLEMENT en base juste
     avant de l'écrire, et non celui mémorisé à l'ouverture de la session — un
     joueur peut avoir enchaîné une autre partie entre-temps, et la décroissance
     d'inactivité passe aussi par la base. L'interface pourra donc afficher
     « 1120 → 1132 · +12 Elo » sans rien reconstituer. */
  /* PARTIE CLASSÉE ou ENTRAÎNEMENT : seul le classé touche à l'Elo, aux victoires
     et aux défaites. L'écran annonce « Entraînement — aucun impact Elo ni wallet »,
     mais le camp du joueur était mis à jour SANS condition : une partie contre
     l'IA faisait perdre 19 points d'Elo (constaté), ce qui contredisait le texte
     affiché et faussait l'historique présenté comme ses vraies parties. */
  const ranked = session.mode !== "ai";
  const d1 = ranked ? deltas.delta1 : 0;
  const d2 = ranked ? deltas.delta2 : 0;
  const elo1Before = readElo(session.player1.id);
  const elo2Before = isRealGame ? readElo(session.player2.id) : null;
  if (ranked) {
    if (draw) {
      db.prepare("UPDATE users SET elo = elo + ? WHERE id = ?").run(d1, session.player1.id);
    } else if (winner === 1) {
      db.prepare("UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?").run(d1, session.player1.id);
    } else {
      db.prepare("UPDATE users SET elo = elo + ?, losses = losses + 1 WHERE id = ?").run(d1, session.player1.id);
    }
  }
  if (isRealGame) {   // une partie réelle est toujours classée
    if (draw) {
      db.prepare("UPDATE users SET elo = elo + ? WHERE id = ?").run(d2, session.player2.id);
    } else if (winner === 2) {
      db.prepare("UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?").run(d2, session.player2.id);
    } else {
      db.prepare("UPDATE users SET elo = elo + ?, losses = losses + 1 WHERE id = ?").run(d2, session.player2.id);
    }
  }
  const elo1After = elo1Before === null ? null : elo1Before + d1;
  const elo2After = elo2Before === null ? null : elo2Before + d2;

  // Wager payout (defi mode)
  let gain = 0;
  if (session.mode === "defi" && session.wager > 0) {
    if (draw) {
      /* Nulle sur un defi avec mise : la mise engagee par CHAQUE camp revient
         a son proprietaire — l argent ne reste pas au serveur. */
      Wallet.credit(session.player1.id, session.wager, "Défi nul - mise rendue");
      if (isRealGame) Wallet.credit(session.player2.id, session.wager, "Défi nul - mise rendue");
    } else if (winner === 1) {
      gain = Math.round(session.wager * 2 * 0.9);
      Wallet.credit(session.player1.id, gain, `Gain défi vs ${session.player2.pseudo}`);
    } else if (isRealGame && winner === 2) {
      gain = Math.round(session.wager * 2 * 0.9);
      Wallet.credit(session.player2.id, gain, `Gain défi vs ${session.player1.pseudo}`);
    }
  }

  // Finish game record
  if (session.gameRecordId) {
    GameRecord.finish(session.gameRecordId, winnerId, d1, d2, session.moves, reason, {
      p1Before: elo1Before, p1After: elo1After, p2Before: elo2Before, p2After: elo2After,
    });
  }
  /* L'Elo a changé : les classements affichés ailleurs (onglet Classement,
     accueil, profils) doivent suivre SANS rechargement. On ne diffuse que si un
     Elo a réellement bougé — inutile de réveiller tous les clients pour une
     partie qui n'a rien changé. */
  if (d1 || (isRealGame && d2)) broadcast({ type: "leaderboard_update" });
  // Finish game session
  GameSessionStore.setStatus(session.sessionId, "finished", session.moves, winnerId);

  // Si cette partie est un match de tournoi → enregistrer le résultat dans le bracket
  if (session.tournamentMatchId && winnerId) {
    const tm = TournamentMatch.get(session.tournamentMatchId);
    if (tm && tm.status === "en_cours") {
      TournamentMatch.setResult(tm.id, winner === 1 ? 1 : 0, winner === 2 ? 1 : 0, winnerId);
      const loserId = winnerId === tm.p1_id ? tm.p2_id : tm.p1_id;
      const winnerU = User.getById(winnerId);
      if (loserId) notify(loserId, "defaite", { text: `Match perdu contre ${winnerU ? winnerU.pseudo : ""} — ${matchDateLabel(tm.starts_at)}.`, tournamentId: tm.tournament_id, matchId: tm.id });
      notify(winnerId, "victoire", { text: `✅ Match remporté ! Vous avancez dans le bracket.`, tournamentId: tm.tournament_id, matchId: tm.id });
      advanceWinner(TournamentMatch.get(tm.id));
      broadcast({ type: "tournament_update", tournamentId: tm.tournament_id });
    }
  }

  // Send results
  /* Le delta ANNONCÉ est celui réellement enregistré (0 en entraînement) : le
     joueur ne peut pas lire un gain d'Elo que la base n'a pas appliqué. */
  const result1 = {
    winner, reason, draw, game: session.game,
    mode: session.mode, format: session.format, moves: session.moves.length,
    opponent: session.player2.pseudo, meLeft: p1Left, oppLeft: p2Left,
    delta: d1, gain: winner === 1 ? gain : 0,
  };
  if (session.player1.id !== 0) sendUser(session.player1.id, { type: "game_end", sessionId: session.sessionId, result: result1 });
  if (isRealGame && session.player2.id !== 0) {
    const result2 = { ...result1, opponent: session.player1.pseudo, delta: d2,
      meLeft: p2Left, oppLeft: p1Left, gain: winner === 2 ? gain : 0 };
    sendUser(session.player2.id, { type: "game_end", sessionId: session.sessionId, result: result2 });
  }

  // Update wallet for players
  const bal1 = Wallet.getBalance(session.player1.id);
  if (bal1) sendUser(session.player1.id, walletPayload(session.player1.id));
  if (isRealGame && session.player2.id !== 0) {
    const bal2 = Wallet.getBalance(session.player2.id);
    if (bal2) sendUser(session.player2.id, walletPayload(session.player2.id));
  }

  // Notifier les spectateurs de la fin du match
  const spec = spectators.get(session.sessionId);
  if (spec) {
    const winnerPseudo = draw ? null : (winner === 1 ? session.player1.pseudo : session.player2.pseudo);
    for (const uid of spec) sendUser(uid, { type: "spectate_end", sessionId: session.sessionId, game: session.game, winner, winnerPseudo, reason });
    spectators.delete(session.sessionId);
  }

  // Clean up
  sessions.delete(session.sessionId);
  GameSessionStore.delete(session.sessionId);
  broadcast({ type: "live_update" });
}

/* ---------- Moteur de tournoi réel (élimination directe) ---------- */
/* Fenêtre de confirmation : s'ouvre 20 min avant le match, se ferme 5 min avant.
   Passé confirm_deadline sans confirmation → forfait automatique. */
const CONFIRM_OPEN_MIN = 20;
const CONFIRM_CLOSE_MIN = 5;

function notify(userId, type, payload) {
  Notification.create(userId, type, payload);
  sendUser(userId, { type: "notification", notifType: type, payload, unread: Notification.unreadCount(userId) });
}

function matchDateLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/* Génère le bracket complet (1er tour → finale), seedé par Elo décroissant. */
function generateBracket(tournamentId) {
  const t = Tournament.get(tournamentId);
  if (!t) return;
  if (TournamentMatch.listByTournament(tournamentId).length) return; // déjà généré
  // Re-lire les inscrits DIRECTEMENT en base (fraîcheur garantie après la transaction courante)
  const regs = db.prepare(`
    SELECT u.id, u.pseudo, u.elo FROM tournament_registrations r
    JOIN users u ON u.id = r.user_id WHERE r.tournament_id = ?
  `).all(tournamentId);
  if (!regs.length) return; // pas de joueurs → pas de bracket (on attendra les inscrits)
  const players = regs.map((r) => ({ id: r.id, elo: r.elo || 1100 }));
  players.sort((a, b) => b.elo - a.elo);
  let size = 2;
  while (size < players.length) size *= 2;
  while (players.length < size) players.push(null); // bye
  const rounds = Math.log2(size);
  const startBase = t.starts_at ? new Date(t.starts_at) : new Date(Date.now() + 3600000);
  // Timing : en version finale, starts_at du match i = heure_début + index*(durée+intervalle).
  // En mode test (interval_min === 0) : tous les matchs démarrent "maintenant" avec une deadline
  // lointaine → lancement libre, indépendamment des autres matchs (règle du test d'aujourd'hui).
  const isTest = !!(t.interval_min === 0);
  const matchDurMs = (t.match_duration_min || 5) * 60000;
  const intervalMs = (t.interval_min || 5) * 60000;
  const TEST_DEADLINE_LONG = 2 * 60 * 60000; // 2 h (mode test)
  const matchIds = {};
  // Index global croissant dans l'ordre (round, slot) pour l'espacement temporel en version finale
  let globalIndex = 0;
  for (let round = 1; round <= rounds; round++) {
    const count = size / Math.pow(2, round);
    for (let slot = 0; slot < count; slot++) {
      let p1 = null, p2 = null;
      if (round === 1) {
        p1 = players[slot * 2] ? players[slot * 2].id : null;
        p2 = players[slot * 2 + 1] ? players[slot * 2 + 1].id : null;
      }
      let startsAt, confirmDeadline;
      if (isTest) {
        startsAt = new Date(Date.now());
        confirmDeadline = new Date(Date.now() + TEST_DEADLINE_LONG);
      } else {
        // Version finale : Match1 heure_début, puis chaque match espacé de durée+intervalle.
        startsAt = new Date(startBase.getTime() + globalIndex * (matchDurMs + intervalMs));
        confirmDeadline = new Date(startsAt.getTime() - CONFIRM_CLOSE_MIN * 60000);
      }
      matchIds[`${round}-${slot}`] = TournamentMatch.create(tournamentId, round, slot, {
        p1_id: p1, p2_id: p2, starts_at: startsAt.toISOString(),
        confirm_deadline: confirmDeadline.toISOString(), status: "a_venir",
      });
      globalIndex++;
    }
  }
  for (let round = 1; round < rounds; round++) {
    const count = size / Math.pow(2, round);
    for (let slot = 0; slot < count; slot++)
      TournamentMatch.setNext(matchIds[`${round}-${slot}`], matchIds[`${round + 1}-${Math.floor(slot / 2)}`]);
  }
  for (const r of regs)
    notify(r.id, "tournoi_debut", { text: `🏆 Le tournoi « ${t.name} » commence ! Consultez votre bracket.`, tournamentId, startsAt: t.starts_at });
}

/* Avance le vainqueur vers le match suivant, met à jour statuts + notifs. */
function advanceWinner(match) {
  if (!match.winner_id) return;
  if (match.next_match_id) {
    const next = TournamentMatch.get(match.next_match_id);
    if (next) {
      TournamentMatch.setPlayer(next.id, match.slot % 2 === 0 ? 1 : 2, match.winner_id);
      const updated = TournamentMatch.get(next.id);
      if (updated.p1_id && updated.p2_id) {
        TournamentMatch.setStatus(next.id, "a_venir");
        for (const uid of [updated.p1_id, updated.p2_id]) {
          const opp = User.getById(uid === updated.p1_id ? updated.p2_id : updated.p1_id);
          notify(uid, "prochain_match", {
            text: `⚔️ Prochain match contre ${opp ? opp.pseudo : "?"} — ${matchDateLabel(next.starts_at)}`,
            tournamentId: match.tournament_id, matchId: next.id, startsAt: next.starts_at,
          });
        }
        broadcast({ type: "tournament_update", tournamentId: match.tournament_id });
      }
    }
  } else {
    db.prepare("UPDATE tournaments SET status = 'termine' WHERE id = ?").run(match.tournament_id);
    notify(match.winner_id, "tournoi_gagne", { text: `👑 Vous remportez le tournoi !`, tournamentId: match.tournament_id });
    broadcast({ type: "tournament_update", tournamentId: match.tournament_id });
  }
}

/* Boucle matchs de tournoi (gameLoop) : ouvre confirmations 20 min avant,
   déclare forfaits auto à confirm_deadline, lance le match si les 2 confirment. */
function processTournamentMatches() {
  const nowD = new Date();
  // 0. Démarrer les tournois dont la date est atteinte (génère le bracket)
  const toStart = db.prepare(`
    SELECT * FROM tournaments WHERE status = 'inscriptions' AND starts_at IS NOT NULL AND starts_at <= ?
  `).all(nowD.toISOString());
  for (const t of toStart) {
    const cnt = db.prepare("SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ?").get(t.id).c;
    if (!cnt) continue; // personne d'inscrit → on attend
    db.prepare("UPDATE tournaments SET status = 'en_cours' WHERE id = ?").run(t.id);
    generateBracket(t.id);
    broadcast({ type: "tournament_update", tournamentId: t.id });
  }
  // 1. Ouverture des fenêtres de confirmation
  const toOpen = db.prepare(`
    SELECT * FROM tournament_matches
    WHERE status = 'a_venir' AND p1_id IS NOT NULL AND p2_id IS NOT NULL
      AND starts_at IS NOT NULL AND starts_at <= ?
  `).all(new Date(nowD.getTime() + CONFIRM_OPEN_MIN * 60000).toISOString());
  for (const m of toOpen) {
    TournamentMatch.setStatus(m.id, "confirmation");
    for (const uid of [m.p1_id, m.p2_id]) {
      const opp = User.getById(uid === m.p1_id ? m.p2_id : m.p1_id);
      notify(uid, "confirmation_requise", {
        text: `⏰ Confirmez votre présence — match contre ${opp ? opp.pseudo : "?"} à ${matchDateLabel(m.starts_at)}, avant ${matchDateLabel(m.confirm_deadline)} (sinon forfait).`,
        tournamentId: m.tournament_id, matchId: m.id, startsAt: m.starts_at, confirmDeadline: m.confirm_deadline,
      });
    }
    broadcast({ type: "tournament_update", tournamentId: m.tournament_id });
  }

  // 1.5 Mode test (interval_min === 0) : lancer le match immédiatement dès que les 2 joueurs
  //     ont confirmé, indépendamment de la deadline et des autres matchs. (Règle du test.)
  const testReady = db.prepare(`
    SELECT m.*, t.status as t_status FROM tournament_matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.interval_min = 0 AND m.status = 'confirmation'
      AND m.confirmed_p1 = 1 AND m.confirmed_p2 = 1
  `).all();
  for (const m of testReady) {
    TournamentMatch.setStatus(m.id, "en_cours");
    const sid = createGameSession(m.p1_id, m.p2_id, "tournoi", Tournament.get(m.tournament_id)?.format || "rapide", 0);
    const gs = sessions.get(sid);
    if (gs) gs.tournamentMatchId = m.id;
    for (const uid of [m.p1_id, m.p2_id])
      notify(uid, "match_lance", { text: `🎮 Votre match de tournoi commence !`, tournamentId: m.tournament_id, matchId: m.id, sessionId: sid });
    broadcast({ type: "tournament_update", tournamentId: m.tournament_id });
  }

  // 2. Fermeture : forfaits auto ou lancement du match
  const toClose = db.prepare(`
    SELECT m.* FROM tournament_matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE (t.interval_min != 0 OR t.interval_min IS NULL)
      AND m.status = 'confirmation' AND m.confirm_deadline IS NOT NULL AND m.confirm_deadline < ?
  `).all(nowD.toISOString());
  for (const m of toClose) {
    const p1ok = !!m.confirmed_p1, p2ok = !!m.confirmed_p2;
    if (p1ok && p2ok) {
      TournamentMatch.setStatus(m.id, "en_cours");
      // Créer la session de jeu réelle liée à ce match de tournoi
      const sid = createGameSession(m.p1_id, m.p2_id, "tournoi", Tournament.get(m.tournament_id)?.format || "rapide", 0);
      const gs = sessions.get(sid);
      if (gs) gs.tournamentMatchId = m.id;
      for (const uid of [m.p1_id, m.p2_id])
        notify(uid, "match_lance", { text: `🎮 Votre match de tournoi commence !`, tournamentId: m.tournament_id, matchId: m.id, sessionId: sid });
      broadcast({ type: "tournament_update", tournamentId: m.tournament_id });
      continue;
    }
    let winnerId;
    if (p1ok) winnerId = m.p1_id;
    else if (p2ok) winnerId = m.p2_id;
    else {
      const u1 = User.getById(m.p1_id), u2 = User.getById(m.p2_id);
      winnerId = (u1 && u2 && u2.elo > u1.elo) ? m.p2_id : m.p1_id;
    }
    TournamentMatch.setForfeit(m.id, winnerId);
    const winner = User.getById(winnerId);
    const loserId = winnerId === m.p1_id ? m.p2_id : m.p1_id;
    if (loserId) notify(loserId, "forfait", {
      text: `❌ Forfait — présence non confirmée. ${winner ? winner.pseudo : ""} avance.`,
      tournamentId: m.tournament_id, matchId: m.id,
    });
    if (winnerId) notify(winnerId, "forfait_adverse", {
      text: `✅ Victoire par forfait — adversaire absent. Vous avancez.`,
      tournamentId: m.tournament_id, matchId: m.id,
    });
    advanceWinner(TournamentMatch.get(m.id));
  }
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
    } else {
      /* L'horloge ne vivait qu'en mémoire : un redémarrage rendait au joueur le
         temps qu'il avait déjà dépensé. On recopie donc l'instantané de temps en
         temps — une écriture toutes les 20 s par partie, pas une par seconde. */
      if (session.clock[session.turn] % 20 === 0) persistSession(session);
      if (session.clock[session.turn] % 5 === 0) dispatchGameState(session);
    }
  }
  // Traitement des matchs de tournoi (confirmations + forfaits automatiques)
  try { processTournamentMatches(); } catch (e) { console.error("tournament loop", e); }
  // Purge des fenêtres de limitation de chat expirées (mémoire bornée)
  { const nowMs = Date.now();
    for (const [uid, e] of chatRate) if (nowMs - e.since >= CHAT_RATE_WINDOW_MS) chatRate.delete(uid); }
  // Expire challenges
  const expired = db.prepare("SELECT * FROM challenges WHERE status='pending' AND expires_at < datetime('now')").all();
  for (const c of expired) {
    Challenge.update(c.id, "expired");
    sendUser(c.from_id, { type: "challenge_status", challengeId: c.id, status: "expired" });
    if (c.wager > 0) {
      Wallet.credit(c.from_id, c.wager, "Défi expiré - remboursement");
      sendUser(c.from_id, walletPayload(c.from_id));
    }
  }
  // Auto-appariement : une file par couple jeu/format.
  for (const { key, pair } of mm.drainPairs()) {
    /* Le JEU vient de la cle de file (`<jeu>/<format>`) : sans lui, deux
       joueurs en file pour Dimy recevaient une session Tsivy. */
    createGameSession(pair[0].userId, pair[1].userId, "online", mm.formatOf(key), 0, mm.gameOf(key));
  }
}

/* ---------- WebSocket disconnect ---------- */
function handleDisconnect(ws) {
  const conn = connections.get(ws);
  if (!conn) return;
  /* Fermeture d'une socket DÉJÀ REMPLACÉE (rechargement de page, reconnexion) :
     le joueur est toujours en ligne par sa nouvelle socket. Sans cette garde, la
     fermeture tardive le sortait de la file d'attente et programmait un abandon
     de la partie en cours — une partie qu'il était justement en train de jouer.
     On se contente donc de retirer cette socket-là. */
  const current = userSockets.get(conn.userId);
  if (current && current !== ws && current.readyState === WebSocket.OPEN) {
    connections.delete(ws);
    return;
  }
  mm.removeUser(conn.userId);
  // Déconnexion ≠ abandon immédiat : laisser un délai de grâce pour la reconnexion.
  /* UN délai par PARTIE EN COURS, pas un par joueur. Un joueur peut avoir deux
     sessions vivantes (une partie laissée ouverte, puis une nouvelle) : l'ancienne
     boucle n'armait qu'un seul délai, sur la première trouvée, et abandonnait
     l'autre partie jamais — elle restait figée pour toujours, adversaire compris. */
  for (const [id, session] of sessions) {
    if (session.over) continue;
    const inThis = session.player1.id === conn.userId || (session.player2 && session.player2.id === conn.userId);
    if (!inThis) continue;
    const key = conn.userId + "|" + id;
    if (disconnectTimers.has(key)) continue;
    const timer = setTimeout(() => {
      disconnectTimers.delete(key);
      const s = sessions.get(id);
      if (s && !s.over) {
        handleGameEnd(s, s.player1.id === conn.userId ? 2 : 1, "abandon");
        sessions.delete(id);
        GameSessionStore.delete(id);
      }
    }, GRACE_MS);
    disconnectTimers.set(key, { timer, sessionId: id, userId: conn.userId });
  }
  /* On ne retire l'entrée QUE si elle désigne ENCORE cette socket.
     Un rechargement de page (ou une reconnexion) ouvre la NOUVELLE socket avant
     que l'ancienne ne signale sa fermeture : la suppression inconditionnelle
     effaçait l'entrée de la socket FRAÎCHE, et le joueur cessait alors
     silencieusement de recevoir toutes les poussées (badge d'amis, classement,
     état de partie) alors que son client se croyait connecté. */
  if (userSockets.get(conn.userId) === ws) userSockets.delete(conn.userId);
  connections.delete(ws);
  // Retirer l'utilisateur des spectates en cours
  for (const [sid, set] of spectators) {
    if (set.delete(conn.userId) && !set.size) spectators.delete(sid);
  }
}

/* ---------- Démarrage ---------- */
function start() {
  seedDatabase();
  /* Reprise : les parties encore ouvertes au dernier arrêt reviennent AVANT que
     la boucle de jeu et le serveur HTTP ne démarrent (aucune course possible). */
  rehydrateSessions();

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    /* ---------- En-têtes de sécurité ----------
       Posés pour TOUTES les réponses (API + statique). La CSP laisse
       'unsafe-inline' à script/style : le fichier mono-page contient trois
       <script> en ligne et de nombreux gestionnaires `onclick=` — leur
       migration est un chantier séparé. Même ainsi elle isole l'essentiel :
       aucune source de script externe, pas de <object>, pas de base détournée,
       formulaires et cadres limités à l'origine. Les polices Google restent
       permises (l'interface les utilise et retombe proprement hors-ligne). */
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ws: wss:; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, `http://${req.headers.host || "localhost:" + PORT}`);
    if (url.pathname.startsWith("/api/")) {
      handleRest(req, res, url, authMiddleware(req));
    } else {
      serveStatic(req, res);
    }
  });

  const wss = new WebSocket.Server({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    /* Anti « cross-site WebSocket hijacking » : un navigateur envoie TOUJOURS
       un en-tête Origin ; s'il est présent et que l'hôte ne correspond pas à
       celui du service, la connexion est refusée. Un client natif (aucun
       Origin — sondes, scripts) reste accepté : il ne peut pas être détourné
       par un site tiers. Cette barrière s'AJOUTE à l'authentification par
       jeton, elle ne la remplace pas. */
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = null;
      try { originHost = new URL(origin).host; } catch (e) { originHost = null; }
      if (!originHost || originHost !== req.headers.host) {
        try { ws.close(1008, "Origine refusée"); } catch (e) {}
        return;
      }
    }
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleWsMessage(ws, typeof msg === "string" ? JSON.parse(data.toString()) : msg);
      } catch (err) {
        send(ws, { type: "error", message: "Message invalide" });
      }
    });
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", (err) => { console.error("[ws] erreur socket:", (err && err.message) || err); });
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
