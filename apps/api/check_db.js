"use strict";
/* Vérification directe de la base SQLite : toutes les tables du jeu */
const { db } = require("./db");

const tables = ["users", "games", "tournaments", "tournament_registrations",
  "transactions", "chat_messages", "user_skins", "equipped_skins", "challenges", "game_sessions"];

console.log("=== ÉTAT DE LA BASE DE DONNÉES (d-aona.db) ===");
for (const t of tables) {
  try {
    const c = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
    console.log(`  ✓ ${t.padEnd(28)} ${c} ligne(s)`);
  } catch (e) {
    console.log(`  ✗ ${t.padEnd(28)} ERREUR: ${e.message}`);
  }
}

console.log("\n--- 5 dernières parties enregistrées ---");
for (const g of db.prepare("SELECT id, player1_id, player2_id, winner_id, mode, reason, created_at FROM games ORDER BY id DESC LIMIT 5").all()) {
  console.log(`  #${g.id} P${g.player1_id} vs P${g.player2_id} → gagnant P${g.winner_id} (${g.mode}/${g.reason}) ${g.created_at}`);
}

console.log("\n--- Tournois ---");
for (const t of db.prepare("SELECT id, name, status FROM tournaments").all()) {
  console.log(`  #${t.id} ${t.name} [${t.status}]`);
}

console.log("\n--- Sessions de jeu persistées ---");
for (const s of db.prepare("SELECT id, mode, status FROM game_sessions ORDER BY updated_at DESC LIMIT 5").all()) {
  console.log(`  ${s.id} [${s.mode}/${s.status}]`);
}
console.log("\n=== VÉRIFICATION DB TERMINÉE ===");
