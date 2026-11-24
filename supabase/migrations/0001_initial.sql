-- =========================================================
-- D-aôna — Schéma initial Postgres / Supabase
-- ---------------------------------------------------------
-- GÉNÉRÉ par scripts/gen-db-model.js depuis la base SQLite réelle.
-- Ne pas éditer à la main : corriger le générateur, puis régénérer.
--
-- Conventions :
--   · identifiants entiers  -> bigint identity (compatibilité des 452 appels)
--   · horodatages TEXT      -> timestamptz
--   · drapeaux INTEGER 0/1  -> boolean
--   · montants en ARIARY    -> integer (l'ariary n'a pas de sous-unité)
--   · JSON applicatif       -> text (conservé tel quel : le code le sérialise)
-- =========================================================

begin;

-- Administration — Fiche des plateaux exposés par l'administration.
create table admin_games (
  slug text,
  name text not null,
  variant text,
  status text default 'draft' not null,
  duration bigint default 30 not null,
  ranked boolean default true not null,
  min_elo bigint default 0 not null,
  rules text,
  version bigint default 1 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz,
  primary key (slug)
);

-- Administration — Modules du back-office et leur interrupteur global.
create table admin_modules (
  id text,
  enabled boolean default true not null,
  updated_at timestamptz,
  core boolean default false not null,
  primary key (id)
);

-- Administration — Rôles d'administration (super_admin, admin, observer…).
create table admin_roles (
  id text,
  label text not null,
  description text,
  protected boolean default false not null,
  primary key (id)
);

-- Administration — Matrice rôle × module × action (le droit effectif).
create table admin_grants (
  role_id text not null,
  module text not null,
  action text not null,
  allowed boolean default false not null,
  primary key (role_id, module, action),
  constraint fk_admin_grants_role_id foreign key (role_id) references admin_roles (id) on delete CASCADE,
  constraint fk_admin_grants_module foreign key (module) references admin_modules (id) on delete CASCADE
);

-- Contenu — Bannières publicitaires du carrousel (actif, période, ordre).
create table ads (
  id bigint generated always as identity primary key,
  slug text not null,
  titre text not null,
  image text not null,
  repli text,
  lien text,
  debut timestamptz,
  fin timestamptz,
  position text default 'accueil' not null,
  actif boolean default true not null,
  ordre bigint default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz
);

-- Identité & accès — Journal d'authentification : connexions, échecs, révocations.
create table auth_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now() not null,
  event text not null,
  user_id bigint,
  pseudo text,
  session_id text,
  ip text,
  user_agent text,
  detail text
);

-- Classement — Paliers de classement (nom, icône, rang min/max).
create table badges (
  name text,
  icon text,
  color text,
  ink text,
  min_rank bigint not null,
  max_rank bigint,
  primary key (name)
);

-- Administration — Réglages globaux clé/valeur (inscriptions ouvertes, etc.).
create table platform_settings (
  key text,
  value text not null,
  updated_at timestamptz,
  primary key (key)
);

-- Tournois — Tournoi : format, droits d'entrée, horaires de matchs.
create table tournaments (
  id bigint generated always as identity primary key,
  name text not null,
  game text,
  format text,
  entry bigint,
  max_players bigint default 8,
  status text default 'inscriptions',
  min_rank text default 'Bronze',
  sponsor text,
  starts_at timestamptz,
  results_json text,
  created_at timestamptz default now(),
  match_duration_min bigint default 5,
  interval_min bigint default 5
);

-- Économie — Grand livre du portefeuille : chaque mouvement d'ariary, avec son état.
create table transactions (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  dir text,
  label text,
  amount bigint,
  status text,
  ref_id text,
  created_at timestamptz default now()
);

-- Administration — Qui détient quel rôle, et depuis quand.
create table admin_assignments (
  user_id bigint not null,
  role_id text not null,
  granted_by bigint,
  granted_at timestamptz default now() not null,
  primary key (user_id, role_id),
  constraint fk_admin_assignments_role_id foreign key (role_id) references admin_roles (id) on delete CASCADE
);

-- Administration — Journal des actions sensibles du back-office.
create table admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz default now() not null,
  actor_id bigint,
  actor_pseudo text,
  action text not null,
  target text,
  detail_json text,
  ip text
);

-- Identité & accès — Empreinte Argon2id, verrouillage progressif par échecs. Remplacé par Supabase Auth (lot L7).
create table auth_credentials (
  user_id bigint,
  password_hash text not null,
  algo text default 'argon2id' not null,
  password_changed_at timestamptz default now() not null,
  failed_attempts bigint default 0 not null,
  last_failed_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (user_id)
);

-- Jeu — Défi d'un joueur à un autre, avec mise et échéance.
create table challenges (
  id text,
  from_id bigint not null,
  to_id bigint not null,
  wager bigint default 0,
  format text,
  status text default 'pending',
  created_at timestamptz default now(),
  expires_at timestamptz,
  game text default 'fanoron-tsivy' not null,
  primary key (id)
);

-- Social — Messages privés entre deux joueurs.
create table chat_messages (
  id bigint generated always as identity primary key,
  from_user_id bigint not null,
  to_user_id bigint not null,
  text text,
  created_at timestamptz default now()
);

-- Économie — Litiges ouverts sur une partie, avec issue et résolution.
create table disputes (
  id bigint generated always as identity primary key,
  match_id bigint not null,
  user_id bigint,
  category text not null,
  reason text not null,
  status text default 'open' not null,
  outcome text,
  resolution text,
  created_at timestamptz default now() not null,
  resolved_by bigint,
  resolved_at timestamptz
);

-- Personnalisation — Skins équipés (plateau, pions clairs, pions sombres).
create table equipped_skins (
  user_id bigint,
  pions_light text,
  pions_dark text,
  plateau text,
  effet text,
  primary key (user_id)
);

-- Social — Demandes d'ami en attente / acceptées.
create table friend_requests (
  id bigint generated always as identity primary key,
  from_id bigint not null,
  to_id bigint not null,
  status text default 'pending',
  created_at timestamptz default now(),
  responded_at timestamptz
);

-- Identité & accès — Compte joueur : profil public, Elo, solde, état KYC.
create table users (
  id bigint generated always as identity primary key,
  pseudo text not null,
  password_hash text,
  phone text,
  email text,
  elo bigint default 1100,
  wins bigint default 0,
  losses bigint default 0,
  balance bigint default 0,
  bonus_lock boolean default false,
  kyc boolean default false,
  bonus_used boolean default false,
  withdrawn_today bigint default 0,
  last_seen timestamptz,
  created_at timestamptz default now(),
  province text default 'Antananarivo',
  last_decay timestamptz,
  avatar text,
  region text,
  friends_seen_request_id bigint,
  first_name text,
  last_name text,
  birth_date date,
  bio text,
  constraint fk_users_friends_seen_request_id foreign key (friends_seen_request_id) references friend_requests (id) on delete SET NULL
);

-- Social — Relations d'amitié (deux lignes par paire, une par sens).
create table friends (
  user_id bigint not null,
  friend_id bigint not null,
  created_at timestamptz default now(),
  primary key (user_id, friend_id),
  constraint fk_friends_user_id foreign key (user_id) references users (id) on delete CASCADE,
  constraint fk_friends_friend_id foreign key (friend_id) references users (id) on delete CASCADE
);

-- Jeu — Historique des parties terminées : camps, Elo avant/après, motif.
create table games (
  id bigint generated always as identity primary key,
  player1_id bigint not null,
  player2_id bigint not null,
  winner_id bigint,
  delta1 bigint,
  delta2 bigint,
  mode text,
  format text,
  wager bigint default 0,
  moves_json text,
  reason text,
  created_at timestamptz default now(),
  elo1_before bigint,
  elo1_after bigint,
  elo2_before bigint,
  elo2_after bigint,
  game text default 'fanoron-tsivy' not null,
  status text default 'finished' not null,
  constraint fk_games_player1_id foreign key (player1_id) references users (id) on delete NO ACTION,
  constraint fk_games_player2_id foreign key (player2_id) references users (id) on delete NO ACTION,
  constraint fk_games_winner_id foreign key (winner_id) references users (id) on delete SET NULL
);

-- Jeu — Instantané sérialisé d'une partie en cours (reprise après redémarrage).
create table game_sessions (
  id text,
  player1_id bigint not null,
  player2_id bigint not null,
  mode text,
  format text,
  wager bigint default 0,
  state_json text not null,
  winner_id bigint,
  moves_json text,
  status text default 'playing',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  game text,
  game_record_id bigint,
  primary key (id),
  constraint fk_game_sessions_player1_id foreign key (player1_id) references users (id) on delete CASCADE,
  constraint fk_game_sessions_player2_id foreign key (player2_id) references users (id) on delete CASCADE,
  constraint fk_game_sessions_winner_id foreign key (winner_id) references users (id) on delete SET NULL,
  constraint fk_game_sessions_game_record_id foreign key (game_record_id) references games (id) on delete SET NULL
);

-- Conformité — Dossiers d'identité (recto/verso/visage). DONNÉES PERSONNELLES SENSIBLES : chemins privés, jamais servis en statique.
create table kyc_cases (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  status text default 'pending' not null,
  recto_path text not null,
  verso_path text not null,
  recto_sha text not null,
  verso_sha text not null,
  mime_recto text not null,
  mime_verso text not null,
  bytes_recto bigint not null,
  bytes_verso bigint not null,
  reason text,
  submitted_at timestamptz default now() not null,
  reviewed_at timestamptz,
  reviewer_id bigint,
  face_path text,
  face_mime text,
  face_bytes bigint,
  face_sha text,
  face_captured_at timestamptz,
  face_consent_at timestamptz,
  retention_until timestamptz,
  face_required boolean default false not null,
  constraint fk_kyc_cases_user_id foreign key (user_id) references users (id) on delete CASCADE,
  constraint fk_kyc_cases_reviewer_id foreign key (reviewer_id) references users (id) on delete SET NULL
);

-- Social — Notifications persistantes d'un compte.
create table notifications (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  type text not null,
  payload_json text,
  read boolean default false,
  created_at timestamptz default now(),
  constraint fk_notifications_user_id foreign key (user_id) references users (id) on delete CASCADE
);

-- Personnalisation — Apparence du pion par camp (couleur, motif, forme).
create table pion_style (
  user_id bigint not null,
  camp text not null,
  color text not null,
  pattern text default 'aucun' not null,
  shape text default 'ronde' not null,
  primary key (user_id, camp),
  constraint fk_pion_style_user_id foreign key (user_id) references users (id) on delete CASCADE
);

-- Identité & accès — Jetons de session opaques, stockés HACHÉS (jamais en clair). Remplacé par les JWT Supabase (lot L7).
create table sessions (
  id text,
  user_id bigint not null,
  token_hash text not null,
  created_at timestamptz default now() not null,
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  user_agent text,
  ip text,
  primary key (id),
  constraint fk_sessions_user_id foreign key (user_id) references users (id) on delete CASCADE
);

-- Tournois — Bracket d'élimination directe : rounds, confirmations, forfaits.
create table tournament_matches (
  id bigint generated always as identity primary key,
  tournament_id bigint not null,
  round bigint not null,
  slot bigint not null,
  p1_id bigint,
  p2_id bigint,
  score1 bigint,
  score2 bigint,
  winner_id bigint,
  status text default 'a_venir',
  starts_at timestamptz,
  confirm_deadline timestamptz,
  confirmed_p1 boolean default false,
  confirmed_p2 boolean default false,
  next_match_id bigint,
  created_at timestamptz default now(),
  constraint fk_tournament_matches_tournament_id foreign key (tournament_id) references tournaments (id) on delete CASCADE,
  constraint fk_tournament_matches_p1_id foreign key (p1_id) references users (id) on delete SET NULL,
  constraint fk_tournament_matches_p2_id foreign key (p2_id) references users (id) on delete SET NULL,
  constraint fk_tournament_matches_winner_id foreign key (winner_id) references users (id) on delete SET NULL,
  constraint fk_tournament_matches_next_match_id foreign key (next_match_id) references tournament_matches (id) on delete SET NULL
);

-- Tournois — Inscriptions d'un joueur à un tournoi.
create table tournament_registrations (
  tournament_id bigint not null,
  user_id bigint not null,
  registered_at timestamptz default now(),
  primary key (tournament_id, user_id),
  constraint fk_tournament_registrations_tournament_id foreign key (tournament_id) references tournaments (id) on delete CASCADE,
  constraint fk_tournament_registrations_user_id foreign key (user_id) references users (id) on delete CASCADE
);

-- Administration — Sanctions appliquées à un compte (avertissement, suspension).
create table user_sanctions (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  kind text not null,
  reason text,
  actor_id bigint,
  created_at timestamptz default now() not null,
  lifted_at timestamptz,
  constraint fk_user_sanctions_user_id foreign key (user_id) references users (id) on delete CASCADE,
  constraint fk_user_sanctions_actor_id foreign key (actor_id) references users (id) on delete SET NULL
);

-- Personnalisation — Skins possédés par un joueur.
create table user_skins (
  user_id bigint not null,
  skin_id text not null,
  acquired_at timestamptz default now(),
  primary key (user_id, skin_id),
  constraint fk_user_skins_user_id foreign key (user_id) references users (id) on delete CASCADE
);

-- Économie — Demandes de retrait instruites par le back-office.
create table withdrawals (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  amount bigint not null,
  method text not null,
  phone text,
  status text default 'pending' not null,
  reference text,
  reason text,
  created_at timestamptz default now() not null,
  reviewed_by bigint,
  reviewed_at timestamptz,
  paid_by bigint,
  paid_at timestamptz,
  constraint fk_withdrawals_user_id foreign key (user_id) references users (id) on delete NO ACTION,
  constraint fk_withdrawals_reviewed_by foreign key (reviewed_by) references users (id) on delete SET NULL,
  constraint fk_withdrawals_paid_by foreign key (paid_by) references users (id) on delete SET NULL
);

-- ---------- Contraintes différées (cycle de dépendance) ----------
-- `users` et `friend_requests` se référencent mutuellement : ces contraintes
-- ne peuvent pas vivre dans le CREATE TABLE, elles arrivent après.
alter table admin_assignments add constraint fk_admin_assignments_user_id foreign key (user_id) references users (id) on delete CASCADE;
alter table admin_assignments add constraint fk_admin_assignments_granted_by foreign key (granted_by) references users (id) on delete SET NULL;
alter table admin_audit add constraint fk_admin_audit_actor_id foreign key (actor_id) references users (id) on delete SET NULL;
alter table auth_credentials add constraint fk_auth_credentials_user_id foreign key (user_id) references users (id) on delete CASCADE;
alter table challenges add constraint fk_challenges_from_id foreign key (from_id) references users (id) on delete CASCADE;
alter table challenges add constraint fk_challenges_to_id foreign key (to_id) references users (id) on delete CASCADE;
alter table chat_messages add constraint fk_chat_messages_from_user_id foreign key (from_user_id) references users (id) on delete CASCADE;
alter table chat_messages add constraint fk_chat_messages_to_user_id foreign key (to_user_id) references users (id) on delete CASCADE;
alter table disputes add constraint fk_disputes_match_id foreign key (match_id) references games (id) on delete CASCADE;
alter table disputes add constraint fk_disputes_user_id foreign key (user_id) references users (id) on delete SET NULL;
alter table disputes add constraint fk_disputes_resolved_by foreign key (resolved_by) references users (id) on delete SET NULL;
alter table equipped_skins add constraint fk_equipped_skins_user_id foreign key (user_id) references users (id) on delete CASCADE;
alter table friend_requests add constraint fk_friend_requests_from_id foreign key (from_id) references users (id) on delete CASCADE;
alter table friend_requests add constraint fk_friend_requests_to_id foreign key (to_id) references users (id) on delete CASCADE;

-- ---------- Index déclarés par le schéma SQLite ----------
create index idx_admin_games_status on admin_games (status, name);
create index idx_admin_grants_role on admin_grants (role_id, module);
create index idx_ads_position on ads (position, actif, ordre);
create unique index sqlite_autoindex_ads_1 on ads (slug);
create index idx_authaudit_event on auth_audit_log (event, at);
create index idx_authaudit_user on auth_audit_log (user_id, at);
create index idx_authaudit_at on auth_audit_log (at);
create unique index idx_badges_range on badges (min_rank, max_rank);
create index idx_admin_assignments_role on admin_assignments (role_id);
create index idx_admin_audit_actor on admin_audit (actor_id);
create index idx_admin_audit_at on admin_audit (at);
create index idx_authcreds_locked on auth_credentials (locked_until);
create index idx_challenges_from on challenges (from_id);
create index idx_challenges_to on challenges (to_id);
create index idx_challenges_status_expires on challenges (status, expires_at);
create index idx_chat_to_from on chat_messages (to_user_id, from_user_id, created_at);
create index idx_chat_users on chat_messages (from_user_id, to_user_id);
create index idx_disputes_match on disputes (match_id);
create index idx_disputes_status on disputes (status, created_at);
create index idx_freq_to on friend_requests (to_id, status);
create unique index sqlite_autoindex_friend_requests_1 on friend_requests (from_id, to_id);
create unique index idx_users_email_unique on users (email);
create unique index idx_users_phone_unique on users (phone);
create unique index sqlite_autoindex_users_1 on users (pseudo);
create index idx_friends_user on friends (user_id);
create index idx_games_p2_created on games (player2_id, created_at);
create index idx_games_p1_created on games (player1_id, created_at);
create unique index idx_kyc_one_pending on kyc_cases (user_id);
create index idx_kyc_status on kyc_cases (status, submitted_at);
create index idx_kyc_user on kyc_cases (user_id, submitted_at);
create index idx_notif_user on notifications (user_id, read, created_at);
create index idx_sessions_expires on sessions (expires_at);
create index idx_sessions_user on sessions (user_id);
create unique index sqlite_autoindex_sessions_2 on sessions (token_hash);
create index idx_tm_tournament on tournament_matches (tournament_id, round, slot);
create unique index sqlite_autoindex_tournament_matches_1 on tournament_matches (tournament_id, round, slot);
create index idx_sanctions_kind on user_sanctions (kind, created_at);
create index idx_sanctions_user on user_sanctions (user_id, id);
create index idx_withdrawals_user on withdrawals (user_id, status);
create index idx_withdrawals_status on withdrawals (status, created_at);

-- ---------- Index des clés étrangères ----------
-- Postgres n'indexe PAS les clés étrangères : sans ces index, chaque
-- suppression de compte balaie la table enfant entière.
create index ix_auth_credentials_user_id on auth_credentials (user_id);
create index ix_equipped_skins_user_id on equipped_skins (user_id);
create index ix_friends_friend_id on friends (friend_id);
create index ix_user_sanctions_actor_id on user_sanctions (actor_id);
create index ix_withdrawals_reviewed_by on withdrawals (reviewed_by);
create index ix_withdrawals_paid_by on withdrawals (paid_by);
create index ix_kyc_cases_reviewer_id on kyc_cases (reviewer_id);
create index ix_games_winner_id on games (winner_id);
create index ix_game_sessions_player1_id on game_sessions (player1_id);
create index ix_game_sessions_player2_id on game_sessions (player2_id);
create index ix_game_sessions_winner_id on game_sessions (winner_id);
create index ix_game_sessions_game_record_id on game_sessions (game_record_id);
create index ix_disputes_user_id on disputes (user_id);
create index ix_disputes_resolved_by on disputes (resolved_by);
create index ix_admin_assignments_granted_by on admin_assignments (granted_by);
create index ix_admin_grants_module on admin_grants (module);
create index ix_tournament_registrations_user_id on tournament_registrations (user_id);
create index ix_tournament_matches_p1_id on tournament_matches (p1_id);
create index ix_tournament_matches_p2_id on tournament_matches (p2_id);
create index ix_tournament_matches_winner_id on tournament_matches (winner_id);
create index ix_tournament_matches_next_match_id on tournament_matches (next_match_id);
create index ix_users_friends_seen_request_id on users (friends_seen_request_id);

-- ---------- Commentaires (visibles dans le tableau de bord Supabase) ----------
comment on table admin_games is 'Fiche des plateaux exposés par l''administration.';
comment on table admin_modules is 'Modules du back-office et leur interrupteur global.';
comment on table admin_roles is 'Rôles d''administration (super_admin, admin, observer…).';
comment on table admin_grants is 'Matrice rôle × module × action (le droit effectif).';
comment on table ads is 'Bannières publicitaires du carrousel (actif, période, ordre).';
comment on table auth_audit_log is 'Journal d''authentification : connexions, échecs, révocations.';
comment on table badges is 'Paliers de classement (nom, icône, rang min/max).';
comment on table platform_settings is 'Réglages globaux clé/valeur (inscriptions ouvertes, etc.).';
comment on table tournaments is 'Tournoi : format, droits d''entrée, horaires de matchs.';
comment on table transactions is 'Grand livre du portefeuille : chaque mouvement d''ariary, avec son état.';
comment on column transactions.amount is 'Secret — jamais renvoyé par l API.';
comment on table admin_assignments is 'Qui détient quel rôle, et depuis quand.';
comment on table admin_audit is 'Journal des actions sensibles du back-office.';
comment on table auth_credentials is 'Empreinte Argon2id, verrouillage progressif par échecs. Remplacé par Supabase Auth (lot L7).';
comment on column auth_credentials.password_hash is 'Secret — jamais renvoyé par l API.';
comment on table challenges is 'Défi d''un joueur à un autre, avec mise et échéance.';
comment on table chat_messages is 'Messages privés entre deux joueurs.';
comment on table disputes is 'Litiges ouverts sur une partie, avec issue et résolution.';
comment on table equipped_skins is 'Skins équipés (plateau, pions clairs, pions sombres).';
comment on table friend_requests is 'Demandes d''ami en attente / acceptées.';
comment on table users is 'Compte joueur : profil public, Elo, solde, état KYC.';
comment on column users.phone is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';
comment on column users.email is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';
comment on column users.first_name is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';
comment on column users.last_name is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';
comment on column users.birth_date is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';
comment on table friends is 'Relations d''amitié (deux lignes par paire, une par sens).';
comment on table games is 'Historique des parties terminées : camps, Elo avant/après, motif.';
comment on table game_sessions is 'Instantané sérialisé d''une partie en cours (reprise après redémarrage).';
comment on table kyc_cases is 'Dossiers d''identité (recto/verso/visage). DONNÉES PERSONNELLES SENSIBLES : chemins privés, jamais servis en statique.';
comment on column kyc_cases.recto_path is 'Secret — jamais renvoyé par l API.';
comment on column kyc_cases.verso_path is 'Secret — jamais renvoyé par l API.';
comment on column kyc_cases.face_path is 'Secret — jamais renvoyé par l API.';
comment on column kyc_cases.recto_sha is 'Secret — jamais renvoyé par l API.';
comment on column kyc_cases.verso_sha is 'Secret — jamais renvoyé par l API.';
comment on column kyc_cases.face_sha is 'Secret — jamais renvoyé par l API.';
comment on table notifications is 'Notifications persistantes d''un compte.';
comment on table pion_style is 'Apparence du pion par camp (couleur, motif, forme).';
comment on table sessions is 'Jetons de session opaques, stockés HACHÉS (jamais en clair). Remplacé par les JWT Supabase (lot L7).';
comment on column sessions.token_hash is 'Secret — jamais renvoyé par l API.';
comment on table tournament_matches is 'Bracket d''élimination directe : rounds, confirmations, forfaits.';
comment on table tournament_registrations is 'Inscriptions d''un joueur à un tournoi.';
comment on table user_sanctions is 'Sanctions appliquées à un compte (avertissement, suspension).';
comment on table user_skins is 'Skins possédés par un joueur.';
comment on table withdrawals is 'Demandes de retrait instruites par le back-office.';
comment on column withdrawals.phone is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';
comment on column withdrawals.phone is 'Secret — jamais renvoyé par l API.';

commit;
