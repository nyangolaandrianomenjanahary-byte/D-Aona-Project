-- =========================================================
-- 001 — Identifiants d'authentification
-- ---------------------------------------------------------
-- Le secret (mot de passe haché) est volontairement isolé de la table
-- `users` pour deux raisons :
--   1. séparer l'identité publique (pseudo, Elo, province) du secret ;
--   2. permettre un contrôle d'accès distinct : une lecture de profil
--      classique n'a jamais besoin de toucher cette table.
-- Aucun mot de passe en clair n'est stocké, ni journalisé, ni transmis
-- dans une réponse d'API.
-- =========================================================

CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id             INTEGER PRIMARY KEY
                      REFERENCES users(id) ON DELETE CASCADE,
  password_hash       TEXT    NOT NULL,              -- format PHC Argon2id : $argon2id$v=19$m=...
  algo                TEXT    NOT NULL DEFAULT 'argon2id',
  password_changed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  failed_attempts     INTEGER NOT NULL DEFAULT 0
                      CHECK (failed_attempts >= 0),  -- échecs consécutifs, remis à 0 après succès
  last_failed_at      TEXT,                          -- ISO 8601 UTC
  locked_until        TEXT,                          -- ISO 8601 UTC — verrouillage temporaire
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sert au balayage périodique des comptes verrouillés.
CREATE INDEX IF NOT EXISTS idx_authcreds_locked ON auth_credentials(locked_until);