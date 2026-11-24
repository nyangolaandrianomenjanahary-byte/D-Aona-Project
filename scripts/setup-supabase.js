"use strict";

const { ensureSchema, getDbUrl, pool } = require("../api/_lib/db");

async function main() {
  if (!getDbUrl()) {
    console.error("[setup:supabase] Erreur : définissez DATABASE_URL (ou SUPABASE_DB_URL / POSTGRES_URL).");
    process.exit(1);
  }
  console.log("[setup:supabase] Application de supabase/schema.sql et initialisation des droits admin...");
  await ensureSchema();
  console.log("[setup:supabase] Base Supabase prête.");
  await pool().end();
}

main().catch((err) => {
  console.error("[setup:supabase] Échec :", err);
  process.exit(1);
});
