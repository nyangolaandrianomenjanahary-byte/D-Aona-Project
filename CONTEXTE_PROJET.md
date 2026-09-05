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
| [server.js](d-aona-server/server.js) | 🧠 **Cœur** : API REST, WebSocket, matchmaking, serveur HTTP/WS |
| [db.js](d-aona-server/db.js) | Couche SQLite : schéma + accès (users, games, tournois, wallet…) |
| [game.js](d-aona-server/game.js) | Moteur de partie Fanorona côté serveur (règles, captures, Elo) |
| [data.js](d-aona-server/data.js) | Données / constantes de référence |
| [check_db.js](d-aona-server/check_db.js) | Vérifier l'état des tables de la base |
| [diag.js](d-aona-server/diag.js) | Diagnostic réseau |
| [package.json](d-aona-server/package.json) | Dépendances (`ws`) |
| [start.bat](d-aona-server/start.bat) | Demarrer le serveur en hôte réseau |
| [DEMARRER.bat](d-aona-server/DEMARRER.bat) | Demarrage simple |
| [LIEN_REMOTE.bat](d-aona-server/LIEN_REMOTE.bat) | Serveur + pare-feu + tunnel Cloudflare (jeu à distance) |
| [HOTSPOT.bat](d-aona-server/HOTSPOT.bat) / [HOTSPOT.ps1](d-aona-server/HOTSPOT.ps1) | Activer le hotspot WiFi |
| [CONFIGURER.bat](d-aona-server/CONFIGURER.bat) / [setup_firewall.ps1](d-aona-server/setup_firewall.ps1) | Config pare-feu (port 8080) |
| `d-aona.db` | ⛔ Base SQLite (données → **exclue** du journal) |

### Tests backend `d-aona-server/`
| Fichier | Ce qu'il teste |
|---|---|
| [TEST_LOOP.js](d-aona-server/TEST_LOOP.js) | Boucle continue (toutes les 90 s) : serveur, WS, partie complète |
| [test_api.js](d-aona-server/test_api.js) | API REST (auth, user, tournois, skins, wallet…) |
| [test_ws.js](d-aona-server/test_ws.js) | Matchmaking WebSocket |
| [test_full_game.js](d-aona-server/test_full_game.js) | Partie réelle + Elo en DB |
| [test_tunnel_ws.js](d-aona-server/test_tunnel_ws.js) | Jeu multi via tunnel Internet |
| [test_disconnect.js](d-aona-server/test_disconnect.js) | Déconnexions |
| [test_friends.js](d-aona-server/test_friends.js) | Amis |
| [test_toss.js](d-aona-server/test_toss.js) | Toss/matchmaking |
| [test_import.js](d-aona-server/test_import.js) | Import |

### Frontend `D-aona/d-aona-web/`
| Fichier | Rôle |
|---|---|
| [index.html](D-aona/d-aona-web/index.html) | Structure SPA (8 écrans) |
| [README.md](D-aona/d-aona-web/README.md) | Doc maquette (cartographie PRD) |
| [assets/css/main.css](D-aona/d-aona-web/assets/css/main.css) | Design system PRD (#0A0A0F / #0F0F1A / #1D9E75 / #E59E27) |
| [assets/js/app.js](D-aona/d-aona-web/assets/js/app.js) | Router, wallet, tournois, classement, KYC, chat… |
| [assets/js/fanorona.js](D-aona/d-aona-web/assets/js/fanorona.js) | Moteur Fanorona + IA + rendu plateau |
| [assets/js/api.js](D-aona/d-aona-web/assets/js/api.js) | Couche appel API |
| [assets/js/data.js](D-aona/d-aona-web/assets/js/data.js) | Données / constantes front |
| [assets/bg/](D-aona/d-aona-web/assets/bg/) | Fond du plateau (`fanorona.png`, `@2x`) |
| [setup/assemble_bg.py](D-aona/d-aona-web/setup/assemble_bg.py) | Assemble le fond à partir des 8 assets pixel-art |

### Diagnostics & outils
| Fichier | Rôle |
|---|---|
| [debug_outputs/DIAGNOSIS.md](debug_outputs/DIAGNOSIS.md) | Analyse des problèmes corrigés (mouvements des pions) |
| [test-tools/](test-tools/) | Tests front + Playwright : `test_frontend.js`, `test_click_repro.js`, `test_turns.js`, `test_role.js`, `test_theme.js`, `test_pov.js`, `test_colors.js`, `test_friends_ui.js` |

### 📂 Dossiers exclus du suivi
`node_modules/`, `.git/`, `.claude/`, `.agents/`, `agent/` (copies de skills), `graphify-out/` (graphe généré), `*.log`, `*.db`, `cloudflared.exe`, `maj_state.json`.

---

## 3. Commandes de référence

| Action | Commande |
|---|---|
| Démarrer le serveur (hôte) | `d-aona-server\DEMARRER.bat` (ou `start.bat`) |
| Jeu à distance (tunnel public) | `d-aona-server\LIEN_REMOTE.bat` |
| Activer le hotspot | `d-aona-server\HOTSPOT.bat` |
| Vérifier la base | `node d-aona-server\check_db.js` |
| Boucle de tests complète | `node d-aona-server\TEST_LOOP.js 90` |
| Test frontend (Playwright) | `node test-tools\test_frontend.js` |
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

<!-- JOURNAL_AUTO_START -->
## 2026-08-22
**Modifiés :** `.gitignore`, `fanorona.png`, `fanorona@2x.png`, `main.css`, `api.js`, `app.js`, `data.js`, `fanorona.js`, `index.html`, `README.md`, `assemble_bg.py`, `corner_bl.png`, `corner_br.png`, `corner_tl.png`, `corner_tr.png`, `edge_bottom.png`, `edge_left.png`, `edge_right.png`, `edge_top.png`, `check_db.js`, `CONFIGURER.bat`, `db.js`, `DEMARRER.bat`, `diag.js`, `disc2.txt`, `game.js`, `HOTSPOT.bat`, `HOTSPOT.ps1`, `LIEN_REMOTE.bat`, `package-lock.json`, `package.json`, `server.js`, `setup_firewall.ps1`, `pov_ai.png`, `pov_p1.png`, `pov_p2.png`, `start.bat`, `test_api.js`, `test_disconnect.js`, `test_friends.js`, `test_full_game.js`, `test_import.js`, `TEST_LOOP.js`, `test_toss.js`, `test_tunnel_ws.js`, `test_ws.js`, `DIAGNOSIS.md`, `File path here`, `GUIDE_LIEN_REMOTE.md`, `maj_journal.bat`, `planif_quotidienne.bat`, `skills-lock.json`, `colors2.txt`, `01_auth.png`, `02_home.png`, `03_ranks.png`, `04_wallet.png`, `repro_p1.png`, `repro_p2.png`, `theme_clair.png`, `theme_nuit.png`, `theme_sombre.png`, `test_click_repro.js`, `test_colors.js`, `test_friends_ui.js`, `test_frontend.js`, `test_pov.js`, `test_role.js`, `test_theme.js`, `test_turns.js`, `turns_final.txt`, `turns_final2.txt`
**Modifiés :** `main.css`, `app.js`, `fanorona.js`, `game.js`, `server.js`, `theme_clair.png`, `theme_nuit.png`, `theme_sombre.png`
**Ajoutés :** `test_spectate.js`
**Ajoutés :** `.gitattributes`, `AGENTS.md`, `.graphify_root`, `9c825fc0e09a2301800c593b40b405b1f0c202135d7bbf5e6fad511c59ce19f5.json`, `a85440a6ab948111eb9d35afeb07d27c6dce944e6c04a9bf4d020ea8714252e2.json`, `b6f910e8a80aed10b30ed477f21d38d83ff2943124b434a59a318ac93e9cc5e8.json`, `c22d65023d8762e5b3c638d856779afd2fcbe9bee0e2cdbfa4c87a1c3a37df3c.json`, `ff66352096433cfdf5542402ae2b5b9a1d371f7276013fa98f8a723d91621fb4.json`, `last_query_stamp`, `stat-index.json`, `graph.json`, `manifest.json`
**Modifiés :** `.gitignore`, `skills-lock.json`

## 2026-08-16
Snapshot initial : 70 fichiers suivis. **Baseline enregistrée.**
**Modifiés :** `main.css`, `app.js`, `index.html`, `CONFIGURER.bat`
**Ajoutés :** `.gitignore`, `planif_quotidienne.bat`
**Modifiés :** `main.css`, `fanorona.js`, `index.html`
<!-- JOURNAL_AUTO_END -->
