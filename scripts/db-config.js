/* =========================================================
   D-aôna — Configuration partagée des scripts de données
   ---------------------------------------------------------
   Un seul endroit qui lit l'environnement pour :
     · la base SQLite locale (D_AONA_DB_PATH) ;
     · la base Postgres cible (DATABASE_URL) ;
     · le TLS (PGSSL=disable pour un Postgres local).

   Le serveur lit les mêmes variables (apps/api/src/config.js, lot L4) : deux
   lectures différentes des mêmes réglages finissent par diverger.
   ========================================================= */
"use strict";

const path = require("node:path");

function loadConfig({ requireDatabase = false } = {}) {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
  if (requireDatabase && !databaseUrl) {
    console.error(
      "DATABASE_URL manquante.\n" +
      "  Supabase → Project Settings → Database → Connection string (URI).\n" +
      "  Utilisez le pooler (port 6543) pour l'application, la connexion directe\n" +
      "  (port 5432) pour les migrations et les imports."
    );
    process.exit(2);
  }
  return {
    sqlitePath: process.env.D_AONA_DB_PATH
      ? path.resolve(process.env.D_AONA_DB_PATH)
      : path.join(__dirname, "..", "apps", "api", "d-aona.db"),
    databaseUrl,
    pgSsl: process.env.PGSSL !== "disable",
    /* Le pooler Supabase (Supavisor, port 6543) ne tient pas de requêtes
       préparées nommées : `pg` doit rester en mode simple. */
    pgPrepare: false,
  };
}

module.exports = { loadConfig };
