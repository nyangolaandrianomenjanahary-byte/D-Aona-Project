# 📘 D-aôna — Contexte & Journal du Projet

> **⚠️ RÈGLE À SUIVRE (pour l'assistant IA) :**
> Au début de chaque session de travail, **lire ce fichier en intégralité** pour retrouver
> tout le contexte (structure, commandes, journal) en un seul read → économie de tokens.
> Après chaque modification du code, **mettre à jour le journal** (script `update_log.js`
> ou ligne manuelle). **Ne jamais consigner ni lire ici de données clients** (base SQLite,
> comptes, transactions, etc.).

---

## 1. Vue d'ensemble

**D-aôna** : plateforme compétitive de jeux traditionnels malgaches en ligne — MVP =
**Fanorona** (plateau 9×5, captures par approche/retrait, capture obligatoire, IA).

- **Frontend** : SPA HTML/CSS/JS *vanilla* (aucun build, aucune dépendance).
- **Backend** : serveur **Node.js** (`commonjs`) HTTP + **WebSocket** (`ws`) + **SQLite** embarquée (`node:sqlite`).
- **Multijoueur** : matchmaking, défis, tournois, chat, skins, wallet (simulé), **mode spectateur** (live).
- **Réseau** : le PC sert d'hôte (WiFi / hotspot / Bluetooth / tunnel public Cloudflare `trycloudflare`).
- **🧠 Graphe de connaissances** : **graphify** (package `graphifyy`, v0.9.48) indexe le code dans
  `graphify-out/graph.json` (AST local, sans LLM). Skill agent installé + `AGENTS.md` à la racine
  + hooks git post-commit/post-checkout (mise à jour auto du graphe).

> **🤖 RÈGLE POUR L'IA (nouvelle session) :** ce projet est indexé par graphify.
> Pour toute question sur le code, utilise **d'abord** le graphe (plus rapide, moins de tokens) :
> - `py -m graphify query "<question>"` → sous-graphe ciblé
> - `py -m graphify explain "<symbole>"` → explication d'une fonction/classe + voisins
> - `py -m graphify path "<A>" "<B>"` → lien entre deux éléments
> - `py -m graphify god-nodes` → hubs architecturaux
> - Après toute modification de code : `py -m graphify update .` (AST only, gratuit)
> Ces commandes tournent via `py -m graphify` (Python 3.12, launcher `py`).

---

## 2. Arborescence fonctionnelle (liens cliquables)

### Racine `Root/`
| Fichier | Rôle |
|---|---|
| [CONTEXTE_PROJET.md](CONTEXTE_PROJET.md) | 📘 Ce document (contexte + journal) |
| [GUIDE_LIEN_REMOTE.md](GUIDE_LIEN_REMOTE.md) | Guide jouer à distance (liens, hotspot, tunnel) |
| [update_log.js](update_log.js) | Moteur de mise à jour automatique du journal |
| [maj_state.json](maj_state.json) | État de référence du dernier scan (généré) |
| [maj_journal.bat](maj_journal.bat) | Lancement manuel de la mise à jour |
| [skills-lock.json](skills-lock.json) | Verrou des skills d'agent |

### Backend `d-aona-server/`
| Fichier | Rôle |
|---|---|
| [server.js](d-aona-server/server.js) | 🧠 **Cœur** : API REST, WebSocket, matchmaking, moteur tournoi (bracket, confirmations, forfaits auto), notifications |
| [db.js](d-aona-server/db.js) | Couche SQLite : schéma + accès (users, games, tournois, wallet, notifications, bracket…) — applique aussi les migrations versionnées au démarrage |
| [auth.js](d-aona-server/auth.js) | 🔐 **Authentification** : Argon2id, sessions opaques révocables, verrouillage progressif, limitation de débit, journal d'audit |
| [migrate.js](d-aona-server/migrate.js) | Exécuteur de migrations versionnées (`node migrate.js --status`) |
| [migrations/](d-aona-server/migrations) | Migrations SQL versionnées (`001_auth_credentials`, `002_sessions`, `003_auth_audit`) |
| [backup_db.js](d-aona-server/backup_db.js) | Sauvegarde **vérifiée** de la base + `uploads/` (manifeste SHA-256, `integrity_check`) |
| [test_auth.js](d-aona-server/test_auth.js) | Tests d'authentification (instances jetables sur le port 8099) |
| [reset_password.js](d-aona-server/reset_password.js) | Réinitialisation d'un mot de passe (outil console exploitant) |
| [SECURITE_AUTH.md](d-aona-server/SECURITE_AUTH.md) | 🔐 Documentation sécurité : défaut corrigé, décisions, risques résiduels, opérations |
| [.env.example](d-aona-server/.env.example) | Variables d'environnement documentées (modèle, non chargé automatiquement) |
| [game.js](d-aona-server/game.js) | Moteur de partie Fanorona côté serveur (règles, captures, Elo) |
| [data.js](d-aona-server/data.js) | Données / constantes de référence |
| [check_db.js](d-aona-server/check_db.js) | Vérifier l'état des tables de la base |
| [diag.js](d-aona-server/diag.js) | Diagnostic réseau |
| [package.json](d-aona-server/package.json) | Dépendances (`ws`) |
| [DEMARRER.bat](d-aona-server/DEMARRER.bat) | Demarrage simple |
| [LIEN_REMOTE.bat](d-aona-server/LIEN_REMOTE.bat) | Serveur + pare-feu + tunnel Cloudflare (jeu à distance) |
| [HOTSPOT.bat](d-aona-server/HOTSPOT.bat) / [HOTSPOT.ps1](d-aona-server/HOTSPOT.ps1) | Activer le hotspot WiFi |
| [CONFIGURER.bat](d-aona-server/CONFIGURER.bat) / [setup_firewall.ps1](d-aona-server/setup_firewall.ps1) | Config pare-feu (port 8080) |
| `d-aona.db` | ⛔ Base SQLite (données → **exclue** du journal) |

### Frontend `D-aona/d-aona-web/` (PRD v1.2 — mono-fichier)
| Fichier | Rôle |
|---|---|
| [index.html](D-aona/d-aona-web/index.html) | Application complète : design system (thèmes Jour/Nuit OLED), moteur Fanorona, client API/WebSocket, toutes les vues |
| [README.md](D-aona/d-aona-web/README.md) | Doc frontend (cartographie PRD) |
| [assets/board/](D-aona/d-aona-web/assets/board/) | Image du plateau de Fanorona |

### 📂 Dossiers exclus du suivi
`node_modules/`, `.git/`, `.claude/`, `.agents/` (copies de skills), `graphify-out/` (graphe généré), `*.log`, `*.db`, `cloudflared.exe` (retéléchargé par `LIEN_REMOTE.bat`), `maj_state.json`.

---

## 3. Commandes de référence

| Action | Commande |
|---|---|
| Démarrer le serveur (hôte) | `d-aona-server\DEMARRER.bat` |
| Jeu à distance (tunnel public) | `d-aona-server\LIEN_REMOTE.bat` |
| Activer le hotspot | `d-aona-server\HOTSPOT.bat` |
| Vérifier la base | `node d-aona-server\check_db.js` |
| **Sauvegarder la base (vérifiée)** | `node d-aona-server\backup_db.js` |
| **État / application des migrations** | `node d-aona-server\migrate.js --status` puis `node migrate.js` |
| **Tests d'authentification** | `node d-aona-server\test_auth.js` |
| **Réinitialiser un mot de passe** | `node d-aona-server\reset_password.js <pseudo> "<motDePasse>"` |
| Diagnostic réseau | `node d-aona-server\diag.js` |
| Mise à jour manuelle du journal | `maj_journal.bat` (ou `node update_log.js`) |
| Libérer le port 8080 | `taskkill /F /IM node.exe` |
| Recharger sans cache (navigateur) | `Ctrl+F5` |
| Interroger le graphe de code | `py -m graphify query "..."` / `explain` / `path` / `god-nodes` |
| Mettre à jour le graphe après modif | `py -m graphify update .` |

> Soutien réseau : port **8080**, serveur sur `0.0.0.0`. L'URL du tunnel `trycloudflare` change à chaque redémarrage.

---

## 4. Journal des changements (GÉNÉRÉ AUTOMATIQUEMENT)

> Cette section est mise à jour par `update_log.js` (planifiée chaque jour à 09 h 00).
> Chaque entrée = date + fichiers modifiés/ajoutés/supprimés (empreintes). Aucune donnée client.

### 2026-09-14 — 🔐 Refonte de l'authentification (entrée MANUELLE)

> Saisie à la main : l'auto-génération liste des fichiers, elle ne peut pas
> décrire un changement de sécurité. Détail complet : `d-aona-server/SECURITE_AUTH.md`.

**Défaut corrigé.** `POST /api/auth` ne prenait que le **pseudo** et créait ou
ouvrait le compte sans aucune preuve d'identité : connaître un pseudo suffisait
à prendre la main sur un compte (solde, chat privé, défis). La colonne
`users.password_hash` existait mais n'était jamais utilisée (0 compte sur 96) ;
les jetons vivaient dans une `Map` en mémoire (perdus au redémarrage, jamais
expirants, non révocables). L'interface affichait déjà un champ mot de passe…
que le backend ignorait.

**Ajoutés :** `d-aona-server/auth.js` (Argon2id `m=19456,t=2,p=1`, sessions
opaques stockées hachées, expiration 30 j, révocation individuelle, verrouillage
progressif 5 échecs → 1 min doublé jusqu'à 60 min, limitation de débit 12/IP/5 min,
anti-énumération, journal d'audit en ajout seul) ·
`migrations/001_auth_credentials.sql`, `002_sessions.sql`, `003_auth_audit.sql` ·
`migrate.js` (migrations versionnées, transaction par migration, empreinte
SHA-256 anti-réécriture) · `backup_db.js` (sauvegarde vérifiée `VACUUM INTO` +
`integrity_check` + manifeste SHA-256) · `test_auth.js` (34 vérifications) ·
`reset_password.js` · `.env.example` · `SECURITE_AUTH.md`.

**Modifiés :** `d-aona-server/db.js` (clés étrangères activées, migrations au
démarrage) · `d-aona-server/server.js` (routes `/api/auth/{login,register,claim,
logout,password}`, session validée **en base** pour REST et WebSocket, lecture du
corps bornée à 64 Ko — corrige un déni de service mémoire, port configurable) ·
`D-aona/d-aona-web/index.html` (le mot de passe est enfin transmis : `authSequence`
cible les bonnes routes ; parcours « Définir mon mot de passe » pour les comptes
anciens ; déconnexion révoquée côté serveur) · `.gitignore` (`backups/`, `uploads/`).

**Retirés du suivi Git :** `d-aona-server/uploads/avatars/*` — photos personnelles
(12 fichiers, dont des portraits). Fichiers conservés sur disque ; aucun remote
n'étant configuré, rien n'a été publié. Ils restent présents dans l'historique.

**Décisions déclarées (non confirmées au préalable).** (1) Conservation de
**SQLite** : le backend n'est pas PostgreSQL, et l'architecture « PC hôte,
hors-ligne » serait cassée par un serveur de base externe. (2) Fenêtre de
réclamation des comptes hérités **ouverte par défaut** — à fermer
(`D_AONA_ALLOW_LEGACY_CLAIM=0`) avant tout argent réel. (3) `D_AONA_TRUST_PROXY`
désactivé par défaut (sinon un client peut usurper son IP et contourner le
limiteur). (4) Changement de mot de passe = révocation de toutes les sessions.

**État des données :** sauvegarde vérifiée `backups/2026-09-14_19h55m38`
(546 lignes conformes, `integrity_check=ok`, 14 fichiers `uploads/`).
**Aucune donnée existante n'a été supprimée ni modifiée.**
<!-- JOURNAL_AUTO_START -->
## 2026-09-13
**Modifiés :** `manifest.json`, `stat-index.json`, `GUIDE_LIEN_REMOTE.md`
**Ajoutés :** `b2e2141981956f0b012e6fd6a44137fd0f2fc740a398e73e6bb8fbfe84dc2924.json`

## 2026-09-12
**Modifiés :** `index.html`, `README.md`, `data.js`, `db.js`, `game.js`, `package-lock.json`, `package.json`, `server.js`, `.graphify_root`, `graph.json`, `manifest.json`, `last_query_stamp`, `stat-index.json`, `GUIDE_LIEN_REMOTE.md`
**Ajoutés :** `plateau_clean.png`, `plateau_exact.svg`, `reset_test_tournament.js`, `avatar_30_1788005784218.png`, `avatar_30_1788005820119.png`, `avatar_31_1788006541472.png`, `avatar_32_1788006543999.jpg`, `avatar_32_1788006756188.jpg`, `avatar_75_1788004932771.png`, `avatar_76_1788004978379.png`, `avatar_77_1788005008779.png`, `avatar_81_1788007928893.png`, `avatar_83_1788008974427.png`, `avatar_86_1788008990600.png`, `avatar_89_1788009003505.png`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `GRAPH_REPORT.md`, `1ca8e3c11923c937f68bf722021b3c0275a6a058355bdd3c6f42f9535d662b23.json`, `210b9fe69f4e0cca75cfbea4615c4094eb315a14455446762f2195c1cf282060.json`, `40aaa564a2f453307c0d0dbe0603d9f7ab63483791133c2b48de09af9ff05787.json`, `60a156b83858ebc773b018efc4cb356646f2dfdf762a3eaae9446a6dfcf4ec20.json`, `c150078f242fc2b47a6ab611d5b82a61c22eaba0458b5afbd98eccc7d7ed7c7e.json`, `c720fd8c8c102ae3a3591037f4b3f15df1180892a45beab48f924d69384ebc40.json`, `ca8d78d5f9fc1e412620e978e96d94c80979d041f2c7050d25bc4527d3499b58.json`, `d0367333b6473417d407bb10f70e936caef2eed0811400bc6877b988e44e4e3b.json`, `dd5fc8147fc395d230fcfc8c72fcffc208c88d8073a8abdc09efadffee365db9.json`, `e5bd0bf51efb20711d88601b2a135893fbac50e349ccea2908a25bf4d1eb6100.json`, `f8b5105021df5c70c7ebdf8a39b61615f7e610a15da58e3c20048ea51b8c5a5d.json`, `fd932250ec181ce147ef0fa6e270aa708f0c9ec694dfe73a4a30a8cd6a9ef3a4.json`, `graph.html`
**Supprimés :** `fanorona.png`, `fanorona@2x.png`, `main.css`, `api.js`, `app.js`, `fanorona.js`, `assemble_bg.py`, `corner_bl.png`, `corner_br.png`, `corner_tl.png`, `corner_tr.png`, `edge_bottom.png`, `edge_left.png`, `edge_right.png`, `edge_top.png`, `disc2.txt`, `pov_ai.png`, `pov_p1.png`, `pov_p2.png`, `start.bat`, `test_api.js`, `test_disconnect.js`, `test_friends.js`, `test_full_game.js`, `test_import.js`, `TEST_LOOP.js`, `test_spectate.js`, `test_toss.js`, `test_tunnel_ws.js`, `test_ws.js`, `DIAGNOSIS.md`, `File path here`, `colors2.txt`, `01_auth.png`, `02_home.png`, `03_ranks.png`, `04_wallet.png`, `repro_p1.png`, `repro_p2.png`, `theme_clair.png`, `theme_nuit.png`, `theme_sombre.png`, `test_click_repro.js`, `test_colors.js`, `test_friends_ui.js`, `test_frontend.js`, `test_pov.js`, `test_role.js`, `test_theme.js`, `test_turns.js`, `turns_final.txt`, `turns_final2.txt`

**Modifiés :** `index.html`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`
**Ajoutés :** `d5bcbdb0f05ab7a91535ab0dc61c1286fe54f45a04929e9c3891a2a99d1058bd.json`
**Modifiés :** `index.html`, `manifest.json`, `stat-index.json`
**Ajoutés :** `c2dcc66b656937397beebcc4bbce434056c83e700fdb1c9d788fd3c43b9eb060.json`
**Modifiés :** `index.html`, `manifest.json`, `stat-index.json`
**Ajoutés :** `db5137236b9b34cec4f0a496a704891dfac9f0c907817f31ecc3411359d46770.json`
**Modifiés :** `index.html`, `manifest.json`, `stat-index.json`
**Ajoutés :** `318cf5c782f9fe8816aea59daa2a32ae357b39053e6e6efbde7511abfbaa4ad1.json`
**Modifiés :** `index.html`, `manifest.json`, `stat-index.json`
**Ajoutés :** `1def4377f3803337acabb47dc479d692e264ec6b2466aeb2d3d00a031e8cd143.json`
**Modifiés :** `index.html`
**Modifiés :** `index.html`, `manifest.json`, `stat-index.json`
**Ajoutés :** `4f5df6a8a05f8db15c517bcca0cb054ba5e19088a5ee5f3c01a0900244b2edea.json`
<!-- JOURNAL_AUTO_END -->
