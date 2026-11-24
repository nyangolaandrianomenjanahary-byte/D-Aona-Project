# Modèle de données — D-aôna

> **Généré** par [scripts/gen-db-model.js](../scripts/gen-db-model.js) depuis la base SQLite
> réelle. Ne pas éditer à la main : corriger le générateur, puis régénérer.
> Schéma cible : Postgres / Supabase — [supabase/migrations/0001_initial.sql](../supabase/migrations/0001_initial.sql).

## 1. Vue d'ensemble

| Mesure | Valeur |
|---|---|
| Tables applicatives | 31 |
| Colonnes | 278 |
| Clés étrangères | 45 |
| Index déclarés | 40 |
| Lignes (base actuelle) | 4096 |

## 2. Domaines

| Domaine | Tables |
|---|---|
| **Identité & accès** | `users` · `auth_credentials` · `sessions` · `auth_audit_log` |
| **Administration** | `admin_roles` · `admin_assignments` · `admin_grants` · `admin_modules` · `admin_games` · `admin_audit` · `platform_settings` · `user_sanctions` |
| **Jeu** | `games` · `game_sessions` · `challenges` |
| **Tournois** | `tournaments` · `tournament_matches` · `tournament_registrations` |
| **Social** | `chat_messages` · `friends` · `friend_requests` · `notifications` |
| **Contenu** | `ads` |
| **Classement** | `badges` |
| **Personnalisation** | `user_skins` · `equipped_skins` · `pion_style` |
| **Économie** | `transactions` · `withdrawals` · `disputes` |
| **Conformité** | `kyc_cases` |

## 3. Correspondance des types SQLite → Postgres

| Source SQLite | Cible Postgres | Règle |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigint generated always as identity` | conserve les identifiants existants à l'import |
| `INTEGER` | `bigint` | les identifiants restent des entiers : les 452 appels SQL ne changent pas de forme |
| `INTEGER` 0/1 (drapeau) | `boolean` | 13 colonnes listées dans le générateur ; l'import convertit 0/1 |
| `TEXT` horodatage | `timestamptz` | l'import parse ISO 8601 et `YYYY-MM-DD HH:MM:SS` |
| `TEXT DEFAULT (datetime('now'))` | `timestamptz default now()` | — |
| `TEXT` montant | `integer` | **ariary** : pas de sous-unité, jamais de flottant |
| `TEXT` JSON (`*_json`) | `text` | conservé tel quel : le code sérialise et désérialise lui-même |
| `TEXT` chemin de fichier | `text` | remplacé par une URL Supabase Storage (lot L6) |

## 4. Dictionnaire des tables

### Identité & accès

#### `auth_audit_log` — 2064 ligne(s)

Journal d'authentification : connexions, échecs, révocations.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `at` | `timestamptz` | non | `now()` | — |
| `event` | `text` | non | — | — |
| `user_id` | `bigint` | oui | — | — |
| `pseudo` | `text` | oui | — | — |
| `session_id` | `text` | oui | — | — |
| `ip` | `text` | oui | — | — |
| `user_agent` | `text` | oui | — | — |
| `detail` | `text` | oui | — | — |

**Clé primaire** : `id`

**Index** :
- `idx_authaudit_event` sur (event, at)
- `idx_authaudit_user` sur (user_id, at)
- `idx_authaudit_at` sur (at)

#### `auth_credentials` — 23 ligne(s)

Empreinte Argon2id, verrouillage progressif par échecs. Remplacé par Supabase Auth (lot L7).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `user_id` | `bigint` | oui | — | PK · FK → `users.id` |
| `password_hash` | `text` | non | — | **secret** |
| `algo` | `text` | non | `'argon2id'` | — |
| `password_changed_at` | `timestamptz` | non | `now()` | — |
| `failed_attempts` | `bigint` | non | `0` | — |
| `last_failed_at` | `timestamptz` | oui | — | — |
| `locked_until` | `timestamptz` | oui | — | — |
| `created_at` | `timestamptz` | non | `now()` | — |
| `updated_at` | `timestamptz` | non | `now()` | — |

**Clé primaire** : `user_id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_authcreds_locked` sur (locked_until)

#### `users` — 23 ligne(s)

Compte joueur : profil public, Elo, solde, état KYC.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `pseudo` | `text` | non | — | — |
| `password_hash` | `text` | oui | — | — |
| `phone` | `text` | oui | — | **donnée personnelle** |
| `email` | `text` | oui | — | **donnée personnelle** |
| `elo` | `bigint` | oui | `1100` | — |
| `wins` | `bigint` | oui | `0` | — |
| `losses` | `bigint` | oui | `0` | — |
| `balance` | `bigint` | oui | `0` | — |
| `bonus_lock` | `boolean` | oui | `false` | — |
| `kyc` | `boolean` | oui | `false` | — |
| `bonus_used` | `boolean` | oui | `false` | — |
| `withdrawn_today` | `bigint` | oui | `0` | — |
| `last_seen` | `timestamptz` | oui | — | — |
| `created_at` | `timestamptz` | oui | `now()` | — |
| `province` | `text` | oui | `'Antananarivo'` | — |
| `last_decay` | `timestamptz` | oui | — | — |
| `avatar` | `text` | oui | — | — |
| `region` | `text` | oui | — | — |
| `friends_seen_request_id` | `bigint` | oui | — | FK → `friend_requests.id` |
| `first_name` | `text` | oui | — | **donnée personnelle** |
| `last_name` | `text` | oui | — | **donnée personnelle** |
| `birth_date` | `date` | oui | — | **donnée personnelle** |
| `bio` | `text` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `friends_seen_request_id` → `friend_requests.id` — `on delete SET NULL`

**Index** :
- `idx_users_email_unique` sur (email) — unique
- `idx_users_phone_unique` sur (phone) — unique
- `sqlite_autoindex_users_1` sur (pseudo) — unique

#### `sessions` — 135 ligne(s)

Jetons de session opaques, stockés HACHÉS (jamais en clair). Remplacé par les JWT Supabase (lot L7).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `text` | oui | — | PK |
| `user_id` | `bigint` | non | — | FK → `users.id` |
| `token_hash` | `text` | non | — | **secret** |
| `created_at` | `timestamptz` | non | `now()` | — |
| `last_used_at` | `timestamptz` | oui | — | — |
| `expires_at` | `timestamptz` | non | — | — |
| `revoked_at` | `timestamptz` | oui | — | — |
| `revoked_reason` | `text` | oui | — | — |
| `user_agent` | `text` | oui | — | — |
| `ip` | `text` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_sessions_expires` sur (expires_at)
- `idx_sessions_user` sur (user_id)
- `sqlite_autoindex_sessions_2` sur (token_hash) — unique

### Administration

#### `admin_games` — 6 ligne(s)

Fiche des plateaux exposés par l'administration.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `slug` | `text` | oui | — | PK |
| `name` | `text` | non | — | — |
| `variant` | `text` | oui | — | — |
| `status` | `text` | non | `'draft'` | — |
| `duration` | `bigint` | non | `30` | — |
| `ranked` | `boolean` | non | `true` | — |
| `min_elo` | `bigint` | non | `0` | — |
| `rules` | `text` | oui | — | — |
| `version` | `bigint` | non | `1` | — |
| `created_at` | `timestamptz` | non | `now()` | — |
| `updated_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `slug`

**Index** :
- `idx_admin_games_status` sur (status, name)

#### `admin_modules` — 15 ligne(s)

Modules du back-office et leur interrupteur global.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `text` | oui | — | PK |
| `enabled` | `boolean` | non | `true` | — |
| `updated_at` | `timestamptz` | oui | — | — |
| `core` | `boolean` | non | `false` | — |

**Clé primaire** : `id`

#### `admin_roles` — 7 ligne(s)

Rôles d'administration (super_admin, admin, observer…).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `text` | oui | — | PK |
| `label` | `text` | non | — | — |
| `description` | `text` | oui | — | — |
| `protected` | `boolean` | non | `false` | — |

**Clé primaire** : `id`

#### `admin_grants` — 630 ligne(s)

Matrice rôle × module × action (le droit effectif).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `role_id` | `text` | non | — | PK · FK → `admin_roles.id` |
| `module` | `text` | non | — | PK · FK → `admin_modules.id` |
| `action` | `text` | non | — | PK |
| `allowed` | `boolean` | non | `false` | — |

**Clé primaire** : `role_id`, `module`, `action`

**Clés étrangères** :
- `role_id` → `admin_roles.id` — `on delete CASCADE`
- `module` → `admin_modules.id` — `on delete CASCADE`

**Index** :
- `idx_admin_grants_role` sur (role_id, module)

#### `platform_settings` — 7 ligne(s)

Réglages globaux clé/valeur (inscriptions ouvertes, etc.).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `key` | `text` | oui | — | PK |
| `value` | `text` | non | — | — |
| `updated_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `key`

#### `admin_assignments` — 2 ligne(s)

Qui détient quel rôle, et depuis quand.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `user_id` | `bigint` | non | — | PK · FK → `users.id` |
| `role_id` | `text` | non | — | PK · FK → `admin_roles.id` |
| `granted_by` | `bigint` | oui | — | FK → `users.id` |
| `granted_at` | `timestamptz` | non | `now()` | — |

**Clé primaire** : `user_id`, `role_id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`
- `role_id` → `admin_roles.id` — `on delete CASCADE`
- `granted_by` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_admin_assignments_role` sur (role_id)

#### `admin_audit` — 55 ligne(s)

Journal des actions sensibles du back-office.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `at` | `timestamptz` | non | `now()` | — |
| `actor_id` | `bigint` | oui | — | FK → `users.id` |
| `actor_pseudo` | `text` | oui | — | — |
| `action` | `text` | non | — | — |
| `target` | `text` | oui | — | — |
| `detail_json` | `text` | oui | — | — |
| `ip` | `text` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `actor_id` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_admin_audit_actor` sur (actor_id)
- `idx_admin_audit_at` sur (at)

#### `user_sanctions` — 2 ligne(s)

Sanctions appliquées à un compte (avertissement, suspension).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `user_id` | `bigint` | non | — | FK → `users.id` |
| `kind` | `text` | non | — | — |
| `reason` | `text` | oui | — | — |
| `actor_id` | `bigint` | oui | — | FK → `users.id` |
| `created_at` | `timestamptz` | non | `now()` | — |
| `lifted_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`
- `actor_id` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_sanctions_kind` sur (kind, created_at)
- `idx_sanctions_user` sur (user_id, id)

### Jeu

#### `challenges` — 22 ligne(s)

Défi d'un joueur à un autre, avec mise et échéance.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `text` | oui | — | PK |
| `from_id` | `bigint` | non | — | FK → `users.id` |
| `to_id` | `bigint` | non | — | FK → `users.id` |
| `wager` | `bigint` | oui | `0` | — |
| `format` | `text` | oui | — | — |
| `status` | `text` | oui | `'pending'` | — |
| `created_at` | `timestamptz` | oui | `now()` | — |
| `expires_at` | `timestamptz` | oui | — | — |
| `game` | `text` | non | `'fanoron-tsivy'` | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `from_id` → `users.id` — `on delete CASCADE`
- `to_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_challenges_from` sur (from_id)
- `idx_challenges_to` sur (to_id)
- `idx_challenges_status_expires` sur (status, expires_at)

#### `games` — 603 ligne(s)

Historique des parties terminées : camps, Elo avant/après, motif.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `player1_id` | `bigint` | non | — | FK → `users.id` |
| `player2_id` | `bigint` | non | — | FK → `users.id` |
| `winner_id` | `bigint` | oui | — | FK → `users.id` |
| `delta1` | `bigint` | oui | — | — |
| `delta2` | `bigint` | oui | — | — |
| `mode` | `text` | oui | — | — |
| `format` | `text` | oui | — | — |
| `wager` | `bigint` | oui | `0` | — |
| `moves_json` | `text` | oui | — | — |
| `reason` | `text` | oui | — | — |
| `created_at` | `timestamptz` | oui | `now()` | — |
| `elo1_before` | `bigint` | oui | — | — |
| `elo1_after` | `bigint` | oui | — | — |
| `elo2_before` | `bigint` | oui | — | — |
| `elo2_after` | `bigint` | oui | — | — |
| `game` | `text` | non | `'fanoron-tsivy'` | — |
| `status` | `text` | non | `'finished'` | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `player1_id` → `users.id` — `on delete NO ACTION`
- `player2_id` → `users.id` — `on delete NO ACTION`
- `winner_id` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_games_p2_created` sur (player2_id, created_at)
- `idx_games_p1_created` sur (player1_id, created_at)

#### `game_sessions` — 3 ligne(s)

Instantané sérialisé d'une partie en cours (reprise après redémarrage).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `text` | oui | — | PK |
| `player1_id` | `bigint` | non | — | FK → `users.id` |
| `player2_id` | `bigint` | non | — | FK → `users.id` |
| `mode` | `text` | oui | — | — |
| `format` | `text` | oui | — | — |
| `wager` | `bigint` | oui | `0` | — |
| `state_json` | `text` | non | — | — |
| `winner_id` | `bigint` | oui | — | FK → `users.id` |
| `moves_json` | `text` | oui | — | — |
| `status` | `text` | oui | `'playing'` | — |
| `created_at` | `timestamptz` | oui | `now()` | — |
| `updated_at` | `timestamptz` | oui | `now()` | — |
| `game` | `text` | oui | — | — |
| `game_record_id` | `bigint` | oui | — | FK → `games.id` |

**Clé primaire** : `id`

**Clés étrangères** :
- `player1_id` → `users.id` — `on delete CASCADE`
- `player2_id` → `users.id` — `on delete CASCADE`
- `winner_id` → `users.id` — `on delete SET NULL`
- `game_record_id` → `games.id` — `on delete SET NULL`

### Tournois

#### `tournaments` — 8 ligne(s)

Tournoi : format, droits d'entrée, horaires de matchs.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `name` | `text` | non | — | — |
| `game` | `text` | oui | — | — |
| `format` | `text` | oui | — | — |
| `entry` | `bigint` | oui | — | — |
| `max_players` | `bigint` | oui | `8` | — |
| `status` | `text` | oui | `'inscriptions'` | — |
| `min_rank` | `text` | oui | `'Bronze'` | — |
| `sponsor` | `text` | oui | — | — |
| `starts_at` | `timestamptz` | oui | — | — |
| `results_json` | `text` | oui | — | — |
| `created_at` | `timestamptz` | oui | `now()` | — |
| `match_duration_min` | `bigint` | oui | `5` | — |
| `interval_min` | `bigint` | oui | `5` | — |

**Clé primaire** : `id`

#### `tournament_matches` — 14 ligne(s)

Bracket d'élimination directe : rounds, confirmations, forfaits.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `tournament_id` | `bigint` | non | — | FK → `tournaments.id` |
| `round` | `bigint` | non | — | — |
| `slot` | `bigint` | non | — | — |
| `p1_id` | `bigint` | oui | — | FK → `users.id` |
| `p2_id` | `bigint` | oui | — | FK → `users.id` |
| `score1` | `bigint` | oui | — | — |
| `score2` | `bigint` | oui | — | — |
| `winner_id` | `bigint` | oui | — | FK → `users.id` |
| `status` | `text` | oui | `'a_venir'` | — |
| `starts_at` | `timestamptz` | oui | — | — |
| `confirm_deadline` | `timestamptz` | oui | — | — |
| `confirmed_p1` | `boolean` | oui | `false` | — |
| `confirmed_p2` | `boolean` | oui | `false` | — |
| `next_match_id` | `bigint` | oui | — | FK → `tournament_matches.id` |
| `created_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `tournament_id` → `tournaments.id` — `on delete CASCADE`
- `p1_id` → `users.id` — `on delete SET NULL`
- `p2_id` → `users.id` — `on delete SET NULL`
- `winner_id` → `users.id` — `on delete SET NULL`
- `next_match_id` → `tournament_matches.id` — `on delete SET NULL`

**Index** :
- `idx_tm_tournament` sur (tournament_id, round, slot)
- `sqlite_autoindex_tournament_matches_1` sur (tournament_id, round, slot) — unique

#### `tournament_registrations` — 13 ligne(s)

Inscriptions d'un joueur à un tournoi.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `tournament_id` | `bigint` | non | — | PK · FK → `tournaments.id` |
| `user_id` | `bigint` | non | — | PK · FK → `users.id` |
| `registered_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `tournament_id`, `user_id`

**Clés étrangères** :
- `tournament_id` → `tournaments.id` — `on delete CASCADE`
- `user_id` → `users.id` — `on delete CASCADE`

### Social

#### `chat_messages` — 62 ligne(s)

Messages privés entre deux joueurs.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `from_user_id` | `bigint` | non | — | FK → `users.id` |
| `to_user_id` | `bigint` | non | — | FK → `users.id` |
| `text` | `text` | oui | — | — |
| `created_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `from_user_id` → `users.id` — `on delete CASCADE`
- `to_user_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_chat_to_from` sur (to_user_id, from_user_id, created_at)
- `idx_chat_users` sur (from_user_id, to_user_id)

#### `friend_requests` — 8 ligne(s)

Demandes d'ami en attente / acceptées.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `from_id` | `bigint` | non | — | FK → `users.id` |
| `to_id` | `bigint` | non | — | FK → `users.id` |
| `status` | `text` | oui | `'pending'` | — |
| `created_at` | `timestamptz` | oui | `now()` | — |
| `responded_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `from_id` → `users.id` — `on delete CASCADE`
- `to_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_freq_to` sur (to_id, status)
- `sqlite_autoindex_friend_requests_1` sur (from_id, to_id) — unique

#### `friends` — 37 ligne(s)

Relations d'amitié (deux lignes par paire, une par sens).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `user_id` | `bigint` | non | — | PK · FK → `users.id` |
| `friend_id` | `bigint` | non | — | PK · FK → `users.id` |
| `created_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `user_id`, `friend_id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`
- `friend_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_friends_user` sur (user_id)

#### `notifications` — 43 ligne(s)

Notifications persistantes d'un compte.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `user_id` | `bigint` | non | — | FK → `users.id` |
| `type` | `text` | non | — | — |
| `payload_json` | `text` | oui | — | — |
| `read` | `boolean` | oui | `false` | — |
| `created_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`

**Index** :
- `idx_notif_user` sur (user_id, read, created_at)

### Contenu

#### `ads` — 2 ligne(s)

Bannières publicitaires du carrousel (actif, période, ordre).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `slug` | `text` | non | — | — |
| `titre` | `text` | non | — | — |
| `image` | `text` | non | — | — |
| `repli` | `text` | oui | — | — |
| `lien` | `text` | oui | — | — |
| `debut` | `timestamptz` | oui | — | — |
| `fin` | `timestamptz` | oui | — | — |
| `position` | `text` | non | `'accueil'` | — |
| `actif` | `boolean` | non | `true` | — |
| `ordre` | `bigint` | non | `0` | — |
| `created_at` | `timestamptz` | non | `now()` | — |
| `updated_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `id`

**Index** :
- `idx_ads_position` sur (position, actif, ordre)
- `sqlite_autoindex_ads_1` sur (slug) — unique

### Classement

#### `badges` — 6 ligne(s)

Paliers de classement (nom, icône, rang min/max).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `name` | `text` | oui | — | PK |
| `icon` | `text` | oui | — | — |
| `color` | `text` | oui | — | — |
| `ink` | `text` | oui | — | — |
| `min_rank` | `bigint` | non | — | — |
| `max_rank` | `bigint` | oui | — | — |

**Clé primaire** : `name`

**Index** :
- `idx_badges_range` sur (min_rank, max_rank) — unique

### Personnalisation

#### `equipped_skins` — 23 ligne(s)

Skins équipés (plateau, pions clairs, pions sombres).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `user_id` | `bigint` | oui | — | PK · FK → `users.id` |
| `pions_light` | `text` | oui | — | — |
| `pions_dark` | `text` | oui | — | — |
| `plateau` | `text` | oui | — | — |
| `effet` | `text` | oui | — | — |

**Clé primaire** : `user_id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`

#### `pion_style` — 46 ligne(s)

Apparence du pion par camp (couleur, motif, forme).

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `user_id` | `bigint` | non | — | PK · FK → `users.id` |
| `camp` | `text` | non | — | PK |
| `color` | `text` | non | — | — |
| `pattern` | `text` | non | `'aucun'` | — |
| `shape` | `text` | non | `'ronde'` | — |

**Clé primaire** : `user_id`, `camp`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`

#### `user_skins` — 51 ligne(s)

Skins possédés par un joueur.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `user_id` | `bigint` | non | — | PK · FK → `users.id` |
| `skin_id` | `text` | non | — | PK |
| `acquired_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `user_id`, `skin_id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`

### Économie

#### `transactions` — 183 ligne(s)

Grand livre du portefeuille : chaque mouvement d'ariary, avec son état.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `user_id` | `bigint` | non | — | — |
| `dir` | `text` | oui | — | — |
| `label` | `text` | oui | — | — |
| `amount` | `bigint` | oui | — | **secret** |
| `status` | `text` | oui | — | — |
| `ref_id` | `text` | oui | — | — |
| `created_at` | `timestamptz` | oui | `now()` | — |

**Clé primaire** : `id`

#### `disputes` — 0 ligne(s)

Litiges ouverts sur une partie, avec issue et résolution.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `match_id` | `bigint` | non | — | FK → `games.id` |
| `user_id` | `bigint` | oui | — | FK → `users.id` |
| `category` | `text` | non | — | — |
| `reason` | `text` | non | — | — |
| `status` | `text` | non | `'open'` | — |
| `outcome` | `text` | oui | — | — |
| `resolution` | `text` | oui | — | — |
| `created_at` | `timestamptz` | non | `now()` | — |
| `resolved_by` | `bigint` | oui | — | FK → `users.id` |
| `resolved_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `match_id` → `games.id` — `on delete CASCADE`
- `user_id` → `users.id` — `on delete SET NULL`
- `resolved_by` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_disputes_match` sur (match_id)
- `idx_disputes_status` sur (status, created_at)

#### `withdrawals` — 0 ligne(s)

Demandes de retrait instruites par le back-office.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `user_id` | `bigint` | non | — | FK → `users.id` |
| `amount` | `bigint` | non | — | — |
| `method` | `text` | non | — | — |
| `phone` | `text` | oui | — | **secret** · **donnée personnelle** |
| `status` | `text` | non | `'pending'` | — |
| `reference` | `text` | oui | — | — |
| `reason` | `text` | oui | — | — |
| `created_at` | `timestamptz` | non | `now()` | — |
| `reviewed_by` | `bigint` | oui | — | FK → `users.id` |
| `reviewed_at` | `timestamptz` | oui | — | — |
| `paid_by` | `bigint` | oui | — | FK → `users.id` |
| `paid_at` | `timestamptz` | oui | — | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete NO ACTION`
- `reviewed_by` → `users.id` — `on delete SET NULL`
- `paid_by` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_withdrawals_user` sur (user_id, status)
- `idx_withdrawals_status` sur (status, created_at)

### Conformité

#### `kyc_cases` — 3 ligne(s)

Dossiers d'identité (recto/verso/visage). DONNÉES PERSONNELLES SENSIBLES : chemins privés, jamais servis en statique.

| Colonne | Type Postgres | Null | Défaut | Rôle |
|---|---|---|---|---|
| `id` | `bigint` | oui | — | PK |
| `user_id` | `bigint` | non | — | FK → `users.id` |
| `status` | `text` | non | `'pending'` | — |
| `recto_path` | `text` | non | — | **secret** |
| `verso_path` | `text` | non | — | **secret** |
| `recto_sha` | `text` | non | — | **secret** |
| `verso_sha` | `text` | non | — | **secret** |
| `mime_recto` | `text` | non | — | — |
| `mime_verso` | `text` | non | — | — |
| `bytes_recto` | `bigint` | non | — | — |
| `bytes_verso` | `bigint` | non | — | — |
| `reason` | `text` | oui | — | — |
| `submitted_at` | `timestamptz` | non | `now()` | — |
| `reviewed_at` | `timestamptz` | oui | — | — |
| `reviewer_id` | `bigint` | oui | — | FK → `users.id` |
| `face_path` | `text` | oui | — | **secret** |
| `face_mime` | `text` | oui | — | — |
| `face_bytes` | `bigint` | oui | — | — |
| `face_sha` | `text` | oui | — | **secret** |
| `face_captured_at` | `timestamptz` | oui | — | — |
| `face_consent_at` | `timestamptz` | oui | — | — |
| `retention_until` | `timestamptz` | oui | — | — |
| `face_required` | `boolean` | non | `false` | — |

**Clé primaire** : `id`

**Clés étrangères** :
- `user_id` → `users.id` — `on delete CASCADE`
- `reviewer_id` → `users.id` — `on delete SET NULL`

**Index** :
- `idx_kyc_one_pending` sur (user_id) — unique
- `idx_kyc_status` sur (status, submitted_at)
- `idx_kyc_user` sur (user_id, submitted_at)

## 5. Règles de sécurité portées par la base

- **RLS activée et forcée sur les 31 tables, sans aucune politique** :
  le navigateur ne lit jamais Postgres. Seule l'API écrit, avec un rôle serveur.
- **Secrets** : `auth_credentials.password_hash`, `sessions.token_hash` — jamais renvoyés par l'API.
- **Données personnelles** : email, téléphone, nom, date de naissance, chemins KYC — accès restreint,
  aucune lecture publique, aucune écriture dans les journaux.
- **Argent** : montants en ariary entiers ; la somme du grand livre doit égaler le solde
  (vérifié par `scripts/verify-parity.js`).

## 6. Relations écartées (données orphelines)

Aucune : les 45 relations déclarées sont vérifiées sans orphelin.

## 7. Ce qui reste à faire sur la base (hors périmètre de ce document)

1. **Import des données** : `scripts/migrate-sqlite-to-pg.js` (ordre des tables, séquences, conversion 0/1).
2. **Parité** : `scripts/verify-parity.js` compare comptes, sommes et contraintes entre les deux bases.
3. **Adapter les appels SQL** : passage synchrone → asynchrone (lot L4), puis bascule de `D_AONA_DB`.
4. **Auth Supabase** : `auth_credentials` et `sessions` deviennent inutiles une fois les JWT en place (lot L7).
