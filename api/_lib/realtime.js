/* =========================================================
   D-aôna (Vercel + Supabase) — Diffusion temps réel
   1. File `rt_events` en base PostgreSQL (repli garanti via /api/rt/poll)
   2. Supabase Realtime Broadcast HTTP API (poussée instantanée si configuré)
   ========================================================= */
"use strict";

const { query, one } = require("./db");

function realtimeConfig() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return {
    url,
    anonKey,
    serviceKey,
    enabled: !!(url && anonKey),
    canBroadcast: !!(url && serviceKey),
  };
}

async function pushSupabaseBroadcast(topic, payload) {
  const cfg = realtimeConfig();
  if (!cfg.canBroadcast) return;
  try {
    await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic,
            event: "daona",
            payload,
          },
        ],
      }),
    });
  } catch (e) {
    // Non bloquant : le client dispose du repli /api/rt/poll
  }
}

async function emitUser(userId, payload) {
  if (!userId || userId <= 0) return;
  const json = JSON.stringify(payload);
  const row = await one("INSERT INTO rt_events (user_id, payload_json) VALUES ($1, $2) RETURNING id", [userId, json]);
  const wire = row && row.id ? { ...payload, __eid: Number(row.id) } : payload;
  await pushSupabaseBroadcast(`daona:user:${userId}`, wire);
}

async function emitBroadcast(payload) {
  const json = JSON.stringify(payload);
  const row = await one("INSERT INTO rt_events (user_id, payload_json) VALUES (0, $1) RETURNING id", [json]);
  const wire = row && row.id ? { ...payload, __eid: Number(row.id) } : payload;
  await pushSupabaseBroadcast("daona:global", wire);
}

async function pruneOldEvents() {
  try {
    await query("DELETE FROM rt_events WHERE created_at < NOW() - INTERVAL '10 minutes'");
  } catch (_) {}
}

module.exports = {
  realtimeConfig,
  emitUser,
  emitBroadcast,
  pruneOldEvents,
};
