-- =========================================================
-- D-aôna — Row Level Security : REFUS PAR DÉFAUT
-- ---------------------------------------------------------
-- GÉNÉRÉ par scripts/gen-db-model.js.
--
-- Principe : le navigateur ne parle JAMAIS à Postgres. Il parle à l API
-- (apps/api), qui utilise une connexion `pg` avec un rôle serveur.
-- La clé `anon` de Supabase est néanmoins publique (elle voyage dans le
-- bundle du frontend pour Supabase Auth) : sans RLS, cette clé suffirait
-- à lire TOUTES les tables. D'où ce verrou : aucune politique = aucun
-- accès pour anon/authenticated, quel que soit le GRANT.
-- =========================================================

alter table admin_games enable row level security;
alter table admin_games force row level security;
alter table admin_modules enable row level security;
alter table admin_modules force row level security;
alter table admin_roles enable row level security;
alter table admin_roles force row level security;
alter table admin_grants enable row level security;
alter table admin_grants force row level security;
alter table ads enable row level security;
alter table ads force row level security;
alter table auth_audit_log enable row level security;
alter table auth_audit_log force row level security;
alter table badges enable row level security;
alter table badges force row level security;
alter table platform_settings enable row level security;
alter table platform_settings force row level security;
alter table tournaments enable row level security;
alter table tournaments force row level security;
alter table transactions enable row level security;
alter table transactions force row level security;
alter table admin_assignments enable row level security;
alter table admin_assignments force row level security;
alter table admin_audit enable row level security;
alter table admin_audit force row level security;
alter table auth_credentials enable row level security;
alter table auth_credentials force row level security;
alter table challenges enable row level security;
alter table challenges force row level security;
alter table chat_messages enable row level security;
alter table chat_messages force row level security;
alter table disputes enable row level security;
alter table disputes force row level security;
alter table equipped_skins enable row level security;
alter table equipped_skins force row level security;
alter table friend_requests enable row level security;
alter table friend_requests force row level security;
alter table users enable row level security;
alter table users force row level security;
alter table friends enable row level security;
alter table friends force row level security;
alter table games enable row level security;
alter table games force row level security;
alter table game_sessions enable row level security;
alter table game_sessions force row level security;
alter table kyc_cases enable row level security;
alter table kyc_cases force row level security;
alter table notifications enable row level security;
alter table notifications force row level security;
alter table pion_style enable row level security;
alter table pion_style force row level security;
alter table sessions enable row level security;
alter table sessions force row level security;
alter table tournament_matches enable row level security;
alter table tournament_matches force row level security;
alter table tournament_registrations enable row level security;
alter table tournament_registrations force row level security;
alter table user_sanctions enable row level security;
alter table user_sanctions force row level security;
alter table user_skins enable row level security;
alter table user_skins force row level security;
alter table withdrawals enable row level security;
alter table withdrawals force row level security;

-- Aucune politique n'est créée volontairement. Le jour où une table doit
-- être lue directement par le navigateur (temps réel Supabase, par
-- exemple), ajouter UNE politique ciblée ici — jamais un `using (true)`.
