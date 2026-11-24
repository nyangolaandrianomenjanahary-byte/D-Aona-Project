/* =========================================================
   D-aôna — Remise à zéro COMPLÈTE de la base (base vierge)
   ---------------------------------------------------------
   Les tables sont SUPPRIMÉES (DROP TABLE), pas vidées ligne à ligne : le
   journal d'audit (auth_audit_log) est en ajout seul et deux déclencheurs y
   interdisent formellement DELETE.

   Le schéma n'est pas perdu : il est recréé au démarrage suivant du serveur
   (db.js → init(), puis les migrations versionnées de migrations/).

   Usage :  node wipe_db.js          → rappelle ce que fait le script
            node wipe_db.js --yes    → exécute (SERVEUR ARRÊTÉ)
   ========================================================= */
"use strict";
const { db } = require("./db");

if (!process.argv.includes("--yes")) {
  console.log("Ce script supprime TOUTES les données de d-aona.db :");
  console.log("  comptes, identifiants, sessions, parties, tournois, wallet,");
  console.log("  chat, amitiés, notifications et journal d'audit.\n");
  console.log("1. Sauvegarde d'abord :  node backup_db.js");
  console.log("2. Arrêter le serveur.");
  console.log("3. Puis :                 node wipe_db.js --yes");
  process.exit(0);
}

/* Sans cela, le DROP de `users` violerait les clés étrangères des tables
   filles (sessions, game_sessions, transactions…). Les contraintes sont
   réactivées au redémarrage par db.js. */
db.exec("PRAGMA foreign_keys = OFF");

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
).all().map((r) => r.name);

for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t}"`);
db.exec("VACUUM");

console.log(`${tables.length} table(s) supprimée(s) : ${tables.join(", ")}`);
const left = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().n;
console.log(`Tables restantes : ${left}`);
console.log("Base vierge. Le schéma sera recréé au prochain démarrage du serveur (node server.js).");
