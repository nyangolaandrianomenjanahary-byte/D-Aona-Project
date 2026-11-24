-- ============================================================================
-- D-aôna — Schéma PostgreSQL complet pour Supabase
-- Compatible avec le backend Vercel Serverless (/api/*)
-- Idempotent : peut être exécuté dans Supabase SQL Editor sans erreur.
-- ============================================================================

-- ---------- 1. Utilisateurs & Profils ----------
CREATE TABLE IF NOT EXISTS users (
  id                      SERIAL PRIMARY KEY,
  pseudo                  TEXT UNIQUE NOT NULL,
  password_hash           TEXT,
  phone                   TEXT,
  email                   TEXT,
  elo                     INTEGER NOT NULL DEFAULT 1100,
  wins                    INTEGER NOT NULL DEFAULT 0,
  losses                  INTEGER NOT NULL DEFAULT 0,
  balance                 INTEGER NOT NULL DEFAULT 0,
  bonus_lock              INTEGER NOT NULL DEFAULT 0,
  kyc                     INTEGER NOT NULL DEFAULT 0,
  bonus_used              INTEGER NOT NULL DEFAULT 0,
  withdrawn_today         INTEGER NOT NULL DEFAULT 0,
  province                TEXT DEFAULT 'Antananarivo',
  region                  TEXT,
  avatar                  TEXT,
  first_name              TEXT,
  last_name               TEXT,
  birth_date              TEXT,
  bio                     TEXT,
  friends_seen_request_id INTEGER,
  last_seen               TEXT,
  last_decay              TEXT,
  created_at              TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email) WHERE email IS NOT NULL AND email <> '';

-- ---------- 2. Avatars stockés en base (serverless-friendly) ----------
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------- 3. Authentification & Sessions ----------
CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash       TEXT NOT NULL,
  algo                TEXT NOT NULL DEFAULT 'argon2id',
  password_changed_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  failed_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  last_failed_at      TEXT,
  locked_until        TEXT,
  created_at          TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at          TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_authcreds_locked ON auth_credentials(locked_until);

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  last_used_at   TEXT,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  revoked_reason TEXT,
  user_agent     TEXT,
  ip             TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id         SERIAL PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  event      TEXT NOT NULL,
  user_id    INTEGER,
  pseudo     TEXT,
  session_id TEXT,
  ip         TEXT,
  user_agent TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_authaudit_at ON auth_audit_log(at);
CREATE INDEX IF NOT EXISTS idx_authaudit_user ON auth_audit_log(user_id, at);
CREATE INDEX IF NOT EXISTS idx_authaudit_event ON auth_audit_log(event, at);

CREATE OR REPLACE FUNCTION d_aona_forbid_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table d audit en ajout seul (append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_authaudit_no_update ON auth_audit_log;
CREATE TRIGGER trg_authaudit_no_update
  BEFORE UPDATE ON auth_audit_log
  FOR EACH ROW EXECUTE FUNCTION d_aona_forbid_audit_mutation();

DROP TRIGGER IF EXISTS trg_authaudit_no_delete ON auth_audit_log;
CREATE TRIGGER trg_authaudit_no_delete
  BEFORE DELETE ON auth_audit_log
  FOR EACH ROW EXECUTE FUNCTION d_aona_forbid_audit_mutation();

-- ---------- 4. Parties & Sessions temps réel ----------
CREATE TABLE IF NOT EXISTS games (
  id          SERIAL PRIMARY KEY,
  player1_id  INTEGER NOT NULL,
  player2_id  INTEGER NOT NULL,
  winner_id   INTEGER,
  delta1      INTEGER,
  delta2      INTEGER,
  mode        TEXT,
  format      TEXT,
  wager       INTEGER DEFAULT 0,
  moves_json  TEXT,
  reason      TEXT,
  game        TEXT NOT NULL DEFAULT 'fanoron-tsivy',
  status      TEXT NOT NULL DEFAULT 'finished',
  elo1_before INTEGER,
  elo1_after  INTEGER,
  elo2_before INTEGER,
  elo2_after  INTEGER,
  created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_games_p1_created ON games(player1_id, created_at);
CREATE INDEX IF NOT EXISTS idx_games_p2_created ON games(player2_id, created_at);

CREATE TABLE IF NOT EXISTS game_sessions (
  id             TEXT PRIMARY KEY,
  player1_id     INTEGER NOT NULL,
  player2_id     INTEGER NOT NULL,
  mode           TEXT,
  format         TEXT,
  wager          INTEGER DEFAULT 0,
  state_json     TEXT NOT NULL,
  winner_id      INTEGER,
  moves_json     TEXT,
  status         TEXT DEFAULT 'playing',
  game           TEXT,
  game_record_id INTEGER,
  created_at     TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at     TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_gs_status ON game_sessions(status);

-- ---------- 5. Matchmaking & Événements temps réel (sans état mémoire) ----------
CREATE TABLE IF NOT EXISTS matchmaking_queue (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  game       TEXT NOT NULL,
  format     TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'online',
  elo        INTEGER NOT NULL DEFAULT 1100,
  pseudo     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mm_game_fmt ON matchmaking_queue(game, format, created_at);

CREATE TABLE IF NOT EXISTS pending_matches (
  match_key  TEXT PRIMARY KEY,
  p1_id      INTEGER NOT NULL,
  p2_id      INTEGER NOT NULL,
  p1_ready   BOOLEAN NOT NULL DEFAULT FALSE,
  p2_ready   BOOLEAN NOT NULL DEFAULT FALSE,
  format     TEXT NOT NULL,
  game       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rt_events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL DEFAULT 0, -- 0 = broadcast global
  payload_json TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rt_events_user_id ON rt_events(user_id, id);

-- ---------- 6. Tournois & Brackets ----------
CREATE TABLE IF NOT EXISTS tournaments (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  game               TEXT,
  format             TEXT,
  entry              INTEGER,
  max_players        INTEGER DEFAULT 8,
  status             TEXT DEFAULT 'inscriptions',
  min_rank           TEXT DEFAULT 'Bronze',
  sponsor            TEXT,
  starts_at          TEXT,
  results_json       TEXT,
  match_duration_min INTEGER DEFAULT 5,
  interval_min       INTEGER DEFAULT 5,
  created_at         TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS tournament_registrations (
  tournament_id INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id               SERIAL PRIMARY KEY,
  tournament_id    INTEGER NOT NULL,
  round            INTEGER NOT NULL,
  slot             INTEGER NOT NULL,
  p1_id            INTEGER,
  p2_id            INTEGER,
  score1           INTEGER,
  score2           INTEGER,
  winner_id        INTEGER,
  status           TEXT DEFAULT 'a_venir',
  starts_at        TEXT,
  confirm_deadline TEXT,
  confirmed_p1     INTEGER DEFAULT 0,
  confirmed_p2     INTEGER DEFAULT 0,
  next_match_id    INTEGER,
  created_at       TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(tournament_id, round, slot)
);
CREATE INDEX IF NOT EXISTS idx_tm_tournament ON tournament_matches(tournament_id, round, slot);

-- ---------- 7. Portefeuille, Retraits & KYC ----------
CREATE TABLE IF NOT EXISTS transactions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  dir        TEXT,
  label      TEXT,
  amount     INTEGER,
  status     TEXT,
  ref_id     TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  reference   TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  paid_by     INTEGER,
  paid_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, status);

CREATE TABLE IF NOT EXISTS kyc_cases (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  recto_path       TEXT NOT NULL,
  verso_path       TEXT NOT NULL,
  recto_sha        TEXT NOT NULL,
  verso_sha        TEXT NOT NULL,
  mime_recto       TEXT NOT NULL,
  mime_verso       TEXT NOT NULL,
  bytes_recto      INTEGER NOT NULL,
  bytes_verso      INTEGER NOT NULL,
  recto_data       TEXT,
  verso_data       TEXT,
  face_path        TEXT,
  face_mime        TEXT,
  face_bytes       INTEGER,
  face_sha         TEXT,
  face_data        TEXT,
  face_captured_at TEXT,
  face_consent_at  TEXT,
  face_required    INTEGER NOT NULL DEFAULT 0,
  retention_until  TEXT,
  reason           TEXT,
  submitted_at     TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  reviewed_at      TEXT,
  reviewer_id      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_cases(user_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_cases(status, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_one_pending ON kyc_cases(user_id) WHERE status = 'pending';

-- ---------- 8. Social : Chat, Amis, Défis, Notifications ----------
CREATE TABLE IF NOT EXISTS chat_messages (
  id           SERIAL PRIMARY KEY,
  from_user_id INTEGER NOT NULL,
  to_user_id   INTEGER NOT NULL,
  text         TEXT,
  created_at   TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_chat_users ON chat_messages(from_user_id, to_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_to_from ON chat_messages(to_user_id, from_user_id, created_at);

CREATE TABLE IF NOT EXISTS friends (
  user_id    INTEGER NOT NULL,
  friend_id  INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id           SERIAL PRIMARY KEY,
  from_id      INTEGER NOT NULL,
  to_id        INTEGER NOT NULL,
  status       TEXT DEFAULT 'pending',
  created_at   TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  responded_at TEXT,
  UNIQUE(from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_freq_to ON friend_requests(to_id, status);

CREATE TABLE IF NOT EXISTS challenges (
  id         TEXT PRIMARY KEY,
  from_id    INTEGER NOT NULL,
  to_id      INTEGER NOT NULL,
  wager      INTEGER DEFAULT 0,
  format     TEXT,
  game       TEXT NOT NULL DEFAULT 'fanoron-tsivy',
  status     TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_challenges_status_expires ON challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_to ON challenges(to_id);
CREATE INDEX IF NOT EXISTS idx_challenges_from ON challenges(from_id);

CREATE TABLE IF NOT EXISTS notifications (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT,
  read         INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at);

-- ---------- 9. Skins & Apparence des pions ----------
CREATE TABLE IF NOT EXISTS user_skins (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_id     TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (user_id, skin_id)
);

CREATE TABLE IF NOT EXISTS equipped_skins (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pions_light TEXT,
  pions_dark  TEXT,
  plateau     TEXT,
  effet       TEXT
);

CREATE TABLE IF NOT EXISTS pion_style (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camp    TEXT NOT NULL,
  color   TEXT NOT NULL,
  pattern TEXT NOT NULL DEFAULT 'aucun',
  shape   TEXT NOT NULL DEFAULT 'ronde',
  PRIMARY KEY (user_id, camp)
);

-- ---------- 10. Administration & Back-office ----------
CREATE TABLE IF NOT EXISTS admin_modules (
  id         TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,
  core       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  protected   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_grants (
  role_id TEXT NOT NULL,
  module  TEXT NOT NULL,
  action  TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, module, action)
);
CREATE INDEX IF NOT EXISTS idx_admin_grants_role ON admin_grants(role_id, module);

CREATE TABLE IF NOT EXISTS admin_assignments (
  user_id    INTEGER NOT NULL,
  role_id    TEXT NOT NULL,
  granted_by INTEGER,
  granted_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_assignments_role ON admin_assignments(role_id);

CREATE TABLE IF NOT EXISTS admin_audit (
  id           SERIAL PRIMARY KEY,
  at           TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  actor_id     INTEGER,
  actor_pseudo TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  detail_json  TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at);

DROP TRIGGER IF EXISTS admin_audit_no_update ON admin_audit;
CREATE TRIGGER admin_audit_no_update
  BEFORE UPDATE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION d_aona_forbid_audit_mutation();

DROP TRIGGER IF EXISTS admin_audit_no_delete ON admin_audit;
CREATE TRIGGER admin_audit_no_delete
  BEFORE DELETE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION d_aona_forbid_audit_mutation();

CREATE TABLE IF NOT EXISTS ads (
  id         SERIAL PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  titre      TEXT NOT NULL,
  image      TEXT NOT NULL,
  repli      TEXT,
  lien       TEXT,
  debut      TEXT,
  fin        TEXT,
  position   TEXT NOT NULL DEFAULT 'accueil',
  actif      INTEGER NOT NULL DEFAULT 1,
  ordre      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ads_position ON ads(position, actif, ordre);

CREATE TABLE IF NOT EXISTS disputes (
  id          SERIAL PRIMARY KEY,
  match_id    INTEGER NOT NULL,
  user_id     INTEGER,
  category    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'rejected')),
  outcome     TEXT CHECK (outcome IS NULL OR outcome IN ('none', 'corrected', 'void')),
  resolution  TEXT,
  created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  resolved_by INTEGER,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_disputes_match ON disputes(match_id);

CREATE TABLE IF NOT EXISTS admin_games (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  variant    TEXT,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  duration   INTEGER NOT NULL DEFAULT 30 CHECK (duration > 0),
  ranked     INTEGER NOT NULL DEFAULT 1,
  min_elo    INTEGER NOT NULL DEFAULT 0 CHECK (min_elo >= 0),
  rules      TEXT,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_games_status ON admin_games(status, name);

CREATE TABLE IF NOT EXISTS badges (
  name     TEXT PRIMARY KEY,
  icon     TEXT,
  color    TEXT,
  ink      TEXT,
  min_rank INTEGER NOT NULL CHECK (min_rank >= 1),
  max_rank INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_range ON badges(min_rank, max_rank);

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS user_sanctions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('block', 'unblock', 'warning', 'kyc_revoke')),
  reason     TEXT,
  actor_id   INTEGER,
  created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  lifted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sanctions_user ON user_sanctions(user_id, id);
CREATE INDEX IF NOT EXISTS idx_sanctions_kind ON user_sanctions(kind, created_at);

-- ============================================================================
-- Données initiales (idempotentes)
-- ============================================================================

INSERT INTO platform_settings (key, value) VALUES
  ('revision', '0'),
  ('platform_name', 'D-aôna'),
  ('registrations_open', 'true'),
  ('maintenance_mode', 'false'),
  ('kyc_face_required', 'false')
ON CONFLICT (key) DO NOTHING;

INSERT INTO admin_modules (id, enabled, core) VALUES
  ('overview',    1, 1),
  ('users',       1, 0),
  ('kyc',         1, 0),
  ('disputes',    1, 0),
  ('games',       1, 0),
  ('matches',     1, 0),
  ('tournaments', 1, 0),
  ('ranking',     1, 0),
  ('finance',     1, 0),
  ('withdrawals', 1, 0),
  ('campaigns',   1, 0),
  ('roles',       1, 1),
  ('modules',     1, 1),
  ('audit',       1, 1),
  ('settings',    1, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_roles (id, label, description, protected) VALUES
  ('super_admin', 'Super administrateur', 'Tous les droits, y compris la gestion des rôles. Rôle protégé : ne peut pas être retiré au dernier titulaire.', 1),
  ('admin',       'Administrateur',       'Tout le back-office en lecture, création, modification, décision et export — sauf les rôles.', 0),
  ('moderation',  'Modération',           'Joueurs, identités, litiges et parties : lire, décider, corriger.', 0),
  ('finance',     'Finance',              'Portefeuilles, flux et demandes de retrait.', 0),
  ('tournaments', 'Responsable tournois', 'Tournois et parties : créer, organiser, décider. Classement et catalogue en lecture.', 0),
  ('marketing',   'Marketing',            'Bannières publicitaires de l''accueil et des profils.', 0),
  ('observer',    'Observateur',          'Lecture seule sur tout le back-office.', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO badges (name, icon, color, ink, min_rank, max_rank) VALUES
  ('Remenabila',  '👑', '#e3b23c', '#7a5a00', 1, 1),
  ('Malaso',      '⚔️', '#9aa3ad', '#48525c', 2, 2),
  ('Dahalo',      '🗡️', '#bc7a44', '#7a4210', 3, 3),
  ('Totakely',    '🛡️', '#4f8ff7', '#1e40af', 4, 25),
  ('Akofa',       '🎋', '#22c55e', '#0f6b33', 26, 50),
  ('Vary masaka', '🍚', '#8a8fa3', '#525669', 51, NULL)
ON CONFLICT (name) DO NOTHING;

INSERT INTO admin_games (slug, name, variant, status, duration, ranked, min_elo, rules) VALUES
  ('fanoron-tsivy', 'Fanoron-Tsivy', '9 × 5 · Classique', 'active', 30, 1, 0, 'Plateau traditionnel malgache 9×5. Captures par approche ou retrait, prises en chaîne.'),
  ('fanoron-dimy',  'Fanoron-Dimy',  '5 × 5 · Rapide',    'active', 15, 1, 0, 'Douze pions sur plateau 5×5, captures par approche ou retrait.'),
  ('fanoron-telo',  'Fanoron-Telo',  '3 × 3 · Express',   'active', 10, 1, 0, 'Trois pions par joueur, alignement de 3 pions sur plateau 3×3.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ads (slug, titre, image, repli, lien, debut, fin, position, actif, ordre) VALUES
  ('yas-nperf-2025', 'Yas — élu meilleur réseau mobile de Madagascar (trophée nPerf 2025)', 'assets/ad/yas-nperf-2025.webp', 'assets/ad/yas-nperf-2025.svg', 'https://www.yas.mg', '2026-01-01', '2026-12-31', 'accueil', 1, 0),
  ('d-aona-maison',  'D-aôna — jouez au Fanorona et défiez vos amis', 'assets/ad/d-aona-maison.svg', NULL, 'https://github.com/nyangolaandrianomenjanahary-byte/D-Aona', '2026-01-01', '2026-12-31', 'accueil', 1, 1)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tournaments (id, name, game, format, entry, max_players, status, min_rank, sponsor, starts_at, results_json, match_duration_min, interval_min) VALUES
  (1, 'Tournoi Hebdo Fanorona #24', 'Fanorona', 'rapide', 2000, 8, 'inscriptions', 'Bronze', NULL, to_char((NOW() + INTERVAL '2 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL, 5, 5),
  (2, 'Blitz Cup — Analamanga',     'Fanorona', 'blitz',  1000, 8, 'inscriptions', 'Bronze', NULL, to_char((NOW() + INTERVAL '5 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL, 5, 5),
  (3, 'D-aôna Masters — Saison 2',  'Fanorona', 'pro',    5000, 8, 'inscriptions', 'Platine', 'MVola Gaming Cup', to_char((NOW() + INTERVAL '6 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL, 5, 5),
  (4, 'Tournoi Hebdo Fanorona #23', 'Fanorona', 'rapide', 2000, 8, 'termine',      'Bronze', NULL, to_char((NOW() - INTERVAL '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '{"first":"SolofoGM","second":"ZoFighter","third":"KantoV"}', 5, 5),
  (5, 'Tournoi Test ⚔️',            'Fanorona', 'rapide', 5000, 4, 'inscriptions', 'Bronze', NULL, to_char((NOW() + INTERVAL '15 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL, 5, 0)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('tournaments', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM tournaments), 1), 5));
