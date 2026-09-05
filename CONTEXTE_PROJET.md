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

<!-- JOURNAL_AUTO_START -->
<!-- JOURNAL_AUTO_END -->
