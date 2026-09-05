"use strict";
try {
  const { db, User, GameRecord, Tournament, Wallet, Chat, Skins, Challenge, GameSessionStore } = require("./db");
  const { GameSession, computeEloDelta, legalMoves, checkWin, countPieces, initialGrid } = require("./game");
  const DATA = require("./data");

  console.log("✓ Imports OK");

  // Seed
  Tournament.seed();
  console.log("✓ Tournament.seed() OK");

  // Seed users
  const seen = new Set();
  const allPlayers = [];
  for (const p of [...DATA.LEADERBOARD_POOL, ...DATA.OPPONENT_POOL]) {
    if (seen.has(p.pseudo)) continue;
    seen.add(p.pseudo);
    allPlayers.push(p);
  }
  for (const p of allPlayers) {
    const user = User.createOrUpdate(p.pseudo);
    db.prepare("UPDATE users SET elo = ?, wins = ?, losses = ?, balance = 5000 WHERE id = ?")
      .run(p.elo, p.wins || 0, (p.games || 0) - (p.wins || 0), user.id);
  }
  console.log("✓ User seed OK (" + allPlayers.length + " users)");

  // Test tournaments
  const tlist = Tournament.list();
  console.log("✓ Tournaments: " + tlist.length);
  console.log("  T1: " + tlist[0].name);

  // Test leaderboard
  const top = User.listAll().slice(0, 5);
  console.log("✓ Top 5 ELO:");
  for (const u of top) console.log("  " + u.pseudo + " (" + u.elo + ")");

  // Test game engine
  const p1 = { id: 1, pseudo: "TestJ1", elo: 1100, region: "Analamanga" };
  const p2 = { id: 2, pseudo: "TestJ2", elo: 1100, region: "Analamanga" };
  const gs = new GameSession("test1", p1, p2, "online", DATA.FORMATS[0], 0);
  console.log("✓ GameSession created");
  const moves = gs.getLegalMoves();
  console.log("✓ Legal moves: " + moves.length);

  // Test a capture move
  const capMove = moves.find(m => m.cap.length > 0);
  if (capMove) {
    const result = gs.applyMove(capMove);
    console.log("✓ Apply capture: ok=" + result.ok + " chain=" + !!result.chain);
  }

  // Test other ops
  const user = User.createOrUpdate("TestPlayer");
  console.log("✓ User: " + user.pseudo + " (id=" + user.id + ")");

  const owned = Skins.listOwned(user.id);
  console.log("✓ Owned skins: " + JSON.stringify(owned));
  const equipped = Skins.getEquipped(user.id);
  console.log("✓ Equipped: " + JSON.stringify(equipped));

  const ch = Challenge.create(user.id, 2, 500, "blitz");
  console.log("✓ Challenge: " + ch.id);

  Chat.saveMessage(user.id, 2, "Bonjour !");
  const msgs = Chat.getThread(user.id, 2);
  console.log("✓ Chat: " + msgs.length + " msgs");

  const gid = GameRecord.create(user.id, 2, "online", "blitz", 0);
  GameRecord.finish(gid, user.id, 10, -10, [], "fin");
  console.log("✓ GameRecord: id=" + gid);

  console.log("\n=== TOUS LES TESTS SONT PASSÉS ===");
  process.exit(0);
} catch (err) {
  console.error("✗ ERREUR:", err.message);
  console.error(err.stack);
  process.exit(1);
}
