/* =========================================================
   D-aôna (Vercel + Supabase) — Connexion PostgreSQL & amorçage
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const Perms = require("../../apps/api/admin/permissions");

function getDbUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  ).trim();
}

function getPool() {
  if (globalThis.__daonaPgPool) return globalThis.__daonaPgPool;
  const url = getDbUrl();
  if (!url) {
    throw new Error(
      "Variable DATABASE_URL (ou SUPABASE_DB_URL / POSTGRES_URL) manquante. Configurez votre base Supabase dans les variables d'environnement Vercel."
    );
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/i.test(url);
  const pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 8000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (err) => {
    console.error("[pg] erreur pool:", err.message || err);
  });
  globalThis.__daonaPgPool = pool;
  return pool;
}

async function query(sql, params = []) {
  const pool = getPool();
  return pool.query(sql, params);
}

async function one(sql, params = []) {
  const r = await query(sql, params);
  return r.rows[0] || null;
}

async function all(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const helpers = {
      query: (s, p = []) => client.query(s, p),
      one: async (s, p = []) => (await client.query(s, p)).rows[0] || null,
      all: async (s, p = []) => (await client.query(s, p)).rows,
    };
    const out = await fn(helpers);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

let _schemaReady = false;
let _schemaPromise = null;

async function seedAdminGrants(dbLike) {
  const existing = await dbLike.one("SELECT COUNT(*)::int AS c FROM admin_grants");
  if (existing && existing.c > 0) return;

  const values = [];
  const params = [];
  let idx = 1;
  for (const [roleId, def] of Object.entries(Perms.ROLES)) {
    const rights = def.rights || Perms.fullRights();
    for (const mod of Perms.ALL_MODULES) {
      const allowedActs = Array.isArray(rights[mod]) ? rights[mod] : [];
      for (const act of Perms.ALL_ACTIONS) {
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(roleId, mod, act, allowedActs.includes(act) ? 1 : 0);
      }
    }
  }
  if (values.length) {
    await dbLike.query(
      `INSERT INTO admin_grants (role_id, module, action, allowed) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,
      params
    );
  }
}

async function ensureSchema() {
  if (_schemaReady) return;
  if (_schemaPromise) return _schemaPromise;

  _schemaPromise = (async () => {
    const check = await one("SELECT to_regclass('public.users') AS u, to_regclass('public.rt_events') AS r");
    if (!check || !check.u || !check.r) {
      const schemaPath = path.resolve(__dirname, "../../supabase/schema.sql");
      const sql = fs.readFileSync(schemaPath, "utf8");
      await query(sql);
    }
    await seedAdminGrants({ one, query });
    _schemaReady = true;
  })().catch((err) => {
    _schemaPromise = null;
    throw err;
  });

  return _schemaPromise;
}

module.exports = {
  getDbUrl,
  getPool,
  query,
  one,
  all,
  tx,
  ensureSchema,
  seedAdminGrants,
};
