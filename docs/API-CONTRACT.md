# Contrat d'API — D-aôna

> **Généré** par [scripts/gen-api-contract.js](../scripts/gen-api-contract.js) depuis
> [apps/api/server.js](../apps/api/server.js). Ne pas éditer à la main :
> `node scripts/gen-api-contract.js` puis commit. La colonne « Ligne » renvoie
> au code réel, qui reste la seule autorité sur les charges utiles.

Inventaire au 2026-11-24 : **43 routes REST** et **39 types de messages WebSocket**.

## 1. Règles générales

| Sujet | Règle |
|---|---|
| Base d'URL | `config.js` du frontend (`VITE_API_URL` au build). Vide = même origine. |
| Authentification | `Authorization: Bearer <jeton>` ; le WebSocket s'authentifie par un premier message `auth`. |
| Réponses | JSON, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *` (aucun cookie : le jeton ne fuit pas par un site tiers). |
| Erreurs | `{ error: "message lisible", code: "CODE_STABLE" }` + code HTTP. Le `code` est ce que l'interface teste ; le `error` est pour l'humain. |
| Débit | Authentification limitée par IP (`D_AONA_AUTH_RATE_MAX`, 12 par 300 s par défaut). **Sur un hébergeur, `D_AONA_TRUST_PROXY=1` est obligatoire**, sinon tous les joueurs partagent l'IP du proxy. |
| Origine WebSocket | Acceptée si même hôte, ou si déclarée dans `D_AONA_ALLOWED_ORIGINS`. Toute autre origine est fermée (1008). |
| Sonde | `GET /healthz` — sans authentification, sans base. Utilisée par l'hébergeur. |

## 2. Routes REST

La colonne « Auth » indique qu'un jeton est nécessaire. Les routes publiques sont
celles qui précèdent l'authentification (inscription, disponibilité, santé).

| Méthode | Chemin | Auth | Ligne |
|---|---|---|---|
| `OPTIONS` | `/api/*` | jeton | 2007 |
| `GET` | `/api/admin` | jeton | 346 |
| `GET` | `/api/admin/*` | jeton | 346 |
| `GET` | `/api/ads/active` | public | 313 |
| `POST` | `/api/auth` | public | 245 |
| `GET` | `/api/auth/available` | public | 287 |
| `POST` | `/api/auth/login` | public | 245 |
| `POST` | `/api/auth/logout` | jeton | 297 |
| `POST` | `/api/auth/password` | jeton | 368 |
| `POST` | `/api/auth/register` | public | 257 |
| `GET` | `/api/challenges` | jeton | 835 |
| `GET` | `/api/chat/*` | jeton | 669 |
| `GET` | `/api/chat/contacts` | jeton | 659 |
| `GET` | `/api/config` | public | 325 |
| `POST` | `/api/deposit` | jeton | 889 |
| `GET` | `/api/friends` | jeton | 677 |
| `POST` | `/api/friends` | jeton | 738 |
| `DELETE` | `/api/friends/*` | jeton | 753 |
| `POST` | `/api/friends/request` | jeton | 704 |
| `POST` | `/api/friends/respond` | jeton | 721 |
| `POST` | `/api/friends/seen` | jeton | 698 |
| `GET` | `/api/games/history` | jeton | 795 |
| `GET` | `/api/games/live` | public | 805 |
| `POST` | `/api/kyc/submit` | jeton | 873 |
| `POST` | `/api/kyc/verify` | jeton | 867 |
| `GET` | `/api/leaderboard` | public | 424 |
| `GET` | `/api/notifications` | jeton | 924 |
| `POST` | `/api/notifications/read-all` | jeton | 939 |
| `POST` | `/api/pion/style` | jeton | 532 |
| `GET` | `/api/skins` | jeton | 506 |
| `POST` | `/api/skins/buy` | jeton | 576 |
| `POST` | `/api/skins/equip` | jeton | 600 |
| `GET` | `/api/tournaments` | public | 387 |
| `POST` | `/api/tournaments/join` | jeton | 391 |
| `GET` | `/api/tournaments/my` | jeton | 947 |
| `GET` | `/api/transactions` | jeton | 625 |
| `GET` | `/api/transactions/export` | jeton | 640 |
| `GET` | `/api/user` | jeton | 380 |
| `POST` | `/api/user/avatar` | jeton | 428 |
| `POST` | `/api/user/profile` | jeton | 457 |
| `GET` | `/api/users/search` | jeton | 762 |
| `POST` | `/api/withdraw` | jeton | 908 |
| `OPTIONS` | `/healthz` | jeton | 1998 |

## 3. Messages WebSocket (`/ws`)

Une seule socket par joueur. Le premier message doit être `auth` ; les autres
sont mis en file d'attente côté client jusqu'à la confirmation.

### 3.1 Client → serveur

| Type | Rôle |
|---|---|
| `accept_challenge` | Accepte un défi reçu. |
| `accept_match` | Accepte l'adversaire proposé. |
| `auth` | Authentifie la socket (jeton Bearer). Réponse : `auth_ok` / refus. |
| `cancel_challenge` | Annule un défi envoyé. |
| `cancel_match` | Sort de la file. |
| `chat_message` | Message privé / de partie (limité à 20 par 10 s). |
| `end_chain` | Termine une chaîne de prises. |
| `find_match` | Entre en file d'appariement (plateau + format). |
| `move` | Joue un coup — le serveur est SEUL juge de sa légalité. |
| `pick_side` | Choisit le camp au tirage au sort. |
| `ping` | Maintien de connexion. |
| `reject_challenge` | Refuse un défi. |
| `resign` | Abandonne la partie en cours. |
| `send_challenge` | Défie un joueur (avec plateau, format, mise). |
| `spectate` | Observe une partie en direct. |
| `sync_game` | Demande la reprise de sa partie en cours. |
| `unspectate` | Quitte l'observation. |

### 3.2 Serveur → client

- `challenge_accepted`
- `challenge_received` — Un défi arrive.
- `challenge_sent`
- `challenge_status`
- `challenges_update`
- `chat_message`
- `error` — Erreur générique, avec `code`.
- `game_end` — Fin de partie : gagnant, motif, deltas d'Elo.
- `game_start` — Partie commencée (`game`, `playerNum`, `state`).
- `game_state` — État publié — SEUL émetteur d'état de partie.
- `leaderboard_update` — Le classement a changé (inscription, fin de partie).
- `live_update`
- `match_cancelled`
- `match_found` — Adversaire trouvé.
- `match_status`
- `matchmaking`
- `no_active_game` — Aucune partie à reprendre.
- `notification` — Notification persistante.
- `pong`
- `spectate_end`
- `spectate_state` — État pour un spectateur.
- `tournament_update`

## 4. Codes d'erreur métier (stables)

Relevés dans le code : `INSCRIPTIONS_FERMEES`, `ACCES_REFUSE`, `MEME_IMAGE`,
`CONTENU_INVALIDE`, `TROP_DE_SOUMISSIONS`, `LITIGE_OUVERT`, `SELF_APPROVAL`,
`KYC_REQUIS`, `SOLDE_INSUFFISANT`. L'interface teste le `code`, jamais le texte.

## 5. Garantie de non-dérive

`node scripts/gen-api-contract.js --check` échoue si ce document ne correspond
plus au code (route ajoutée, supprimée ou méthode changée). À brancher en CI :
un contrat qui ne peut pas mentir est un contrat utile.
