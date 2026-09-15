-- =========================================================
-- 002 — Sessions : jetons opaques, révocables, expirants
-- ---------------------------------------------------------
-- Le jeton remis au client n'est JAMAIS stocké en clair : seule son
-- empreinte SHA-256 est conservée. Une fuite de la base ne permet donc
-- pas de rejouer une session (contrairement à un jeton stocké en clair).
-- Chaque session est liée à un appareil (user-agent) et à une adresse IP
-- pour permettre la révocation individuelle et l'audit.
-- =========================================================

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT    PRIMARY KEY,                 -- identifiant interne (UUID v4)
  user_id        INTEGER NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT    NOT NULL UNIQUE,             -- SHA-256 hex du jeton opaque
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at   TEXT,                                -- ISO 8601 UTC
  expires_at     TEXT    NOT NULL,                    -- ISO 8601 UTC — expiration explicite
  revoked_at     TEXT,                                -- ISO 8601 UTC — révocation individuelle
  revoked_reason TEXT,
  user_agent     TEXT,                                -- tronqué à 200 caractères
  ip             TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);