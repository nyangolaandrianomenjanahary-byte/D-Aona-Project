/* =========================================================
   D-aôna (Vercel + Supabase) — Moteur temps réel sans état mémoire
   Matchmaking, sessions autoritaires, IA, défis, chat, spectateurs, tournois
   ========================================================= */
"use strict";

const crypto = require("node:crypto");
const Registry = require("../../apps/api/games/registry");
const DATA = require("../../apps/api/data");
const { query, one, all, tx } = require("./db");
const { emitUser, emitBroadcast } = require("./realtime");
const {
  User, Wallet, PionStyle, GameRecord, GameSessionStore,
  Chat, Challenge, Notification, Tournament, TournamentMatch,
  nowSqlUtc, toIsoUtc,
} = require("./stores");

const SNAPSHOT_V = 1;
const CONFIRM_CLOSE_MIN = 5;

function playerNumOf(session, uid) {
  if (session.player1 && session.player1.id === uid) return 1;
  if (session.player2 && session.player2.id === uid) return 2;
  return 0;
}

function piecesLeftOf(session, side) {
  if (typeof session.piecesLeft === "function") return session.piecesLeft(side);
  return 0;
}

function serializeSession(session) {
  const clone = JSON.parse(JSON.stringify(session));
  if (session.chain && session.chain.visited instanceof Set) {
    clone.chain.visited = Array.from(session.chain.visited);
  }
  clone._lastTickMs = Date.now();
  return { v: SNAPSHOT_V, session: clone };
}

function rehydrateSession(row) {
  if (!row) return null;
  let data = null;
  try { data = JSON.parse(row.state_json || ""); } catch (_) { return null; }
  const snap = data && data.v === SNAPSHOT_V ? data.session : null;
  if (!snap || !Registry.has(snap.game)) return null;
  const mod = Registry.get(snap.game);
  const session = Object.create(mod.GameSession.prototype);
  Object.assign(session, snap);
  if (session.chain && Array.isArray(session.chain.visited)) {
    session.chain.visited = new Set(session.chain.visited);
  }
  return session;
}

/* Met à jour l'horloge écoulée depuis le dernier instantané sans setInterval */
function applyElapsedClock(session) {
  if (!session || session.over || session.phase !== "play") return null;
  if (session.turn !== 1 && session.turn !== 2) return null;
  const nowMs = Date.now();
  const prevMs = session._lastTickMs || nowMs;
  const elapsed = Math.floor((nowMs - prevMs) / 1000);
  session._lastTickMs = nowMs;
  if (elapsed <= 0) return null;
  session.clock[session.turn] = Math.max(0, (session.clock[session.turn] || 0) - elapsed);
  if (session.clock[session.turn] === 0) {
    session.over = true;
    return { gameOver: true, winner: session.turn === 1 ? 2 : 1, reason: "temps" };
  }
  return null;
}

async function persistSession(session) {
  if (!session || !session.sessionId) return;
  await GameSessionStore.updateState(session.sessionId, serializeSession(session));
}

async function walletPayload(userId) {
  const { Finance } = require("./stores");
  const b = await Finance.balanceOf(userId);
  return { type: "wallet_update", ...b };
}

async function notifyUser(userId, type, payload) {
  await Notification.create(userId, type, payload);
  const unread = await Notification.unreadCount(userId);
  await emitUser(userId, { type: "notification", notifType: type, payload, unread });
}

function matchDateLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

async function generateBracket(tournamentId) {
  const t = await Tournament.get(tournamentId);
  if (!t) return;
  if ((await TournamentMatch.listByTournament(tournamentId)).length) return;
  const regs = await all(
    `SELECT u.id, u.pseudo, u.elo FROM tournament_registrations r
     JOIN users u ON u.id = r.user_id WHERE r.tournament_id = $1`,
    [tournamentId]
  );
  if (!regs.length) return;
  const players = regs.map((r) => ({ id: r.id, elo: r.elo || 1100 }));
  players.sort((a, b) => b.elo - a.elo);
  let size = 2;
  while (size < players.length) size *= 2;
  while (players.length < size) players.push(null);
  const rounds = Math.log2(size);
  const startBase = t.starts_at ? new Date(t.starts_at) : new Date(Date.now() + 3600000);
  const isTest = t.interval_min === 0;
  const matchDurMs = (t.match_duration_min || 5) * 60000;
  const intervalMs = (t.interval_min || 5) * 60000;
  const matchIds = {};
  let globalIndex = 0;

  for (let round = 1; round <= rounds; round++) {
    const count = size / Math.pow(2, round);
    for (let slot = 0; slot < count; slot++) {
      let p1 = null, p2 = null;
      if (round === 1) {
        p1 = players[slot * 2] ? players[slot * 2].id : null;
        p2 = players[slot * 2 + 1] ? players[slot * 2 + 1].id : null;
      }
      const startsAt = isTest ? new Date(Date.now()) : new Date(startBase.getTime() + globalIndex * (matchDurMs + intervalMs));
      const confirmDeadline = isTest
        ? new Date(Date.now() + 2 * 60 * 60000)
        : new Date(startsAt.getTime() - CONFIRM_CLOSE_MIN * 60000);
      matchIds[`${round}-${slot}`] = await TournamentMatch.create(tournamentId, round, slot, {
        p1_id: p1, p2_id: p2, starts_at: startsAt.toISOString(),
        confirm_deadline: confirmDeadline.toISOString(), status: "a_venir",
      });
      globalIndex++;
    }
  }
  for (let round = 1; round < rounds; round++) {
    const count = size / Math.pow(2, round);
    for (let slot = 0; slot < count; slot++) {
      await TournamentMatch.setNext(matchIds[`${round}-${slot}`], matchIds[`${round + 1}-${Math.floor(slot / 2)}`]);
    }
  }
  for (const r of regs) {
    await notifyUser(r.id, "tournoi_debut", {
      text: `🏆 Le tournoi « ${t.name} » commence ! Consultez votre bracket.`,
      tournamentId, startsAt: t.starts_at,
    });
  }
}

async function advanceWinner(match) {
  if (!match || !match.winner_id) return;
  if (match.next_match_id) {
    const next = await TournamentMatch.get(match.next_match_id);
    if (next) {
      await TournamentMatch.setPlayer(next.id, match.slot % 2 === 0 ? 1 : 2, match.winner_id);
      const updated = await TournamentMatch.get(next.id);
      if (updated.p1_id && updated.p2_id) {
        await TournamentMatch.setStatus(next.id, "a_venir");
        for (const uid of [updated.p1_id, updated.p2_id]) {
          const opp = await User.getById(uid === updated.p1_id ? updated.p2_id : updated.p1_id);
          await notifyUser(uid, "prochain_match", {
            text: `⚔️ Prochain match contre ${opp ? opp.pseudo : "?"} — ${matchDateLabel(next.starts_at)}`,
            tournamentId: match.tournament_id, matchId: next.id, startsAt: next.starts_at,
          });
        }
        await emitBroadcast({ type: "tournament_update", tournamentId: match.tournament_id });
      }
    }
  } else {
    await query("UPDATE tournaments SET status = 'termine' WHERE id = $1", [match.tournament_id]);
    await notifyUser(match.winner_id, "tournoi_gagne", {
      text: `👑 Vous remportez le tournoi !`, tournamentId: match.tournament_id,
    });
    await emitBroadcast({ type: "tournament_update", tournamentId: match.tournament_id });
  }
}

async function createGameSession(p1Id, p2Id, mode, formatId, wager, gameId, callerEvents = null) {
  const sessionId = "GS-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const format = DATA.FORMATS.find((f) => f.id === formatId) || DATA.FORMATS[0];
  const game = Registry.has(gameId) ? gameId : Registry.DEFAULT;
  const Session = Registry.get(game).GameSession;

  const p1 = p1Id ? await User.getById(p1Id) : null;
  let p2;
  if (mode === "ai" || !p2Id) {
    const aiPseudo = DATA.OPPONENT_POOL[Math.floor(Math.random() * DATA.OPPONENT_POOL.length)].pseudo;
    p2 = { id: 0, pseudo: aiPseudo, elo: Math.max(600, (p1?.elo || 1100) - 60), region: "Madagascar" };
  } else {
    p2 = await User.getById(p2Id);
  }
  const p1Obj = p1 || { id: 0, pseudo: "Spectateur", elo: 1000, region: "Madagascar" };
  p1Obj.pionStyles = await PionStyle.get(p1Obj.id);
  p2.pionStyles = p2.id ? await PionStyle.get(p2.id) : { light: { ...DATA.PION_DEFAULTS.light }, dark: { ...DATA.PION_DEFAULTS.dark } };

  const gs = new Session(sessionId, p1Obj, p2, mode, format, wager);
  gs.game = game;
  gs._lastTickMs = Date.now();
  gs.gameRecordId = await GameRecord.create(p1Obj.id, p2.id, mode, formatId, wager, game);

  await GameSessionStore.create(sessionId, p1Obj.id, p2.id, mode, formatId, wager, game, gs.gameRecordId);
  await persistSession(gs);

  const startP1 = {
    type: "game_start", sessionId, playerNum: 1, game,
    state: gs.getState(), opponent: p2, mode, format, wager,
  };
  if (callerEvents && p1Obj.id) callerEvents.push(startP1);
  else if (p1Obj.id) await emitUser(p1Obj.id, startP1);

  if (mode !== "ai" && p2 && p2.id) {
    const startP2 = {
      type: "game_start", sessionId, playerNum: 2, game,
      state: gs.getState(), opponent: p1Obj, mode, format, wager,
    };
    await emitUser(p2.id, startP2);
  }
  await emitBroadcast({ type: "live_update" });
  return { sessionId, session: gs };
}

async function handleGameEnd(session, winner, reason, callerId = null, callerEvents = null) {
  if (!session || session._ended) return;
  session._ended = true;
  session.over = true;

  const isRealGame = session.mode !== "ai" && session.player2 && session.player2.id !== 0;
  const deltas = session.finish(winner);
  const p1Left = piecesLeftOf(session, 1);
  const p2Left = piecesLeftOf(session, 2);
  const draw = winner !== 1 && winner !== 2;
  const winnerId = draw ? null : winner === 1 ? session.player1.id : (isRealGame ? session.player2.id : null);

  const ranked = session.mode !== "ai";
  const d1 = ranked ? deltas.delta1 : 0;
  const d2 = ranked ? deltas.delta2 : 0;
  const u1Before = session.player1.id ? await User.getById(session.player1.id) : null;
  const u2Before = isRealGame && session.player2.id ? await User.getById(session.player2.id) : null;
  const elo1Before = u1Before ? u1Before.elo : null;
  const elo2Before = u2Before ? u2Before.elo : null;

  if (ranked && session.player1.id) {
    if (draw) await query("UPDATE users SET elo = elo + $1 WHERE id = $2", [d1, session.player1.id]);
    else if (winner === 1) await query("UPDATE users SET elo = elo + $1, wins = wins + 1 WHERE id = $2", [d1, session.player1.id]);
    else await query("UPDATE users SET elo = elo + $1, losses = losses + 1 WHERE id = $2", [d1, session.player1.id]);
  }
  if (isRealGame && session.player2.id) {
    if (draw) await query("UPDATE users SET elo = elo + $1 WHERE id = $2", [d2, session.player2.id]);
    else if (winner === 2) await query("UPDATE users SET elo = elo + $1, wins = wins + 1 WHERE id = $2", [d2, session.player2.id]);
    else await query("UPDATE users SET elo = elo + $1, losses = losses + 1 WHERE id = $2", [d2, session.player2.id]);
  }

  let gain = 0;
  if (session.mode === "defi" && session.wager > 0) {
    if (draw) {
      await Wallet.credit(session.player1.id, session.wager, "Défi nul - mise rendue");
      if (isRealGame) await Wallet.credit(session.player2.id, session.wager, "Défi nul - mise rendue");
    } else if (winner === 1) {
      gain = Math.round(session.wager * 2 * 0.9);
      await Wallet.credit(session.player1.id, gain, `Gain défi vs ${session.player2.pseudo}`);
    } else if (isRealGame && winner === 2) {
      gain = Math.round(session.wager * 2 * 0.9);
      await Wallet.credit(session.player2.id, gain, `Gain défi vs ${session.player1.pseudo}`);
    }
  }

  if (session.gameRecordId) {
    await GameRecord.finish(session.gameRecordId, winnerId, d1, d2, session.moves, reason, {
      p1Before: elo1Before,
      p1After: elo1Before === null ? null : elo1Before + d1,
      p2Before: elo2Before,
      p2After: elo2Before === null ? null : elo2Before + d2,
    });
  }
  if (d1 || (isRealGame && d2)) await emitBroadcast({ type: "leaderboard_update" });
  await GameSessionStore.setStatus(session.sessionId, "finished", session.moves, winnerId);

  if (session.tournamentMatchId && winnerId) {
    const tm = await TournamentMatch.get(session.tournamentMatchId);
    if (tm && tm.status === "en_cours") {
      await TournamentMatch.setResult(tm.id, winner === 1 ? 1 : 0, winner === 2 ? 1 : 0, winnerId);
      const loserId = winnerId === tm.p1_id ? tm.p2_id : tm.p1_id;
      const winnerU = await User.getById(winnerId);
      if (loserId) {
        await notifyUser(loserId, "defaite", {
          text: `Match perdu contre ${winnerU ? winnerU.pseudo : ""} — ${matchDateLabel(tm.starts_at)}.`,
          tournamentId: tm.tournament_id, matchId: tm.id,
        });
      }
      await notifyUser(winnerId, "victoire", {
        text: "✅ Match remporté ! Vous avancez dans le bracket.",
        tournamentId: tm.tournament_id, matchId: tm.id,
      });
      await advanceWinner(await TournamentMatch.get(tm.id));
      await emitBroadcast({ type: "tournament_update", tournamentId: tm.tournament_id });
    }
  }

  const result1 = {
    winner, reason, draw, game: session.game,
    mode: session.mode, format: session.format, moves: (session.moves || []).length,
    opponent: session.player2.pseudo, meLeft: p1Left, oppLeft: p2Left,
    delta: d1, gain: winner === 1 ? gain : 0,
  };
  const end1 = { type: "game_end", sessionId: session.sessionId, result: result1 };
  if (session.player1.id) {
    if (callerEvents && callerId === session.player1.id) callerEvents.push(end1);
    else await emitUser(session.player1.id, end1);
  }
  if (isRealGame && session.player2.id) {
    const result2 = {
      ...result1, opponent: session.player1.pseudo, delta: d2,
      meLeft: p2Left, oppLeft: p1Left, gain: winner === 2 ? gain : 0,
    };
    const end2 = { type: "game_end", sessionId: session.sessionId, result: result2 };
    if (callerEvents && callerId === session.player2.id) callerEvents.push(end2);
    else await emitUser(session.player2.id, end2);
  }

  if (session.player1.id) {
    const wp1 = await walletPayload(session.player1.id);
    if (callerEvents && callerId === session.player1.id) callerEvents.push(wp1);
    else await emitUser(session.player1.id, wp1);
  }
  if (isRealGame && session.player2.id) {
    const wp2 = await walletPayload(session.player2.id);
    if (callerEvents && callerId === session.player2.id) callerEvents.push(wp2);
    else await emitUser(session.player2.id, wp2);
  }

  await GameSessionStore.delete(session.sessionId);
  await emitBroadcast({ type: "live_update" });
}

function chooseAiMove(session) {
  const moves = session.getLegalMoves();
  if (!moves.length) return null;
  const caps = moves.filter((m) => Array.isArray(m.cap) && m.cap.length);
  if (caps.length) {
    const best = Math.max(...caps.map((x) => x.cap.length));
    const pool = caps.filter((x) => x.cap.length === best || (Math.random() < 0.25 && x.cap.length === best - 1));
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

async function runAiTurns(session, callerId, events) {
  let guard = 0;
  while (!session.over && session.phase === "play" && session.mode === "ai" && session.turn === 2 && guard < 12) {
    guard++;
    const chosen = chooseAiMove(session);
    if (!chosen) {
      await handleGameEnd(session, 1, "blocage", callerId, events);
      return;
    }
    const res = session.applyMove(chosen);
    await persistSession(session);
    if (res.gameOver) {
      events.push({ type: "game_state", sessionId: session.sessionId, game: session.game, playerNum: 1, state: res.state });
      await handleGameEnd(session, res.winner, res.reason, callerId, events);
      return;
    }
  }
  if (!session.over) {
    events.push({ type: "game_state", sessionId: session.sessionId, game: session.game, playerNum: 1, state: session.getState() });
  }
}

async function expireChallenges() {
  const nowSql = nowSqlUtc();
  const expired = await all("SELECT * FROM challenges WHERE status = 'pending' AND expires_at < $1", [nowSql]);
  for (const c of expired) {
    await Challenge.update(c.id, "expired");
    await emitUser(c.from_id, { type: "challenge_status", challengeId: c.id, status: "expired" });
    if (c.wager > 0) {
      await Wallet.credit(c.from_id, c.wager, "Défi expiré - remboursement");
      await emitUser(c.from_id, await walletPayload(c.from_id));
    }
  }
}

async function challengeFeed(userId) {
  const rows = await Challenge.getByUser(userId);
  return rows.map((c) => ({
    id: c.id, wager: c.wager, format: c.format, game: c.game, status: c.status,
    createdAt: toIsoUtc(c.created_at), expiresAt: toIsoUtc(c.expires_at),
    fromId: c.from_id, toId: c.to_id,
    fromPseudo: c.from_pseudo, fromElo: c.from_elo, fromAvatar: c.from_avatar || null,
    toPseudo: c.to_pseudo, toElo: c.to_elo, toAvatar: c.to_avatar || null,
  }));
}

async function dispatchState(session, callerId, callerEvents) {
  const st = session.getState();
  const game = session.game;
  const p1Msg = { type: "game_state", sessionId: session.sessionId, game, playerNum: 1, state: st };
  if (session.player1 && session.player1.id) {
    if (callerEvents && callerId === session.player1.id) callerEvents.push(p1Msg);
    else await emitUser(session.player1.id, p1Msg);
  }
  if (session.player2 && session.player2.id) {
    const p2Msg = { type: "game_state", sessionId: session.sessionId, game, playerNum: 2, state: st };
    if (callerEvents && callerId === session.player2.id) callerEvents.push(p2Msg);
    else await emitUser(session.player2.id, p2Msg);
  }
}

async function handleRtAction(user, msg) {
  const events = [];
  if (!user || !msg || typeof msg.type !== "string") return { ok: false, status: 400, error: "Action invalide", events };

  switch (msg.type) {
    case "auth": {
      const latest = await one("SELECT COALESCE(MAX(id), 0)::bigint AS m FROM rt_events");
      const rtCursor = Number(latest ? latest.m : 0);
      await User.touchLastSeen(user.id);
      const activeRow = await one(
        "SELECT * FROM game_sessions WHERE status = 'playing' AND (p1_id = $1 OR p2_id = $1) ORDER BY updated_at DESC LIMIT 1",
        [user.id]
      );
      if (activeRow) {
        const s = rehydrateSession(activeRow);
        if (s && !s.over) {
          const clk = applyElapsedClock(s);
          if (clk && clk.gameOver) {
            await finalizeGame(s, clk.winner, clk.reason, events, user.id);
          } else {
            await persistSession(s);
            const pNum = playerNumOf(s, user.id);
            events.push({ type: "game_state", sessionId: s.sessionId, game: s.game, playerNum: pNum, state: s.getState() });
          }
        }
      }
      const challenges = await challengeFeed(user.id);
      if (challenges.length) events.push({ type: "challenges_update", challenges });
      events.push({ type: "auth_ok", userId: user.id });
      return { ok: true, rtCursor, events };
    }

    case "ping":
      events.push({ type: "pong" });
      return { ok: true, events };

    case "find_match": {
      const fmt = msg.format || "blitz";
      const game = Registry.has(msg.game) ? msg.game : Registry.DEFAULT;
      const mode = msg.mode || "online";
      if (mode === "ai") {
        await createGameSession(user.id, null, "ai", fmt, 0, game, events);
        return { ok: true, events };
      }

      const matched = await tx(async (c) => {
        await c.query("DELETE FROM matchmaking_queue WHERE user_id = $1", [user.id]);
        const opp = await c.one(
          "SELECT * FROM matchmaking_queue WHERE game = $1 AND format = $2 AND mode = 'online' AND user_id <> $3 ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
          [game, fmt, user.id]
        );
        if (opp) {
          await c.query("DELETE FROM matchmaking_queue WHERE user_id = $1", [opp.user_id]);
          const key = "PM-" + crypto.randomBytes(4).toString("hex").toUpperCase();
          await c.query(
            "INSERT INTO pending_matches (match_key, p1_id, p2_id, p1_ready, p2_ready, format, game) VALUES ($1,$2,$3,false,false,$4,$5)",
            [key, user.id, opp.user_id, fmt, game]
          );
          return { key, opp };
        }
        await c.query(
          "INSERT INTO matchmaking_queue (user_id, game, format, mode, elo, pseudo) VALUES ($1,$2,$3,'online',$4,$5)",
          [user.id, game, fmt, user.elo || 1100, user.pseudo]
        );
        return null;
      });

      if (matched) {
        const p2 = await User.getById(matched.opp.user_id);
        events.push({
          type: "match_found", matchKey: matched.key,
          opponent: { pseudo: p2.pseudo, elo: p2.elo, id: p2.id },
          format: fmt, game, playerNum: 1,
        });
        await emitUser(p2.id, {
          type: "match_found", matchKey: matched.key,
          opponent: { pseudo: user.pseudo, elo: user.elo, id: user.id },
          format: fmt, game, playerNum: 2,
        });
      } else {
        events.push({ type: "matchmaking", status: "searching" });
      }
      return { ok: true, events };
    }

    case "cancel_match": {
      await query("DELETE FROM matchmaking_queue WHERE user_id = $1", [user.id]);
      const pms = await all("SELECT * FROM pending_matches WHERE p1_id = $1 OR p2_id = $1", [user.id]);
      for (const pm of pms) {
        await query("DELETE FROM pending_matches WHERE match_key = $1", [pm.match_key]);
        const otherId = pm.p1_id === user.id ? pm.p2_id : pm.p1_id;
        await emitUser(otherId, { type: "match_cancelled", matchKey: pm.match_key });
      }
      return { ok: true, events };
    }

    case "accept_match": {
      const key = msg.matchKey;
      const pm = await tx(async (c) => {
        const row = await c.one("SELECT * FROM pending_matches WHERE match_key = $1 FOR UPDATE", [key]);
        if (!row) return null;
        if (user.id !== row.p1_id && user.id !== row.p2_id) return { forbidden: true };
        const p1Ready = row.p1_ready || user.id === row.p1_id;
        const p2Ready = row.p2_ready || user.id === row.p2_id;
        if (p1Ready && p2Ready) {
          await c.query("DELETE FROM pending_matches WHERE match_key = $1", [key]);
        } else {
          await c.query("UPDATE pending_matches SET p1_ready = $1, p2_ready = $2 WHERE match_key = $3", [p1Ready, p2Ready, key]);
        }
        return { ...row, p1_ready: p1Ready, p2_ready: p2Ready };
      });
      if (!pm) { events.push({ type: "error", message: "Match introuvable" }); return { ok: true, events }; }
      if (pm.forbidden) return { ok: true, events };
      const stMsg = { type: "match_status", matchKey: key, p1Ready: pm.p1_ready, p2Ready: pm.p2_ready };
      events.push(stMsg);
      const otherId = user.id === pm.p1_id ? pm.p2_id : pm.p1_id;
      await emitUser(otherId, stMsg);
      if (pm.p1_ready && pm.p2_ready) {
        const created = await createGameSession(pm.p1_id, pm.p2_id, "online", pm.format, 0, pm.game);
        const startForMe = {
          type: "game_start", sessionId: created.sessionId,
          playerNum: user.id === pm.p1_id ? 1 : 2,
          game: created.session.game, state: created.session.getState(),
          opponent: user.id === pm.p1_id ? created.session.player2 : created.session.player1,
          mode: "online", format: created.session.format, wager: 0,
        };
        events.push(startForMe);
      }
      return { ok: true, events };
    }

    case "sync_game": {
      const row = msg.sessionId
        ? await GameSessionStore.get(msg.sessionId)
        : await GameSessionStore.findPlayingByUser(user.id);
      const session = rehydrateSession(row);
      if (!session || session.over || row.status !== "playing") {
        events.push({ type: "no_active_game" });
        return { ok: true, events };
      }
      const timeout = applyElapsedClock(session);
      await persistSession(session);
      const pnum = playerNumOf(session, user.id);
      if (pnum) {
        events.push({ type: "game_state", sessionId: session.sessionId, game: session.game, playerNum: pnum, state: session.getState() });
      }
      if (timeout) {
        await handleGameEnd(session, timeout.winner, timeout.reason, user.id, events);
      }
      return { ok: true, events };
    }

    case "pick_side": {
      const row = await GameSessionStore.get(msg.sessionId);
      const session = rehydrateSession(row);
      if (!session || session.phase !== "choose") {
        events.push({ type: "error", message: "Choix indisponible", sessionId: msg.sessionId });
        return { ok: true, events };
      }
      const pnum = playerNumOf(session, user.id);
      if (!pnum) {
        events.push({ type: "error", message: "Vous n'êtes pas joueur de cette partie", sessionId: msg.sessionId });
        return { ok: true, events };
      }
      const result = session.pickSide(pnum, msg.side);
      if (result.error) events.push({ type: "error", message: result.error, sessionId: msg.sessionId });
      if (session.mode === "ai" && session.phase === "choose" && pnum === 1 && session.choices[2] === null) {
        const remaining = session.choices[1] === "pile" ? "face" : "pile";
        session.pickSide(2, remaining);
      }
      session._lastTickMs = Date.now();
      await persistSession(session);
      await dispatchState(session, user.id, events);
      if (session.phase === "play" && session.turn === 2 && session.mode === "ai") {
        await runAiTurns(session, user.id, events);
      }
      return { ok: true, events };
    }

    case "move": {
      const row = await GameSessionStore.get(msg.sessionId);
      const session = rehydrateSession(row);
      if (!session || session.over) return { ok: true, events };
      const timeout = applyElapsedClock(session);
      if (timeout) {
        await persistSession(session);
        await dispatchState(session, user.id, events);
        await handleGameEnd(session, timeout.winner, timeout.reason, user.id, events);
        return { ok: true, events };
      }
      if (session.phase === "play" && playerNumOf(session, user.id) !== session.turn) {
        events.push({ type: "error", message: "Ce n'est pas votre tour", sessionId: msg.sessionId });
        return { ok: true, events };
      }
      const result = session.applyMove(msg.move);
      if (!result.ok) {
        events.push({ type: "error", message: result.error, sessionId: msg.sessionId });
        return { ok: true, events };
      }
      await persistSession(session);
      await dispatchState(session, user.id, events);
      if (result.gameOver) {
        await handleGameEnd(session, result.winner, result.reason, user.id, events);
      } else if (session.turn === 2 && session.mode === "ai") {
        await runAiTurns(session, user.id, events);
      }
      return { ok: true, events };
    }

    case "end_chain": {
      const row = await GameSessionStore.get(msg.sessionId);
      const session = rehydrateSession(row);
      if (!session || session.over || !session.chain) return { ok: true, events };
      if (playerNumOf(session, user.id) !== session.turn) {
        events.push({ type: "error", message: "Ce n'est pas votre tour", sessionId: msg.sessionId });
        return { ok: true, events };
      }
      const result = session.endChain();
      await persistSession(session);
      await dispatchState(session, user.id, events);
      if (result.gameOver) {
        await handleGameEnd(session, result.winner, result.reason, user.id, events);
      } else if (session.turn === 2 && session.mode === "ai") {
        await runAiTurns(session, user.id, events);
      }
      return { ok: true, events };
    }

    case "resign": {
      const row = await GameSessionStore.get(msg.sessionId);
      const session = rehydrateSession(row);
      if (!session || session.over) return { ok: true, events };
      const pnum = playerNumOf(session, user.id);
      if (!pnum) {
        events.push({ type: "error", message: "Vous n'êtes pas joueur de cette partie", sessionId: msg.sessionId });
        return { ok: true, events };
      }
      const result = session.resign(pnum);
      if (result.gameOver) await handleGameEnd(session, result.winner, result.reason, user.id, events);
      return { ok: true, events };
    }

    case "spectate": {
      const row = await GameSessionStore.get(msg.sessionId);
      const session = rehydrateSession(row);
      if (!session || session.over) {
        events.push({ type: "error", message: "Match introuvable ou déjà terminé" });
        return { ok: true, events };
      }
      if (session.player1.id === user.id || (session.player2 && session.player2.id === user.id)) {
        events.push({ type: "error", message: "Vous êtes joueur de ce match" });
        return { ok: true, events };
      }
      events.push({ type: "spectate_state", sessionId: session.sessionId, game: session.game, state: session.getState() });
      return { ok: true, events };
    }

    case "unspectate":
      return { ok: true, events };

    case "chat_message": {
      if (typeof msg.toPseudo !== "string" || typeof msg.text !== "string") {
        events.push({ type: "error", message: "Message invalide" });
        return { ok: true, events };
      }
      const text = msg.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 500);
      if (!text.trim()) { events.push({ type: "error", message: "Message vide" }); return { ok: true, events }; }
      const otherUser = await User.getByPseudo(msg.toPseudo);
      if (!otherUser) { events.push({ type: "error", message: "Joueur introuvable" }); return { ok: true, events }; }
      await Chat.saveMessage(user.id, otherUser.id, text);
      const at = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      await emitUser(otherUser.id, { type: "chat_message", from: user.pseudo, text, at });
      events.push({ type: "chat_message", from: user.pseudo, to: otherUser.pseudo, text, at, direction: "me" });
      return { ok: true, events };
    }

    case "send_challenge": {
      const targetUser = await User.getByPseudo(msg.toPseudo);
      if (!targetUser) { events.push({ type: "error", message: "Joueur introuvable" }); return { ok: true, events }; }
      const wager = parseInt(msg.wager, 10) || 0;
      const game = Registry.has(msg.game) ? msg.game : Registry.DEFAULT;
      if (wager < 500) {
        events.push({ type: "error", message: "Mise minimale de 500 Ar requise — les défis gratuits ne sont pas autorisés" });
        return { ok: true, events };
      }
      if (!user.kyc) { events.push({ type: "error", message: "KYC requis" }); return { ok: true, events }; }
      if (user.balance < wager) { events.push({ type: "error", message: "Solde insuffisant" }); return { ok: true, events }; }
      await Wallet.spend(user.id, wager, `Mise défi vs ${targetUser.pseudo}`);
      const ch = await Challenge.create(user.id, targetUser.id, wager, msg.format, game);
      events.push(await walletPayload(user.id));
      await emitUser(targetUser.id, {
        type: "challenge_received",
        challenge: {
          id: ch.id, from: user.pseudo, fromId: user.id, fromAvatar: user.avatar || null,
          fromElo: user.elo, wager, format: msg.format, game,
          createdAt: toIsoUtc(Date.now()), expiresAt: toIsoUtc(ch.expires_at),
        },
      });
      events.push({ type: "challenge_sent", challengeId: ch.id, to: targetUser.pseudo, game });
      return { ok: true, events };
    }

    case "accept_challenge": {
      const ch = await Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending") { events.push({ type: "error", message: "Defi invalide" }); return { ok: true, events }; }
      if (ch.to_id !== user.id) { events.push({ type: "error", message: "Pas votre defi" }); return { ok: true, events }; }
      const fromUser = await User.getById(ch.from_id);
      if (ch.wager > 0) {
        if (!user.kyc) { events.push({ type: "error", message: "KYC requis" }); return { ok: true, events }; }
        if (user.balance < ch.wager) { events.push({ type: "error", message: "Solde insuffisant" }); return { ok: true, events }; }
        await Wallet.spend(user.id, ch.wager, `Mise défi vs ${fromUser.pseudo}`);
        events.push(await walletPayload(user.id));
      }
      await Challenge.update(msg.challengeId, "accepted");
      await emitUser(fromUser.id, { type: "challenge_accepted", challengeId: msg.challengeId });
      const created = await createGameSession(fromUser.id, user.id, "defi", ch.format, ch.wager, ch.game);
      events.push({
        type: "game_start", sessionId: created.sessionId, playerNum: 2,
        game: created.session.game, state: created.session.getState(),
        opponent: created.session.player1, mode: "defi", format: created.session.format, wager: ch.wager,
      });
      return { ok: true, events };
    }

    case "cancel_challenge": {
      const ch = await Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending" || ch.from_id !== user.id) return { ok: true, events };
      await Challenge.update(msg.challengeId, "cancelled");
      if (ch.wager > 0) {
        await Wallet.credit(ch.from_id, ch.wager, "Défi annulé - remboursement");
        events.push(await walletPayload(ch.from_id));
      }
      events.push({ type: "challenge_status", challengeId: msg.challengeId, status: "cancelled" });
      await emitUser(ch.to_id, { type: "challenges_update", challenges: await challengeFeed(ch.to_id) });
      return { ok: true, events };
    }

    case "reject_challenge": {
      const ch = await Challenge.get(msg.challengeId);
      if (!ch || ch.status !== "pending" || ch.to_id !== user.id) return { ok: true, events };
      await Challenge.update(msg.challengeId, "rejected");
      if (ch.wager > 0) {
        await Wallet.credit(ch.from_id, ch.wager, "Défi refusé - remboursement");
        await emitUser(ch.from_id, await walletPayload(ch.from_id));
      }
      await emitUser(ch.from_id, { type: "challenge_status", challengeId: msg.challengeId, status: "rejected" });
      return { ok: true, events };
    }

    default:
      return { ok: false, status: 400, error: "Action inconnue", events };
  }
}

async function pollEvents(userId, sinceId) {
  const since = parseInt(sinceId, 10) || 0;
  if (since <= 0) {
    const latest = await one("SELECT COALESCE(MAX(id), 0)::bigint AS m FROM rt_events");
    return { events: [], lastId: Number(latest ? latest.m : 0) };
  }
  const rows = await all(
    "SELECT id, payload_json FROM rt_events WHERE id > $1 AND (user_id = $2 OR user_id = 0) ORDER BY id ASC LIMIT 100",
    [since, userId]
  );
  let lastId = since;
  const events = [];
  for (const r of rows) {
    lastId = Number(r.id);
    try {
      const ev = JSON.parse(r.payload_json);
      ev.__eid = lastId;
      events.push(ev);
    } catch (_) {}
  }
  return { events, lastId };
}

module.exports = {
  handleRtAction,
  pollEvents,
  expireChallenges,
  generateBracket,
  advanceWinner,
  walletPayload,
  notifyUser,
  rehydrateSession,
  piecesLeftOf,
  challengeFeed,
};
