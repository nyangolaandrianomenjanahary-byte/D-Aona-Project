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
| [REVUE_UI_UX.md](REVUE_UI_UX.md) | 🔍 Revue UX/UI **mesurée** (contraste AA, 3 gabarits, 2 thèmes, cibles tactiles, accessibilité) — 12 causes racines + lots correctifs |
| [update_log.js](update_log.js) | Moteur de mise à jour automatique du journal |
| [maj_state.json](maj_state.json) | État de référence du dernier scan (généré) |
| [maj_journal.bat](maj_journal.bat) | Lancement manuel de la mise à jour |
| [skills-lock.json](skills-lock.json) | Verrou des skills d'agent |

### Backend `d-aona-server/`
| Fichier | Rôle |
|---|---|
| [server.js](d-aona-server/server.js) | 🧠 **Cœur** : API REST, WebSocket, matchmaking, moteur tournoi (bracket, confirmations, forfaits auto), notifications |
| [db.js](d-aona-server/db.js) | Couche SQLite : câblage public + application des migrations au démarrage. Le code vit dans [db/core.js](d-aona-server/db/core.js) (connexion), [db/schema.js](d-aona-server/db/schema.js) (schéma) et [db/stores.js](d-aona-server/db/stores.js) (magasins métier) |
| [auth.js](d-aona-server/auth.js) | 🔐 **Authentification** : Argon2id, sessions opaques révocables, verrouillage progressif, limitation de débit, journal d'audit |
| [migrate.js](d-aona-server/migrate.js) | Exécuteur de migrations versionnées (`node migrate.js --status`) |
| [migrations/](d-aona-server/migrations) | Migrations SQL versionnées (`001`…`011` : auth, sessions, audit, contacts uniques, clés étrangères des skins, instantané d'Elo, filigrane Amis, types de pions clairs/sombres, apparence du pion, **apparences PAR CAMP (clairs / sombres)** et cohérence des groupes) |
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
| [assets/coins/](D-aona/d-aona-web/assets/coins/) | Les deux faces de la pièce du tirage au sort (photos détourées, cf. son README) |

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
| **Tests d'interface (scénarios)** | `node d-aona-server\test_ui_scenarios.js` |
| **Vérifier l'onglet Jeux sur modèles de téléphone** | `node d-aona-server\_verif_jeux_mobile.js` (6 appareils Playwright, clics réels, captures `%TEMP%\daona_shots\jeux-mobile`) |
| **Vérifier les deux faces de la pièce (tirage au sort)** | `node d-aona-server\_coin_verif.js` (9 contrôles, base jetable, captures) |
| **Contrôler la courbe Elo et les statistiques du Profil** | `node d-aona-server\_probe_elo_stats.js` (31 contrôles, base jetable) |
| **Vérifier la courbe sur les données réelles** | `node d-aona-server\_check_elo_reel.js [pseudo]` (copie jetable ; le mot de passe n'est changé que sur la copie) |
| **Mesurer l'état des données de jeu** | `node d-aona-server\_inspect_stats.js` (lecture seule : instantanés, cohérence des Elo, compteurs) |
| **Reconstituer les instantanés d'Elo manquants** | `node d-aona-server\_backfill_elo.js` (mesure seule) puis `--apply` — écrit après une sauvegarde vérifiée |
| **Aligner les compteurs du Profil sur l'historique** | `node d-aona-server\_sync_compteurs.js` (mesure seule) puis `--apply` |
| **Étoffer l'historique d'un compte (jeu de test)** | `node d-aona-server\_seed_parties_elo.js --pseudo="Ny Angola" --nb=49` (mesure) puis `--apply` — annulable via `_seed_parties_manifest.json` |
| **Mesurer un compte précis** | `node d-aona-server\_inspect_compte.js "Ny Angola"` (lecture seule : parties, chaîne d'Elo, compteurs) |
| **Rejouer la revue UX/UI mesurée** | `node d-aona-server\_revue_ui.js` (≈ 4 min — base jetable, aucune donnée réelle) |
| **Contrôler la géométrie (recouvrements, barre haute, cliquables au clavier)** | `node d-aona-server\_s7_probe.js` (lecture seule, port 8093) |
| **Contrôler la fin de course (air sous le dernier contenu)** | `node d-aona-server\_s7_fin.js` (lecture seule, port 8092) |
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

## 2026-10-07 — Onglet Wallet refondu (maquette « wallet-desktop ») : historique servi par le backend (entrée MANUELLE)

**Demande.** « Prends inspiration du fichier html dans le dossier … change l'onglet wallet. Adapte tous les backends. » (maquette `wallet-desktop.html` fournie hors dépôt).

**Écran (`index.html`).** Carte de solde (pastille « Disponible », ligne du bonus verrouillé) · carte « Frais transparents » (0 % interne / 25 % cashprizes, « Voir limites et conditions » dépliable avec « Retiré aujourd'hui : X / 500 000 Ar », bouton KYC) · historique en TABLEAU (Opération · Date et heure triables · Type · Moyen · Statut · Montant) : recherche anti-rebond 180 ms, pastilles période et type, panneau « Plus de filtres » (Du/Au/Moyen/Statut), pastilles de filtres actifs retirables, compteur « X / Y mouvements », pagination 10/20/tout, fiche détail en modale, export CSV. Aucun ton nouveau (jetons jour/nuit, pastilles `.pill` déjà mesurées AA) ; à 360 px le tableau défile DANS son conteneur (`docW = winW`) ; correctif `[hidden]` (les `display` de `.wl-adv` / `.wl-rules` / bouton Réinitialiser écrasaient l'attribut).

**Backend.** `data.js` : familles `txKind`, moyens `txMethod` (déduits du libellé), CSV `txCsv` — source de vérité unique ; chaque ligne d'historique repart étiquetée `kind`/`method`. `db/stores.js` : `Wallet.history()` (période/dates/statut/tri en SQL — famille/moyen/recherche après lecture — pagination + total) et `Wallet.withdrawnToday()` (somme réelle des retraits du jour). `server.js` : `/api/transactions` paramétré (page, size, period, from, to, kind, q, method, status, sort — le défaut « 50 derniers » est conservé pour compatibilité), nouvel `/api/transactions/export` (CSV complet, mêmes filtres, BOM + « ; », nom de fichier translittéré), plafond quotidien de retrait 500 000 Ar APPLIQUÉ (400 explicite), `withdrawn_today` CALCULÉ dans `/api/user` (la colonne n'était entretenue par personne). Client : `S.txs` et le filtrage local supprimés ; état `wl` + garde anti-réponses tardives (`wlSeq`).

**Preuves.** `node --check` 4/4 · `_check_html.js` OK · `test_scenarios` **257/257** (+6 : pagination, filtre famille, recherche, export CSV, plafond, retiré du jour) · `_probe_profil_v3` **41/41** (wallet + mobile 360 px) · campagne d'interface **115/115** · `_dbg_wallet.js` réparé (politique mot de passe 12+ ; jetons, solde réel, « 2 / 2 mouvements », zéro erreur JS) · jetables supprimés · graphe graphify à jour.

**Re-vérifié le 07/10 après la dernière retouche d'`index.html`** : `node --check` 5/5 · `_check_html.js` OK (7 039 lignes, balises équilibrées, syntaxe compilée) · `test_scenarios` **257/257** · `_dbg_wallet.js` (4 lignes, « 4 / 4 mouvements », zéro erreur JS) · nouvelle sonde `_wallet_shots.js` : captures desktop jour/nuit, fiche détail (modale `#modal-overlay` ouverte, référence TX-61), filtre « Dépôts » **2/2**, mobile 360 jour/nuit, `docW = winW` (1440 px et 360 px), tableau défilant DANS son cadre — dans `%TEMP%\daona_shots\wallet-*.png`.

## 2026-10-06 — Minimalisme : inscription & connexion (entrée MANUELLE)

**Demande.** « Même cas dans la partie inscription et connexion. »

**Textes.** Note de l'écran de connexion réduite à l'essentiel (la liste « Nouveautés interface » disparaît) ; bouton « Entrer dans l'arène 🎮 » → « Se connecter », « Créer mon compte ✨ » → « Créer mon compte » ; sous-titres resserrés (« Rejoignez l'arène. », « Compte Google lié — complétez votre profil. ») ; étape 2/2 « Sécurité & localisation » → « Sécurité » ; libellé « Confirmation du mot de passe » → « Confirmer le mot de passe » ; le sous-titre de connexion est désormais identique entre le balisage et le JS (il restait l'ancienne version longue côté script). Serveur : messages d'authentification raccourcis (« Email ou téléphone déjà utilisés. », « Compte verrouillé — réessayez dans X min. », « Trop de tentatives — réessayez dans X s. »).

**Preuves.** `node --check` OK (auth.js, http.js) · `_check_html.js` OK · `test_scenarios` 251/251 · `test_auth` TOUS LES TESTS PASSENT · campagne d'interface 115/115, zéro erreur JavaScript · graphe graphify à jour.

## 2026-10-06 — Textes minimalistes sur toute l'interface (entrée MANUELLE)

**Demande.** « Simplifier les longs textes partout — être minimaliste », frontend ET backend, sans changer la logique.

**Périmètre (≈ 60 textes réécrits plus courts).** Sous-titres d'écrans (Accueil, Jeux, Classement, Wallet, Profil, Boutique, Messagerie, Amis) ; écran « Bon retour » ; modales (KYC, dépôt, retrait, défi envoyé, recherche d'adversaire, répartition du cashprice, invitation, règles du Fanorona, tirage au sort, service client) ; états vides (En direct, Défis reçus/envoyés, Départs, Messagerie, Amis) ; aide de la personnalisation des pions ; toasts. Côté serveur : notifications (inscription, confirmation, forfait) et message automatique d'amitié. Suppressions : explication dupliquée PILE/FACE (elle ne vit plus que dans les règles), valeurs de maquette résiduelles (« ML », « 1100 Elo »), mention statique « membre depuis août 2026 ». Tous les libellés fonctionnels sont intacts (boutons, statuts, erreurs — « introuvable », « complet », « incompatible », « inscrit »…) : les campagnes le prouvent.

**Preuves.** `_check_html.js` OK · `test_scenarios` **251/251** · `test_auth` TOUS LES TESTS PASSENT · **campagne d'interface navigateur 115/115, zéro erreur JavaScript** · `index.html` 11 839 → 11 837 lignes (réduction en mots, pas en lignes) · graphe graphify à jour.

## 2026-10-06 — Nettoyage production : frontend + backend débarrassés des scories (entrée MANUELLE)

**Demande.** Nettoyer l'ensemble du projet (textes, commentaires, logs, scories) sans toucher à la logique ni au comportement.

**Frontend (`index.html`, 11 998 → 11 839 lignes).** Données mortes de la phase maquette supprimées (aucune référence — recherche exhaustive) : `OPPONENT_POOL`, `LEADERBOARD_POOL`, `TOURNAMENTS_SEED`, `CHAT_THREADS`, `CHAT_REPLIES`, `ADMIN_DEMO` (+ retrait de l'`Object.assign`), CSS `.admin-tabs` et `.footer-note` (éléments disparus). Textes temporaires retirés de l'interface : note « Maquette de démonstration » (Accueil), pseudo « Tsiry_RN » pré-rempli du formulaire de connexion, initiales « TR » du balisage, « Vérification (démo locale) » du volet KYC ; toast du mot de passe oublié reformulé (« Réinitialisation par SMS non disponible pour le moment. » — la fonction n'est pas active). Commentaires : narrations historiques (« ARBITRAGE INVERSÉ », « l'ancien… », « ne sont PLUS ») ramenées au présent ; étiquettes de process (« revue §…, lot S… ») retirées ; les mesures de contraste AA sont conservées (elles justifient les jetons).

**Backend.** `data.js` : `CHAT_REPLIES`, `fmtAr`, `countdownParts`, `eloDelta` supprimés (aucun appelant — vérifié sur tous les `.js`). `server.js` : ligne morte `if (typeof msg === "string") { }` retirée ; commentaires historiques condensés. `auth.js`, `http.js`, `db/core.js`, `db/schema.js`, `db/stores.js`, `check_wallet.js` : références « lot S13 » et narrations d'anciens défauts condensées. Aucune logique modifiée hors la ligne morte.

**Scories locales.** 87 fichiers de session supprimés (sorties de sondes `_*.txt`/`_*.err`/`*.out.log`/`*.err.log`, copie `test_ui_scenarios.fixed.js`, `_tmp_listen.txt`) ; les outils `_*.js` documentés et `_run_server.*.log` (serveur en cours) sont conservés.

**Incident de campagne + garde-fou.** Une campagne `test_scenarios` lancée en parallèle de `test_auth` (même port 8099) a tourné contre le serveur de `test_auth` — qui utilise la **base réelle** — et y a écrit 5 comptes ZzS (5 sessions, 10 skins, 5 équipements, 4 amitiés, 3 messages, 3 demandes d'ami ; aucune partie, aucun tournoi). Traces supprimées (21 → 16 comptes, 0 orphelin revérifié table par table ; 6 lignes du journal d'audit conservées — append-only par conception). `test_scenarios.js` refuse désormais de démarrer si le port 8099 est déjà occupé (garde-fou anti-collision). Règle : lancer les deux campagnes SÉQUENTIELLEMENT.

**Preuves.** `node --check` 9/9 fichiers touchés · `test_scenarios` **251/251** (exit 0) · `test_auth` TOUS LES TESTS PASSENT · `_check_html.js` OK (script compilé, balises équilibrées) · HTTP 200 sur :8080, page servie sans aucun texte retiré · base réelle : 16 comptes, 0 trace ZzS · `py -m graphify update .` OK (686 nœuds, 1159 arêtes) · diff : 10 fichiers, +153/−394 lignes.

## 2026-10-05 — Correctif bug : le brouillon de saisie ne s'efface plus quand un message arrive (surtout mobile) (entrée MANUELLE)

**Symptôme (rapporté).** « Quand je suis en train de répondre un message et que l'autre personne écrit, mon texte s'enlève automatiquement quand son message arrive » — surtout dans la partie mobile.

**Cause (trouvée).** `renderChatDock()` reconstruit TOUT le dock (`tray.innerHTML`) ; il était appelé à CHAQUE message entrant (`onIncomingChat`) — les champs de saisie des fenêtres pop-up (encoche mobile / fenêtres façon Facebook du dock) étaient recréés VIDES, et le brouillon disparaissait. Les autres reconstructions (fermeture d'une autre fenêtre, envoi dans une autre, ouverture, toggle du panneau) avaient le même défaut. L'écran Chat, lui, était déjà protégé depuis le lot performances (ajout ciblé).

**Correctif — deux couches.** (1) **Ajout ciblé** : un message entrant n'ajoute QUE la bulle à la fenêtre ouverte ; les aperçus « dernier message » (`c-prev`) et la pastille non-lus sont rafraîchis SUR PLACE via deux nouveaux helpers (`updateChatPreviews`, `updateDockUnread`) ; l'envoi dans une pop-up (clic ou Entrée) fait de même — plus AUCUNE reconstruction sur ces chemins, donc ni clignotement ni perte de frappe. (2) **Filet de préservation** dans `renderChatDock` : valeurs des champs, focus et position du curseur sont capturés AVANT chaque reconstruction et restaurés APRÈS — la re-prise de focus ne se produit que si la frappe était DANS le dock (jamais de vol de focus depuis l'écran Chat). Conséquence : fermer la fenêtre B ne touche plus le brouillon de la fenêtre C.

**Preuve (nouveau probe `_chat_draft_probe.js`, 4 sections).** Instance jetable (copie `VACUUM INTO`, 3 comptes, navigateur réel) : **TOUT OK** — ① écran Chat : brouillon INTACT après message entrant + bulle ajoutée sans reconstruire ; ② fenêtre pop-up : brouillon INTACT + bulle ajoutée DANS la fenêtre ; ③ filet : taper dans la fenêtre C puis fermer B → brouillon de C intact ; ④ 0 erreur JS.

**Contrôles.** `node _check_html.js` OK · `_chat_draft_probe.js` tout OK · `_xss_probe.js` rejoué → tout OK · campagne UI relancée.

## 2026-10-05 — Lot hygiène : code mort, scripts npm réels, .gitignore, purge des logs (entrée MANUELLE)

**Demande :** dernier lot du programme d'audit — l'entretien : ce qui traîne, ce qui ment, ce qui s'accumule.

**Ce qui a été fait.** (1) **Code mort SUPPRIMÉ — après vérification rigoureuse** : `PION_SKINS`, `typePill` et `nameFor` (définitions jamais appelées, confirmées par grep sur tout le dépôt, fragments de campagne compris). À l'inverse, `OTHER_SKINS` et `typeLabel` que l'audit initial donnait pour morts sont BEL ET BIEN UTILISÉS (écran skins, toasts d'achat/équipement) — conservés : le constat d'audit était faux, la vérification l'a corrigé. Les exports `window` de démonstration (OPPONENT_POOL, LEADERBOARD_POOL…) sont délibérés → conservés. (2) **`package.json` honnête** : `main` → `server.js` (l'ancien pointait vers un `index.js` inexistant) ; scripts réels : `start`, `migrate`, `backup`, et `test` = `test_scenarios.js && test_auth.js` (l'ancien affichait « Error: no test specified »). **`npm test` passe désormais pour de vrai.** (3) **`.gitignore` racine** : `tasks/`, `_graphify_ver.txt`, `_tmp_listen.txt` — `git status` ne montre plus AUCUN fichier non suivi. (4) **Purge des logs** : 98 fichiers `.log` de plus d'un jour supprimés (109 → 11, ceux de la session conservés). Les ~100 sondes `_*.js` et relevés `_*.txt` sont CONSERVÉS : ce sont les outils de preuve référencés par les journaux des lots précédents.

**Contrôles.** `node _check_html.js` OK après suppressions · **`npm test` exit=0** (Tous les scénarios passent ; TOUS LES TESTS PASSENT) · `git status` : plus aucun non-suivi · campagne UI finale relancée.

**Clôture du programme.** Lots 0→6 exécutés : sauvegarde → XSS → durcissement serveur → robustesse → performances → architecture → hygiène. Chaque lot : preuve chiffrée, journal, graphe, commit. Reste noté pour plus tard : migration CSP stricte (nonces, suppression progressive des `onclick=` en ligne).

## 2026-10-05 — Lot architecture : découpage de `db.js` (816 l.) et extraction de `http.js` (entrée MANUELLE)

**Demande :** suite du programme d'audit — Lot 5 : le rapport graphify demandait explicitement « Should server.js / db.js be split into smaller, more focused modules? » (cohésions 0,08 / 0,06).

**Ce qui a été fait — découpage par SCRIPT déterministe** (`_split_db.js`, `_split_http.js` : copies VERBATIM par marqueurs, aucune recopie à la main) :
- `db.js` (816 l.) → **`db.js` = 29 lignes de câblage** + **`db/core.js`** (connexion SQLite, PRAGMA) + **`db/schema.js`** (218 l., amorçage du schéma CREATE/ALTER tolérants) + **`db/stores.js`** (592 l., les magasins métier — copie verbatim, commentaires d'origine conservés) ;
- `server.js` → **`http.js`** (130 l. : MIME, ROOT, serveStatic anti-traversée, clientIp, bearerToken, authMiddleware, isRateLimited, readBody borné, respond) ; les points d'appel de server.js passent par un require destructuré — aucun renommage, aucun comportement modifié. server.js : 1761 → 1653 lignes.

**Contrôles.** `node --check` 6/6 fichiers OK · **fumée `_smoke_db.js` sur COPIE** : surface publique identique (17 exports, aucun manquant, base lisible : 16 comptes, wallet, 6 tournois) · `test_scenarios.js` **251/251** · `test_auth.js` **TOUS LES TESTS PASSENT** · `_sec_probe.js` rejoué → tout OK · campagne UI **115/115** (Lot 4) · serveur de production redémarré (HTTP 200, en-têtes actifs).

**Reste ouvert.** Lot 6 (hygiène : code mort, dédoublonnage, scripts npm, archivage des brouillons) ; migration CSP stricte (chantier long) ; si besoin, poursuite du découpage de server.js par seams contigus (routes/WS), avec la même méthode scriptée.

## 2026-10-05 — Lot performances : plateau WebP −40 %, chat en ajout ciblé, tabbar suspendue, index SQLite (entrée MANUELLE)

**Demande :** suite du programme d'audit — Lot 4 : ce que l'application dépense pour rien (octets, DOM, CPU, requêtes).

**Constats mesurés avant.** `plateau_clean.png` (2,4 Mo) partait en entier à chaque ouverture du plateau ; l'écran Chat reconstruisait TOUTE la conversation à chaque message (O(n) par message) ; la barre d'onglets entretenait une boucle `requestAnimationFrame` PERMANENTE (60 fps même immobile) ; trois requêtes chaudes balayaient leurs tables (`challenges`, scrutée à chaque tick de jeu ; `games` ; sens inverse du chat). Le SVG « plateau_exact » de 8,3 Mo est un artefact de CONSERVATION (PNG embarqué sans recompression) qui n'est PAS chargé par l'application — laissé tel quel, volontairement.

**Correctifs.** (1) **Plateau : WebP SANS PERTE (1 432 Ko vs 2 404 Ko, −40 %)** produit par `_webp_board.py` (contrôle intégré : pixels RGBA reconstruits identiques) + PNG recompressé sans perte (2 313 Ko) ; la page sert le WebP via `<picture>` avec repli PNG. (2) **Chat : ajout ciblé** — `appendChatMsg` construit la bulle par `textContent` (aucune injection possible) et n'ajoute QUE le nouveau message ; l'aperçu du contact est mis à jour sur place ; les bulles existantes ne sont plus détruites/recréées. (3) **Tabbar : boucle suspendue au repos** — `needsFrames()` (ressorts arrivés + couleurs stabilisées) arrête la boucle `requestAnimationFrame` ; `kick()` la relance à chaque geste (sélection, glisser, measure/resize). (4) **Index SQLite (migration 012)** : `challenges(status, expires_at)` + `to_id` + `from_id` ; `games(player1_id|player2_id, created_at)` ; `chat_messages(to_user_id, from_user_id, created_at)`.

**Mesures (probes dédiés).** `_idxcheck.js` (copie gonflée : 20 000 messages, 8 000 parties, 2 000 défis ; base réelle intacte) : **défis expirés (chaque seconde) 0,249 → 0,099 ms (−60 %)** · **parties d'un joueur 4,681 → 1,366 ms (−71 %)** · gain moyen **23 %**. `_perf_probe.js` (navigateur réel, instance jetable) : **TOUT OK** — WebP servi et ≥ 30 % plus léger, la page le référence en `<source>` ; **bulles du chat intactes** à l'arrivée ET à l'envoi d'un message (nœuds DOM identiques, +1 bulle exactement) ; **aucune boucle permanente au repos (≤ 2 frames / 2 s)**, réveil au resize, re-suspension.

**Contrôles.** `node --check server.js` / `node _check_html.js` OK · `test_scenarios.js` **251/251** · `test_auth.js` **TOUS LES TESTS PASSENT** · `_xss_probe.js` et `_robust_probe.js` rejoués → tout OK · campagne UI relancée · migration 012 appliquée sur la base réelle (serveur redémarré, HTTP 200).

**Reste ouvert (lots suivants).** Architecture (découpage `server.js`/`db.js`) ; hygiène (code mort, dédoublonnage, scripts npm) ; migration CSP stricte (chantier long).

## 2026-10-05 — Lot robustesse réseau : timeout REST, backoff WebSocket, plafond de file, gardes et journalisation (entrée MANUELLE)

**Demande :** suite du programme d'audit — Lot 3 : rendre l'application résiliente aux coupures (réseau mobile, hotspot, mise en veille) et aux données partielles.

**Correctifs.** (1) **REST : délai maximal de 15 s** (`AbortController` dans `API.request`) : une coupure ne laisse plus de spinner sans fin ni de files qui s'empilent ; l'échec parle de connexion. (2) **WebSocket : backoff exponentiel plafonné (1 s → 15 s) + jitter** en remplacement du délai fixe de 3 s — plus de martèlement pendant une longue panne, plus de ruée synchronisée au retour ; UN seul avertissement console par panne ; compteurs remis à zéro à l'ouverture (la reconnexion ré-authentifiait déjà — vérifié). (3) **File d'envoi plafonnée à 50** (le plus ancien est jeté) : rejouer des centaines d'actions périmées n'avait aucun sens. (4) **Gardes `undefined`** dans la fenêtre « adversaire trouvé » (`opponent?.elo ?? "—"`, pseudo optionnel). (5) **Serveur : erreurs de socket WebSocket journalisées** (`[ws] erreur socket: …`) au lieu d'être avalées ; les `ALTER TABLE` idempotents de `db.js` portent le commentaire qui légitime leur catch muet. (6) **Dépôt : montant négatif refusé (400)** — un dépôt négatif débitait le wallet ; valeur absente/zéro → 5 000 (comportement conservé) ; libellés d'opérateur bornés à 40 (dépôt et retrait).

**Preuve (nouveau probe `_robust_probe.js`).** Scénario de coupure complet sur instance jetable (copie VACUUM INTO, port 8093) : **TOUT OK** — chaque requête REST porte un signal d'annulation ; dépôt −5 000 → 400, solde inchangé ; serveur **tué** → tentatives espacées 1 s→2 s→4 s (délais croissants ; premier < 2,5 s vs 3 s fixe avant), aucune erreur JS ; serveur **relancé** → reconnexion seule de la page ET **message reçu de nouveau en direct**. Note best-effort (sans échec) : la destruction TCP brutale d'une sonde n'a pas déclenché la ligne `[ws]` — journalisation vérifiée par lecture de code.

**Contrôles.** `node --check server.js` OK · `node _check_html.js` OK · `test_scenarios.js` **251/251** · `test_auth.js` **TOUS LES TESTS PASSENT** · `_sec_probe.js` et `_xss_probe.js` rejoués → tout OK · campagne UI relancée · serveur de production redémarré, en-têtes toujours actifs.

**Reste ouvert (lots suivants).** Performances (rendus en delta, assets — plateau SVG 8,3 Mo) ; architecture (découpage `server.js`/`db.js`) ; hygiène (code mort, dédoublonnage, scripts npm) ; migration CSP stricte (chantier long).

## 2026-10-05 — Lot sécurite « durcissement serveur » : en-têtes + CSP, Origine WebSocket, bornes du chat, signature des images, identifiants imprévisibles (entrée MANUELLE)

**Demande :** suite du programme d'audit — Lot 2 : tout ce qui protège le SERVEUR lui-même (le Lot 1 avait traité l'XSS côté rendu).

**Correctifs.** (1) **En-têtes de sécurité sur toutes les réponses** (HTML + API) : CSP (`default-src 'self'` ; script/style laissés en `'unsafe-inline'` car le mono-fichier contient trois `<script>` en ligne et de nombreux `onclick=` — leur migration est un chantier séparé —, polices Google autorisées, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, `Permissions-Policy` (caméra, micro, géolocalisation, paiement fermés). (2) **WebSocket : contrôle d'Origine** — un navigateur envoie toujours `Origin` ; hôte ≠ hôte du service ⇒ fermeture 1008 ; un client natif sans Origin reste accepté (sondes/scripts, non détournables par un site tiers). Cette barrière s'AJOUTE à l'authentification par jeton. (3) **Chat : bornes serveur** — type vérifié, longueur plafonnée à 500, caractères de contrôle retirés, message vide refusé, **limitation de débit 20 messages / 10 s** par joueur (fenêtre purgée à chaque tick). (4) **Upload d'avatar : signature binaire** — le contenu doit correspondre au format déclaré (PNG/JPEG/GIF/WebP ; le SVG était déjà hors de la liste). (5) **Identifiants imprévisibles** — `PM-` (matchmaking) et `GS-` (session de partie) passent de `Math.random()` à `crypto.randomBytes(4)` (hex 8). (6) **Pseudo** : vérifié — le jeu de caractères était DÉJÀ imposé côté serveur (`[A-Za-z0-9_.\- ]`, ≤ 14 caractères) ; aucun changement nécessaire (constat mesuré, pas supposé).

**Preuve (nouveau probe `_sec_probe.js`).** 7 sections sur instance jetable (copie `VACUUM INTO`, port 8096) : **18/18 OK** — en-têtes présents sur HTML ET API ; pseudos `<b>x</b>` et `Bad?Name` refusés à l'inscription ; Origine étrangère refusée / locale acceptée / native acceptée ; chat 600 → 500 caractères et `a\0b·c` → `abc` ; flood de 25 envois → 20 acceptés puis 5 refus ; HTML déguisé en PNG refusé (400) et vrai PNG accepté (200) ; `game_start` porteur d'un id `GS-[0-9A-F]{8}`.

**Contrôles.** `node --check server.js` OK · `test_scenarios.js` **251/251** · `test_auth.js` **TOUS LES TESTS PASSENT** (verrouillage progressif + limite de débit par IP) · `_xss_probe.js` rejoué sous CSP → **13/13** · serveur de production redémarré, les cinq en-têtes vérifiés en direct sur :8080.

**Reste ouvert (lots suivants).** Migration CSP stricte (retirer `'unsafe-inline'` : conversion des `onclick=` et des scripts en ligne, nonces) ; robustesse réseau (timeout `fetch`, backoff WebSocket) ; performances (rendus en delta, assets) ; architecture (découpage `server.js`/`db.js`) ; hygiène.

## 2026-10-05 — Lot sécurité « XSS » : une source d'échappement unique (`escHtml`), no-op du chat réparé, ~40 puits corrigés (entrée MANUELLE)

**Demande :** audit de sécurité global ; ce lot traite LE défaut réellement exploitable relevé par l'audit — le fil de chat rendait le HTML brut.

**Le défaut (constaté avant correctif).** Un message contenant `<img src=x onerror=…>` s'exécutait chez le destinataire (écran Chat, dock et pop-up). La chaîne : le serveur stocke et relaie le texte tel quel (`server.js`, case `chat_message` ; `db.js → Chat.saveMessage`) et le client l'injectait sans échappement. Aggravants : `txt.replace(/</g, "<")` dans `sendChatText` était un **no-op** (moins remplacé par moins) ; l'échappement existait mais **local et partiel** (`mtEsc` dans l'IIFE Match, `escAttr` local à l'écran Classement) ; une quarantaine d'autres puits recevaient des données réseau sans échappement (classement, profil public/personnel, notifications, tournois, amis, toasts, journal des coups).

**Correctifs.** (1) **Source unique globale `escHtml`** en tête du grand script ; `mtEsc` et `escAttr` n'en sont plus que des **alias** (aucun des ~35 points d'appel existants n'a bougé). (2) Le no-op de `sendChatText` est supprimé : le texte est conservé **brut** et échappé **au rendu uniquement** (pas de double échappement). (3) ~40 puits corrigés (45 modifications ciblées) : chat (écran, dock, pop-up : textes, pseudos, placeholders, `data-*`), classement (pseudo, province, badges), profil public et personnel (dont `src` d'avatar), notifications, tournois (cartes, page, bracket, historique, « mes tournois », modal de match), amis (3 rendus de ligne), recherche du header, réglages de partie, journal des coups. (4) **Toasts** : le message est posé en `textContent` (aucun appelant n'y met de balise). (5) Badges : nom et icône échappés ; les couleurs du catalogue restent en style (données internes).

**Preuve (nouveau probe `_xss_probe.js`).** Scène complète : deux comptes jetables sur une **copie** de la base (`VACUUM INTO`) et une instance jetable (port 8097) ; le message piégé part par **WebSocket** (le chemin exact d'un joueur réel) ; la victime lit dans **Edge réel** (Playwright). **13/13 OK** : aucun script exécuté (`window.__xss` absent), aucune balise créée, le HTML s'affiche **en texte** — à l'écran Chat, sur la poussée en direct et dans le pop-up du dock ; **0 erreur JavaScript**.

**Contrôles.** `node _check_html.js` OK (script compilé, balises équilibrées) · `node _xss_probe.js` **13/13** · grep de contrôle : plus aucun puits non échappé sur les données réseau (les occurrences restantes sont des **catalogues locaux en dur** : OPERATORS, FORMATS, pions, SKINS_CATALOG) · serveur de production (8080) inchangé — le fichier statique est relu à chaque requête, aucun redémarrage nécessaire.

**Reste ouvert (lots suivants du programme).** Côté serveur : en-têtes de sécurité + CSP, validation du chat (longueur/charset), `crypto.randomUUID` pour les identifiants de session, contrôle d'Origine WebSocket, revue de l'upload d'avatar ; robustesse réseau (timeout `fetch`, backoff WS) ; performances (rendus en delta, assets) ; architecture (`server.js`/`db.js`).

## 2026-10-04 — Motifs de pion : les pions SOMBRES reçoivent leur propre dessin (entrée MANUELLE)

**Demande :** « Voici maintenant l'asset qui sera adapté au motif des pions sombres — les motifs
introduits initialement sont pour les pions clairs, ceux que l'on va introduire sont pour les
sombres » — lot `Assets-noirs-contraste-initial` (PNG RGBA détourés, 512 / 256 / 128 / 64 ; le
lémurien livré jusqu'à 1024).

**Décision — un dessin PAR CAMP, sans variable CSS de plus.** Les quatre motifs illustrés gardent
la famille `img`, mais le catalogue `PION_PATTERNS` leur donne désormais **deux chemins** : `img`
(pions CLAIRS, lot `Assets-premiere-version`) et `imgDark` (pions SOMBRES, nouveau lot).
`mountPionStyles()` choisit le fichier d'après le **groupe du jeu de variables**
(`PION_VAR_SETS[].group`) — celui qui décide déjà quelle couleur ce camp a le droit de porter :
suffixes `""` / `-opp` → lot clair, `-dark` / `-opp-dark` → lot sombre. Aucun rebinding nouveau :
l'aperçu de la boutique (`.pion-view--dark`), les vignettes de motif, le plateau
(`.piece.sombre`, `.piece.opp.sombre`) et l'inventaire suivent la recette unique ; un motif sans
`imgDark` (ajout futur) garde le fichier clair sur les deux camps, comme avant. C'est la réponse
directe à l'avertissement du premier lot — « les parties sombres peuvent manquer de contraste sur
un pion noir ».

**Les deux lots sont des dessins DIFFÉRENTS du même sujet** — le lot sombre l'annonce lui-même
(« ils diffèrent des dessins de la version blanche initiale ») : le zébu sombre est
blanc-dominant là où celui des clairs est noir-dominant, vu en captures sur les deux camps. Si un
dessin strictement identique décliné en deux coloris était un jour voulu, le LISEZ-MOI indique la
voie (déclinaison colorimétrique depuis une seule source) — non demandé ici.

**Où vivent les fichiers.** Huit PNG dans `D-aona/d-aona-web/assets/pions/` : les quatre du lot
clair, plus `zebu-sombre.png`, `ravinala-sombre.png`, `lemurien-sombre.png` et
`crocodile-sombre.png` (les **256 px** du lot sombre, copiés **sans ré-encodage**, SHA-256 égaux,
cf. le README du dossier). ⚠ Le lot sombre nomme ses fichiers `<motif>-noir-*.png` **sauf le
lémurien** (`lemur-256.png`, homonyme de la source claire) : la sonde compare désormais les deux
dessins d'un même motif octet par octet, pour qu'un écrasement ne passe pas.

**Vérifications rejouées, tout vert :** `_pions_verif.js` **54/54, 0 erreur JS** — les huit PNG
servis en 200 / `image/png` / 256 × 256 avec coins d'alpha nul, les deux dessins d'un même motif
**différents**, la peinture par `background-image` **par camp** (onglet clair → lot initial,
onglet sombre → `<motif>-sombre.png`, aperçu ET vignette), les 20 règles de `#pion-styles`
(chacune avec le dessin de son camp), et le plateau en partie IA : mes pions sombres ont peint
`crocodile-sombre.png`, ceux de l'adversaire clair `ravinala.png` · `_s8_verif.js` **31/31**
(V8 : l'attribut `-opp-dark` peint `zebu-sombre.png`, `-opp` peint `zebu.png`) ·
`test_ui_scenarios.js S8` **16/16** · `_probe_boutique_v1.js` **30/30** · `_check_html.js` OK
(6 571 lignes, balises équilibrées). Captures : `%TEMP%\daona_shots\pions-*.png` (par motif en
clair et en sombre, boutique des deux camps, plateau).

**Fichiers :** `D-aona/d-aona-web/index.html` (commentaires, `PION_PATTERNS` → `imgDark`,
`mountPionStyles`), `D-aona/d-aona-web/assets/pions/` (4 PNG sombres + README réécrit),
`d-aona-server/_pions_verif.js`, `_p10.js`, `_s8_verif.js`, `_probe_boutique_v1.js`,
`test_ui_scenarios.js` (régénéré par `_build.js`), `D-aona/d-aona-web/README.md`,
`CONTEXTE_PROJET.md`.

## 2026-10-03 — Motifs de pion : le lémurien, le zébu, le crocodile et le ravinala passent aux illustrations PNG (entrée MANUELLE)

**Demande :** « utilise l'assets suivant pour les motifs de skin pour le lémurien, zébu, crocodile,
ravinala » — le lot `Assets-premiere-version` (PNG RGBA détourés, 512 / 256 / 128 / 64, **non
vectoriels**).

**Décision — deux familles de motifs, jamais les deux à la fois.** Ces quatre motifs ne sont plus des
silhouettes SVG : le catalogue `PION_PATTERNS` leur donne un champ `img` (au lieu de `svg`) et
`mountPionStyles()` génère une variable de plus par motif, `--pion-motif-img` — avec
`--pion-mask: none` (sinon le masque rognerait l'image sur le contour de la silhouette du même nom) et
`--pion-motif-ink: transparent` (aucune encre : l'image porte ses propres couleurs). Le pseudo-élément
`::before` du pion passe de `background` à `background-color` + `background-image:
var(--pion-motif-img, none)` (`center / contain / no-repeat`). Les **cinq** autres motifs (caméléon,
PRA, pangalatra, lefona, `aucun`) gardent leur rendu à l'identique — masque SVG peint à l'encre de la
couleur choisie. Les quatre jeux de variables (moi | adversaire × clair | sombre) reçoivent la variable
jumelle : aperçu, vignettes de la boutique ET plateau consomment toujours les mêmes règles.

**Où vivent les fichiers.** `D-aona/d-aona-web/assets/pions/`, selon la convention des autres assets
(`board/`, `coins/`, `ad/`) : les **256 px** du lot — la taille qui reste nette jusqu'à l'aperçu de
104 px sur un écran à 2,4× de densité — copiés **sans ré-encodage** (SHA-256 identiques, cf. le README
du dossier), renommés sur les `id` du catalogue (`lemur-256.png` → `lemurien.png`), et chargés
seulement quand un élément porte la variable. Aucune table MIME à toucher (`.png` déjà servi).
Les libellés suivent les dessins : le lémurien perd « et sa longue queue » (le fichier est une face,
yeux orange), le crocodile devient « Gueule ouverte du crocodile, dents dehors ».

**Contraste, assumé tel quel.** Le LISEZ-MOI du lot prévient : « les parties sombres peuvent manquer
de contraste sur un pion noir ; aucun contour supplémentaire n'a été ajouté ». Rien n'a été ajouté au
motif ; le lémurien et le zébu étant noir **et** blanc, ils se lisent sur les deux camps (vu en
capture, pions clairs comme sombres).

**Vérifications rejouées, tout vert :** `_pions_verif.js` (nouvelle sonde, port 8095) **33/33, 0 erreur
JS** — les quatre PNG servis en 200 / `image/png` / 256 × 256, quatre coins d'alpha nul et dessin
présent, la peinture par `background-image` **sans masque ni encre** (aperçu + vignette de la carte +
camp clair + camp sombre), la silhouette témoin `lefona` toujours en masque SVG, `aucun` neutralisé
sur les trois couches, les 16 règles image de `#pion-styles`, et la peinture **sur le plateau** en
partie d'entraînement — mon camp ET celui de l'adversaire (attribut `-opp` compris) · `test_ui_scenarios.js S8`
**16/16** (dont « aperçu, vignettes de motif et plateau partagent le même rendu », réécrit pour mesurer
la couche de la famille du motif) · `_check_html.js` OK (6 557 lignes, balises équilibrées).
Captures : `%TEMP%\daona_shots\pions-*.png`.

**Fichiers :** `D-aona/d-aona-web/index.html` (CSS `.pion-view::before` et `.board .piece.*`,
commentaires, `PION_PATTERNS`, `motifImgUri`, `mountPionStyles`), `D-aona/d-aona-web/assets/pions/`
(4 PNG + README), `d-aona-server/_pions_verif.js` (sonde), `d-aona-server/_p10.js`, `_s8_verif.js`,
`_probe_boutique_v1.js`, `test_ui_scenarios.js` (régénéré par `_build.js`),
`D-aona/d-aona-web/README.md`, `CONTEXTE_PROJET.md`.

## 2026-10-03 — Arbitrage S8 INVERSÉ : le tirage au sort redevient un voile plein écran, joué AVANT la partie (entrée MANUELLE)

**Demande :** « l'animation de pile ou face se fait D'ABORD, et montre quel joueur a pile et quelle
personne a face » — option A retenue : la bande non modale du lot S8 (entrée du 2026-09-24, conservée
ci-dessous pour l'historique) est **entièrement retirée**, sans bandeau récapitulatif.

**Correctif.** (1) **Voile plein écran** `#coin-toss` (`role="status"`, `aria-live="polite"`, hors
`#screen-board`) : la pièce de 50 ariary vole **2 s en 3D** (`.coin-air`, deux plans `coin-front` /
`coin-back`, `preserve-3d`), retombe sur la face **tirée**, puis le verdict nomme les **DEUX camps**
(lignes `.ow` : face de chacun d'après `state.toss.choices`, un seul « commence »). Fermeture :
« Commencer », Échap, clic sur le voile, **repli automatique 12 s**. (2) **Reprise sans rejeu** :
`showTossResult({ …, animate:false })` ne montre rien quand le tirage est déjà résolu (rechargement,
reconnexion) ; la garde `_tossShown` est conservée. (3) **Défaut découvert par la sonde `_coin_3d.js`
— corrigé à la source** : une rotation **statique** garde la 3D, mais une rotation **animée** aplatit
le sous-arbre dans Chromium (`filter` / `backdrop-filter` sur un ancêtre font pareil — propriétés « de
groupe ») : la pièce s'immobilisait sur le « 50 » **EN MIROIR** sous un verdict FACE. L'ombre portée
est donc sur les `<img>`, la carte est opaque (plus de `backdrop-filter`), et dès `animationend`
(+ repli 2 150 ms) la classe `.landed` coupe animation et rotation : c'est `display` qui montre le
plan de la face tirée, droite et juste quel que soit le moteur.

**Vérifications rejouées, tout vert :** `_coin_verif.js` **12/12, 0 erreur JS** (P1–P9, dont le
hit-test P9 : le plan rendu au centre porte bien le fichier de la face tirée, non miroité) ·
`_s8_verif.js` **réécrit pour l'arbitrage inversé — 14/14, 0 erreur JS** (voile plein écran et aucune
bannière résiduelle · verdict + deux attributions · **plateau NON cliquable pendant le voile** —
hit-test `elementFromPoint` + clic réel sous la carte · « Commencer » ferme et **le plateau redevient
cliquable** · fermeture automatique 12 s en mobile · **aucun rejeu après rechargement** · cohérence
déterministe : ma face tirée → « commence » sur ma ligne ; face de l'IA → sur la sienne) ·
`_check_html.js` OK · `_verif_jeux_mobile.js` OK (6 appareils) · `_coin_apercu.js` OK.

**Fichiers :** `D-aona/d-aona-web/index.html` (CSS `.coin-toss` / `.coin-air` / `.landed`, HTML
`#coin-toss`, JS `showTossResult` réécrit, `hideCoinToss`, `tossSideOf`, appelants `animate:true/false`),
`d-aona-server/_coin_verif.js` (P1–P9), `d-aona-server/_s8_verif.js` (V1–V6 inversés),
`d-aona-server/_coin_3d.js` (sonde), `d-aona-server/_revue_ui.js` et `_shapes_apply.js` (références
`.toss-banner` retirées), `D-aona/d-aona-web/README.md`, `D-aona/d-aona-web/assets/coins/README.md`.


## 2026-10-03 — Les SKINS appartiennent au JOUEUR, pas à la couleur des pions (fin de la fuite sur les pions de l'adversaire) (entrée MANUELLE)

**Demande :** « les skins doivent être associés au joueur, et non à la couleur des pièces — si A joue les noirs
et B les blancs, chacun doit conserver son propre skin, indépendamment de la couleur qu'il joue ». Modèle
retenu après arbitrage : **deux apparences par joueur** (une par camp), appliquées à **ses** pions selon le camp
que le tirage lui donne — la boutique ne change pas.

**Constat — la fuite, et sa cause exacte.** Le stockage était **déjà** par joueur (`pion_style`, une ligne par
compte et par camp) ; c'est le **rendu** qui ne l'était pas. `applyPionStyles()` n'écrivait que les **deux**
apparences du compte local sur `#fanorona-board` (`data-pion-color` = *ma* couleur claire,
`data-pion-color-dark` = *ma* couleur sombre), et le CSS peignait **par camp, pour tout le monde**
(`.piece.clair` consommait le jeu générique, `.piece.sombre` rebindait les jumelles `-dark`). Dès que
l'adversaire tenait un camp, ses pions héritaient donc de l'apparence que **moi** j'avais réglée pour ce camp —
et depuis la règle « le gagnant prend les clairs », le skin clair que je venais de composer (et qui ne servait
pas à mes propres pions) partait directement sur les siens. Le serveur n'aidait pas : `getState()` ne
transmettait **aucune** apparence.

**Correctif.** (1) **Le plateau porte QUATRE jeux d'apparence** (propriétaire × camp) : les miens
(`--pion-*`, `--pion-*-dark` ; attributs `data-pion-color` / `-dark`, **sens inchangé** pour tout ce qui les
lit) et ceux de l'adversaire (`--pion-*-opp`, `--pion-*-opp-dark` ; attributs `data-pion-color-opp` /
`-opp-dark`) ; `mountPionStyles()` les génère tous les quatre depuis les catalogues, chaque jeu ne recevant que
les couleurs de **son** groupe — l'étanchéité clair/sombre est conservée **pour les deux propriétaires**.
(2) **`.piece.opp` rebinde le jeu adverse** sur les génériques (`.board .piece.opp.clair` / `.opp.sombre`,
spécificité 0,4,0 > 0,3,0) : la recette de rendu reste **unique** (une couleur × un motif), donc l'aperçu de la
boutique ne peut pas mentir sur le plateau, et le repli d'un adversaire sans apparence est le **pion Vato** —
jamais mon skin. (3) **Une seule source de vérité dans le moteur** : `Fanorona.paintPionStyles()` pose les
quatre jeux ; `setPionStyles({ me })` (appelé par la boutique) ne fournit que **mon** apparence et ne touche pas
à celle de l'adversaire ; `quit()` rend le plateau à mon apparence de compte — sans quoi un **spectateur**
gardait sur ses propres pions celle de P1 qu'il venait de regarder. (4) **Le serveur publie les deux
apparences** : `createGameSession()` attache `pionStyles` aux objets joueurs (`PionStyle.get(id)` ; IA sans
compte → `PION_DEFAULTS`), et `getState()` les met dans `player1` / `player2`. C'est la **seule** source
possible pour l'adversaire : un client ne connaît pas le compte d'en face, et un spectateur n'est ni l'un ni
l'autre joueur. `game.js` reste pur — aucune lecture de base côté moteur. (5) **Verrou** : tant qu'une partie
sert ses apparences depuis l'état (`serverStyles`), un passage en boutique ne peut plus les écraser — sinon
l'adversaire y perdait la sienne et le spectateur y gagnait celle du visiteur.

**Ce qui ne change pas.** La boutique (deux camps, `PION_CAMPS.who`, libellés « Pions clairs / sombres »), le
schéma (`pion_style`, **aucune migration**), la règle « le gagnant prend les clairs », la couleur qui suit le
camp du tirage.

**Conséquence assumée :** un adversaire **sans compte** (IA d'entraînement) n'a aucune apparence et reçoit le
pion Vato. En entraînement, on ne voit donc plus son propre skin « clairs » sur les pions de l'IA — c'est le
prix de la règle « les skins appartiennent au joueur ».

**Vérifications rejouées, tout vert :** `_s8_verif.js` **31/31, 0 erreur JS** — dont **neuf nouveaux contrôles
V8** qui posent en base un skin clair **distinctif** (`rouge_clair` + tête de zébu) puis figent le tirage dans
les deux sens : je gagne → mes pions clairs portent **mon** skin, ceux de l'IA (sombres) le pion Vato ;
l'IA gagne → **ses** pions clairs portent le pion Vato, **sans ma couleur ni mon motif** (`backgroundImage`
calculé : `rgb(239, 231, 216)` et masque `none`), mon camp sombre restant au pion Vato. **Preuve de
discrimination** : en neutralisant le rebinding `.board .piece.opp.clair`, ces contrôles **échouent** et
montrent sur les pions de l'adversaire le fond `rgb(249, 124, 114)` (mon rouge) et le masque du zébu — la
fuite décrite, reproduite puis supprimée. `test_scenarios.js` **251/251** (+4 : l'état du match — et celui du
**spectateur** — porte les apparences des **deux** joueurs, différentes l'une de l'autre, et les deux joueurs
reçoivent le **même** état) · `test_ui_scenarios.js` **115/115** · `_coin_verif.js` **12/12** ·
`_check_html.js` OK · `_verif_jeux_mobile.js` OK (6 appareils) · `_revue_ui.js` OK (60 captures, **0** texte
sous AA, **0** débordement, **0** erreur JS). Captures : `graphify-out/revue-ui/S8-apres/couleurs-camp-je-gagne.png`
et `couleurs-camp-ia-gagne.png`. Le harnais S8 nomme désormais la **ressource** de chaque échec réseau
(`requestfailed`) et la **classe par origine** : les fichiers servis par l'application comptent comme des
erreurs, ceux d'un CDN externe (les polices Google — la seule dépendance hors service) sont seulement notés.
C'est ce qui a permis de trancher un échec intermittent : le `ERR_CONNECTION_CLOSED` venait de
`fonts.gstatic.com`, pas du serveur — la page y survit par repli de police, et l'humeur du réseau ne doit pas
décider du verdict d'une vérification du code.

**Fichiers :** `D-aona/d-aona-web/index.html` (CSS `.board .piece.opp.clair` / `.opp.sombre` ; `PION_VAR_SETS`
et `mountPionStyles` ; `applyPionStyles` ; moteur : `pionStyleDefaults`, `normStyles`, `paintPionStyles`,
`setPionStyles`, `applyStatePionStyles`, `localStyles`, `serverStyles`, `quit`, `applyServerState`,
`renderPieces` (commentaire) et l'export `setPionStyles`), `d-aona-server/game.js` (`getState`),
`d-aona-server/server.js` (`createGameSession`), `d-aona-server/_s8_verif.js` (V8, `poserSkinClair`, ressources
nommées), `d-aona-server/test_scenarios.js` (9.3bis + spectateur), `REVUE_UI_UX.md` (§18, addendum),
`D-aona/d-aona-web/README.md`.


## 2026-10-03 — Le gagnant du tirage prend les PIONS CLAIRS : la couleur suit le camp du tirage, plus le point de vue (entrée MANUELLE)

**Demande :** « remplacer le système de tirage au sort PILE/FACE par un système où le gagnant du tirage
prend la couleur claire (Blanc) et commence en premier ». Option A retenue après arbitrage : la couleur
devient **réelle** — le perdant voit ses propres pions en sombre — et non une simple étiquette.

**Constat.** Le gagnant commençait **déjà** : `toss.starter` (game.js L124-130) désigne le camp dont la
face est sortie, et le moteur local faisait de même — rien à changer de ce côté. En revanche la couleur
était purement **POV** : `renderPieces()` posait `.piece.me` / `.piece.opp` d'après `v === meVal()`, et
le CSS peignait `.piece.me` en clair et `.piece.opp` en sombre, si bien que **chaque joueur voyait
toujours ses propres pions en clair**, quel que fût le tirage. « Le gagnant prend les clairs » était donc
invérifiable à l'écran.

**Correctif.** (1) **Une seule source de vérité** : `campOf(v)` (Fanorona) rend
`v === G.toss.starter ? "clair" : "sombre"` — le gagnant est clair ; tant que le tirage n'est pas résolu
(phase « choose », reprise avant tirage), repli sur l'ancien POV pour que le plateau garde un repère.
(2) **Le CSS peint le CAMP** : `.piece.clair` / `.piece.sombre` portent les recettes (et
`.board .piece.sombre` rebinde les variables `-dark`) ; `.me` / `.opp` restent posés par `renderPieces()`
— ils disent **à qui** est le pion, ne peignent plus, et les sondes qui les comptent restent valides.
(3) **Repeint au bon moment** : `chooseSide()` appelle `renderPieces()` **avant** `updateAll()` (les
classes d'état `.playable` se posent sur les pions existants) ; le chemin serveur re-rendait déjà à
chaque état reçu. (4) **Repère obligatoire rendu au joueur** : pastilles `#hud-me-camp` /
`#hud-opp-camp` (`updateCamps()`) dans les deux barres — sans elles, un joueur à qui le tirage n'a pas
donné les clairs ne reconnaîtrait plus ses pions ; jetons de `.turn-flag` (`--muted` sur `--panel-3` :
4,77:1 jour, 5,13:1 nuit — AA). (5) Le **voile du tirage** nomme le camp de chaque ligne
(« pions clairs » sur la ligne gagnante) via `.ow-camp`. (6) `PION_CAMPS.who` (client **et** `data.js`)
parle des **camps** — « le camp clair — celui qui commence » / « le camp sombre » — au lieu de « vos
pions / les pions de l'adversaire » ; les `label` « Pions clairs / sombres » ne changent pas.

**Conséquence assumée, désormais écrite dans la boutique :** l'apparence réglée pour le camp clair peut
habiller **l'adversaire** quand c'est lui qui gagne le tirage — un compte habille les deux camps, et le
libellé le dit.

> **Périmé le jour même — voir l'entrée suivante.** « Un compte habille les deux camps » était vrai *tant que
> le plateau ne portait que les deux apparences du compte local*. Depuis la correction « les skins appartiennent
> au joueur », l'apparence réglée pour un camp n'habille plus que **mes** pions : l'adversaire garde la sienne,
> transmise par l'état du match.

**Vérifications rejouées, tout vert :** `_s8_verif.js` **22/22, 0 erreur JS** — dont les **2 nouveaux
contrôles V7** en déterministe : aléa 0.1 → je gagne → **22 `.piece.me.clair` / 22 `.piece.opp.sombre`** ;
aléa 0.9 → l'IA gagne → **0 pion clair chez moi / 20 sombres** (elle a déjà pris, l'attente du harnais
laisse son coup passer) et **22 clairs chez elle** · « aucun pion ne porte la couleur de l'autre camp » ·
pastilles « CLAIRS » / « SOMBRES » dans les deux barres · le gagnant annoncé « pions clairs » ·
`_coin_verif.js` **12/12** (P2bis : les deux lignes nomment leur camp, le gagnant est le camp clair) ·
`test_scenarios.js` **247/247** · `test_ui_scenarios.js` **115/115** · `_check_html.js` OK ·
`_verif_jeux_mobile.js` OK (6 appareils) · `_revue_ui.js` OK (60 captures, **0** texte sous AA, **0**
débordement ; la pastille n'entre pas dans les cibles tactiles) · `_coin_3d.js` et `_coin_apercu.js` OK.
Captures : `graphify-out/revue-ui/S8-apres/couleurs-camp-je-gagne.png` et
`couleurs-camp-ia-gagne.png` (les deux issues, plateau et barres visibles).

**Fichiers :** `D-aona/d-aona-web/index.html` (CSS `.piece.clair` / `.piece.sombre` / `.pb-camp` /
`.ow-camp`, HTML des deux barres, JS `campOf`, `campLabel`, `renderPieces`, `chooseSide`, `updateCamps`,
`showTossResult`, textes des règles et de la modale de choix, `PION_CAMPS.who`),
`d-aona-server/data.js` (`PION_CAMPS.who` + commentaires), `d-aona-server/_s8_verif.js` (V7 + captures),
`d-aona-server/_coin_verif.js` (P2bis), `REVUE_UI_UX.md` (§18, addendum), `D-aona/d-aona-web/README.md`.

**Aucune modification serveur :** `toss.starter` était déjà exposé par `getState()` — la couleur se
déduit de l'état existant.


## 2026-09-24 — Lot S8 appliqué : les deux arbitrages éditoriaux sont tranchés — le tirage au sort n'est plus une modale (file S1→S8 terminée)

**Demande :** « sur la partie à trancher, lequel serait le plus pertinent ? » puis « continue jusqu'à la
fin et finalise tout et fix ». Les deux points laissés ouverts par la revue (§5/§18) ne relevaient pas de
la conformité mais d'un **choix d'interaction** ; ils sont tranchés ici.

**Décision argumentée.** 1) **Le tirage au sort — retenu, appliqué** : il touche **chaque partie, au
démarrage**, et sa modale plein écran masquait le plateau au moment où le joueur doit regarder sa
position ; preuve la plus objective de la gêne, l'outil de revue devait **explicitement la refermer**
pour photographier l'échiquier. 2) **Les en-têtes du Classement — constat rectifié, rien à corriger** :
vérification faite au code, `badgeChip()` (badge d'appartenance, avec son nom) et `medalFor()` (🥇🥈🥉
des rangs 1 à 3) affichent **deux informations différentes** — ce n'était pas un doublon — et les quatre
colonnes ont un libellé, y compris pour les lecteurs d'écran (`aria-label="Position"`, « Joueur »,
« Elo », médaille avec `aria-label` + `title`). Le constat initial était une erreur de lecture de la
capture ; le §5 du rapport porte la rectification.

**Correctif.** (1) **Bande non modale** `.toss-banner` au-dessus du plateau : pièce de 44 px + phrase
complète, `role="status"` + `aria-live="polite"`, **effacement automatique à 7 s** ou bouton nommé
« Masquer le résultat du tirage » — plus aucun voile ; le **choix PILE / FACE** reste modal (c'est une
décision du joueur). `showTossResult()` ne passe plus par `showModal`, et `App.hideTossBanner` est exposé.
(2) **Défaut découvert en vérifiant le tirage — corrigé à la source** : le suivi temporel du test a montré
**42 pions au lieu de 44** à l'arrivée de mon tour alors que l'annonce disait « Vous (Noir) joue en
premier ». Cause : le moteur local posait `starter: 1` **en dur** (`index.html`), quand le moteur du
serveur calcule le vrai camp qui commence (`game.js` : `this.starter = this.choices[1] === this.tossSide
? 1 : 2`) ; l'annonce lisant ce champ, elle disait « Vous » **quelle que soit la face sortie**, pendant que
l'IA jouait son coup. `toss.starter` porte désormais le **camp qui commence réellement**, comme côté
serveur.

**Vérification fonctionnelle — 12/12, 0 erreur JavaScript** (`_s8_verif.js`, port 8093, base jetable, clics
réels) : aucune modale au tirage · annonce complète (700×58 px, 362 px à 390, `role=status`) · **le plateau
est cliquable pendant l'annonce** (42 pions, la zone de jeu reçoit le clic → 1 pièce sélectionnée) · la
bande s'insère au-dessus sans pousser le plateau hors de l'écran · ✕ masque · **effacement automatique à
7 s** · **cohérence annonce ↔ plateau** en déterministe (`Math.random` figé) : ma face → « Vous » + **44
pions** + tour immédiat ; face de l'IA → « IA — Antso (Blanc) » + **42 pions** + tour après 1,6 s.

**Mesure.** La campagne gagne une capture par contexte (`__plateau-tirage` : bande visible + plateau
entier) — **54 captures** ; `capturerPlateau()` ne ferme plus une modale mais la bande. Indicateurs :
417 segments, **0 non-conformité AA**, 0 débordement, 0 bouton anonyme, 0 erreur JS.

**Fichiers :** `D-aona/d-aona-web/index.html` (CSS `.toss-banner`, HTML `#toss-banner`, JS
`showTossResult`/`hideTossBanner`, `toss.starter`), `REVUE_UI_UX.md` (§18, §5 rectifié, conclusion),
`d-aona-server/_s8_verif.js` (outil jetable), `d-aona-server/_revue_ui.js` (campagne), preuves
`graphify-out/revue-ui/S8-avant` et `S8-apres`.


## 2026-09-23 — Lot S7 appliqué : dernier lot de la revue — gabarits, clavier, surfaces de nuit (file S1→S7 terminée)

**Demande :** septième et dernier lot correctif du §9 — les **gabarits** : marge basse du Classement
(§4.4), six tuiles pour quatre valeurs (§4.5), barre haute mobile sur deux lignes, pastilles étirées,
séparation des surfaces en nuit (points du §5) — **plus** les **cliquables inatteignables au clavier**
relevés par le lot S6 (constat neuf, hors revue).

**Périmètre relevé AVANT toute modification** (`node _s7_probe.js` → `S7-avant/releve-geometrie.txt`) :
**236 cliquables non focusables** sur les 36 écrans (2 à 31 par écran), **2 pastilles étirées**,
**barre haute à 107 px sur 2 lignes** en 390 px et 360 px, surfaces de nuit `--panel/--bg` à **1,06:1**.

**Correctifs.** (1) **Surfaces de nuit** : échelle relevée d'un cran —
`--panel` `#0A0A0C → #0E0E12`, `--panel-2` `#101014 → #18181F`, `--panel-3` `#15151b → #1F1F28`, soit
**1,06 / 1,11 / 1,15:1 → 1,09 / 1,19 / 1,28:1** du fond noir (et `--panel-2/--panel` 1,04 → 1,09), plus
un voile clair sur les tuiles du héro de nuit (1,04 → 1,10:1) ; le noir OLED reste pur en fond et
`--muted` garde 4,57:1 sur la surface la plus claire. (2) **Accueil** : six tuiles → **trois** (Parties jouées · Victoires · Solde wallet) ; le montant
en Ariary se réduit avec la largeur (`clamp`) au lieu de déborder. (3) **Pastilles étirées** :
`align-self: flex-start` sur la pastille du héro et celle du Profil. (4) **Barre haute mobile** :
**50 px sur une ligne** — nom de l'application masqué (il reste dans le logo, les titres d'écran et
l'onglet), pastille KYC réduite à sa coche (intitulé complet en infobulle, nom accessible et écran
Profil), contrôles resserrés, pastille wallet tronquable. (5) **Avatars du podium** : le podium affiche
le même avatar que la table voisine. (6) **Clavier** : `rendreCliquablesFocusables()` pose
`role="button"` + `tabindex="0"` + nom accessible (infobulle ou texte) sur les cibles non natives
*porteuses d'un `onclick`*, `activerAuClavier()` déclenche Entrée/Espace **sur le même gestionnaire**
(aucun `onclick` dupliqué), un `MutationObserver` borné (une fois par image) couvre les rendus
successifs, et un anneau de focus rend la position visible. (7) **Deux encres ont suivi le relèvement des
surfaces**, attrapées par la campagne du lot : le **bronze** du badge (`#b0703c → #bc7a44`, 4,46 → 5,1:1
en nuit — dans **les deux inventaires**, client et `data.js` serveur) et l'**horodatage des bulles de mes
messages** (`--muted → --text`, 4,39 → 5,8:1 nuit, 7,5:1 jour).

**Preuve géométrique** (sonde dédiée, 36 écrans, 4 gabarits) : cliquables non focusables **236 → 0** ·
pastilles étirées **2 → 0** · barre haute mobile **107 px / 2 lignes → 50 px / 1 ligne** ·
recouvrements 0 → 0 · fins de course coupées 0 → 0 · cliquables sans nom 0 → 0 · erreurs JS 0.

**Nuance qui compte (§4.4).** La sonde **scrolle chaque zone jusqu'en bas avant de mesurer** : à cette
position, **aucun** contenu n'était recouvert par la barre d'onglets, ni avant ni après — le constat tel
que décrit **ne reproduit pas** (la capture montrait une ligne sous la ligne de flottaison, comportement
normal d'une liste qui défile). Le contrôle dédié `_s7_fin.js` a en revanche trouvé **deux zones finissant
sans air** (0 px sur Amis, −1 px sur la colonne Boutique du Profil) : une réserve de **16 px** en bas des
colonnes défilantes les corrige (**0** zone à moins de 12 px d'air sur **40** relevées).

**Mesure** (campagne complète, 36 écrans, avant/après) : **0 → 0** non-conformité AA (417 segments),
**65 → 65** cibles < 24 px, 0 erreur JS, 0 débordement, 0 bouton anonyme, **aucun écran en hausse**.
Segments **416 → 417** (+1) — tracé écran par écran dans `segments-par-ecran.txt`.

**Contrôles.** `node _check_html.js` OK · `node test_ui_scenarios.js` **110/110** (premier passage : 109/110,
seul le scénario SX en échec à cause de ressources **externes** injoignables — `ERR_INTERNET_DISCONNECTED`
sur les polices Google ; SX rejoué seul : **3/3**, réseau revenu — hoquet réseau, pas une régression) ·
`node test_scenarios.js` **226/226** (le lot touche `data.js`) · contrôle visuel (`desktop-jour__ranks`,
`mobile-360__home`, `desktop-nuit__home`, `fin-mobile-390__ranks`).

**Preuves.** `graphify-out/revue-ui/S7-avant/` (57 fichiers) et `S7-apres/` (**79**) — 53 captures,
mesures, `comparaison.txt`, `segments-par-ecran.txt`, `releve-geometrie.txt` (deux passes de la sonde),
`fin-de-course.txt` + 16 captures « défilé jusqu'en bas », `etat-final.txt`, `defauts-identifies-mi-lot.txt`
(les 2 écarts transitoires). Outils : `_s7_probe.js`, `_s7_fin.js`, `_s5_seg.js`. Rapport : `REVUE_UI_UX.md`
**§17**.

**Reste ouvert (deux arbitrages éditoriaux, aucun défaut de conformité) :** le **tirage au sort** (la modale
masque le plateau au moment où le joueur doit le regarder — une bande non modale serait plus juste) et les
**en-têtes du Classement** (colonne « # » et colonne de fin sans libellé, badge affiché deux fois). Soldés
par ce lot : **§4.4**, **§4.5** et cinq points du **§5** — pastilles étirées, barre haute mobile,
séparation des surfaces en nuit, avatars du podium, et 236 → 0 cliquables rendus au clavier. **La file
S1→S7 est terminée.**

> **Suivi (24/09/2026) :** ces deux arbitrages sont depuis **tranchés** — voir l'entrée « Lot S8 » ci-dessus
> et le **§18** du rapport. Le tirage au sort est appliqué (bande non modale) ; les en-têtes du Classement
> se sont révélés **bien conformes** (constat rectifié, aucune modification).


## 2026-09-23 — Lot S6 appliqué : comportements et noms accessibles (HUD IA, dépôt, chevron, 8 champs)

**Demande :** sixième lot correctif du §9 de la revue — les **comportements** et le **balisage
accessible** : HUD de l'entraînement IA (§4.2), récapitulation du dépôt (§4.3), chevron trompeur
des lignes d'opérateur (§5), noms accessibles des champs (§4.9).

**Périmètre relevé AVANT toute modification** (`node _s6_scope.js` → `S6-avant/perimetre.txt`) :
**20 champs** dans le balisage dont **8 sans nom accessible** (le rapport en annonçait 3), les
**valeurs de maquette** du HUD (`>TR<`, `>1126 Elo<`), les **3 lignes figées** de la récapitulation
du dépôt, les **chevrons** des lignes d'opérateur, et — constat **nouveau**, hors revue — **12
éléments cliquables non focusables** (`span.avatar`, `span.link-pseudo`, `div.panel`… porteurs
d'`onclick`).

**Correctifs.** (1) **HUD du plateau** : `fillHudMe(pseudo, elo)` devient le **seul** point de
remplissage et il est appelé par **les trois flux** — partie serveur (`startServerGame`),
**entraînement contre l'IA** (`launchGame`, qui ne passait jamais par lui : c'était la cause) et
**mode spectateur** ; le balisage ne porte plus de valeurs de maquette (`—`). (2) **Récapitulation du
dépôt** : la règle du serveur (`Wallet.credit(user.id, payload.amount)` — le wallet reçoit le montant
exact, les frais vont à l'opérateur) devient lisible à l'écran : « Montant du dépôt » + « Frais
opérateur estimés (~2%) » = « **Total à payer chez l'opérateur** », puis « Crédité sur votre wallet »,
avec une phrase d'explication ; `refreshChips()` recalcule **les quatre lignes** à chaque changement
de pastille **ou** d'opérateur (avant, l'écran annonçait la valeur d'ouverture alors que c'est la
pastille choisie qui partait au serveur). (3) **Chevron → coche** : la ligne d'opérateur
**sélectionne**, elle ne navigue pas ; la coche n'apparaît que sur la ligne active, et l'état passe
aussi par `aria-pressed` pour les technologies d'assistance. (4) **8 champs nommés** : `#wd-phone`,
`#wd-amount`, `#avatar-input` (ceux du rapport) **plus** `#province-select`, `#chat-field`, le champ
de la fenêtre de chat flottante, `#sp-motif` et `#sp-msg` — `label for` ou `aria-label`, avec le nom
qui dit **à qui** on écrit pour les deux champs de chat. (5) **Pastilles de montant** : `div`
cliquables → **boutons** dans un groupe `role="group"` étiqueté « Montant (Ariary) ».

**Vérification fonctionnelle** (`node _s6_verif.js`, port 8094, base copiée puis supprimée) : **11/11**
contrôles, **0 erreur JavaScript** — audit des champs **réellement montés** (écrans + 3 modales) :
**116 nommés / 116** ; HUD IA : « ZzRevueUI » · « 1100 Elo » · avatar « ZZ » ; récapitulatif :
5 000 + 100 = **5 100** crédité **5 000**, puis 50 000 + 1 000 = **51 000** crédité **50 000** (il
**suit** la pastille) ; pastilles : 6 boutons, `aria-pressed` cohérent ; opérateurs : 3 boutons, **une
seule coche** ; **dépôt réel par l'interface : solde 150 000 → 155 000, +5 000 Ar exactement** ;
modale vérifiée aussi à **390 px**.

**Mesure** (campagne complète, 36 écrans, avant/après) : **416 → 416** segments de texte,
**0 → 0** non-conformité AA, **65 → 65** cibles < 24 px, 0 erreur JS, 0 débordement, 0 bouton
anonyme, **aucun écran en hausse**. Ce lot ne change ni teinte, ni taille, ni gabarit : le compteur
ne bouge pas, c'est attendu.

**Contrôles.** `node _check_html.js` OK · `node test_ui_scenarios.js` **110/110** (les pastilles
devenues boutons ne cassent aucun parcours) · contrôle visuel avant/après (`desktop-jour__plateau-ia`,
`etat__wallet-depot`) · `test_scenarios.js` non rejoué, le serveur n'a pas été touché.

**Preuves.** `graphify-out/revue-ui/S6-avant/` (57 fichiers) et `S6-apres/` (60) — 53 captures,
mesures, `comparaison.txt`, journal de campagne, `perimetre.txt` (relevé avant correction) et
`verification-fonctionnelle.txt` (les 11 contrôles). Rapport détaillé : `REVUE_UI_UX.md` **§16**.

**Reste ouvert.** **S7** (gabarits : marge basse du Classement et du bouton flottant, barre haute
mobile sur deux lignes, pastilles étirées, séparation des surfaces en nuit) et le constat nouveau des
**12 cliquables non focusables**, consigné mais non corrigé. Soldés par ce lot : **§4.2**, **§4.3**,
**§4.9** et le point « chevron » du **§5**. Aucun écart de contraste : le §3 reste clos.


## 2026-09-23 — Lot S5 appliqué : les contenus internes sortent de l'interface (15 sites « PRD § », 3 états vides)

**Demande :** cinquième lot correctif du §9 de la revue — les **contenus** : les références internes
« PRD §x.y » (§4.1), l'état vide de l'Accueil (§4.6), « Tournoi introuvable » (§4.7), le compteur de
contacts tronqués et le doublon « Ar » de la pastille wallet (§5).

**Périmètre relevé AVANT toute modification** (`node _s5_inv.js`) : la chaîne « PRD » apparaît
**16 fois** dans `index.html` — **15 emplacements visibles** et **1 commentaire de code** (barème du
cashprice, conservé).

**Correctifs.** (1) **Les 15 sites visibles** : parenthèse retirée ou titre réduit au bénéfice joueur
(« Répartition du cashprice », « Règles du wallet », « Boutique — Skins ») ; l'entraînement IA gagne
l'information dans **sa propre description** : « Accessible sans KYC. Difficulté plafonnée — aucun
impact Elo ni wallet. » (2) **État vide de l'Accueil** : il monte le gabarit exemplaire de Match
(icône œil, titre, phrase, bouton **« Trouver un adversaire »**) et **se centre verticalement** dans
la zone de défilement (`body.is-fill .hg-scroll > .mt-state { height: 100%; justify-content: center }`).
(3) **« Tournoi introuvable »** : même gabarit (icône d'alerte, phrase qui dit où sont les tournois
ouverts, bouton **« Revenir aux tournois »**) ; le bouton appelle `App.backToTournaments()`, qui
**ouvre l'onglet Tournois** de l'écran Match. (4) **Compteur de contacts** : « **4 sur 5** contact(s) »
tant que la liste est repliée — il dit ce qui est affiché. (5) **Pastille wallet** : l'unité n'est
plus portée que par l'icône (le montant passe à `fmtNum`), donc plus de « Ar … Ar ».

**Une vérification que la campagne ne savait pas faire : le clic.** La sonde de revue mesure,
photographie et relève les erreurs JS, mais **ne clique pas** : un état vide dont le bouton ne mène
nulle part resterait vert. Outil jetable `_s5_verif.js` (port 8094, base copiée puis supprimée) —
**24/24 contrôles réussis, 0 erreur JavaScript** : bouton de l'Accueil → `#/match` ; « Revenir aux
tournois » → onglet Tournois actif (`aria-selected="true"`, panneau rendu) **en 1440 px et en 390 px** ;
**19 relevés du texte visible de 14 écrans : aucun « PRD § »** ; pastille wallet : un seul « Ar ».

**Mesure** — campagne complète avant/après, même outil : non-conformités AA **0 → 0** (les textes
neufs sont conformes) ; segments **410 → 416** — traçable capture par capture (`node _s5_seg.js`) :
**+1 segment** sur les 2 captures de l'Accueil et les 4 du Tournoi, parce que l'état vide passe d'un
paragraphe gris à un trio titre / phrase / bouton. C'est le seul lot dont le compteur **monte** — et
il monte parce que l'interface dit maintenant quelque chose au joueur. Cibles < 24 px **65 → 65** ;
**0 erreur JS · 0 débordement · 0 bouton anonyme**.

**Notes honnêtes consignées.** (1) Les textes neufs restent en `--muted` : la teinte du jour et celle
de la nuit ayant été corrigées (§11 et §13), ils n'ajoutent aucun écart. (2) Le HUD de l'entraînement
IA (§4.2), la récapitulation du dépôt (§4.3), le chevron trompeur et les 3 champs sans nom accessible
(§4.9) ne sont pas dans ce lot : ce sont des comportements et du balisage → **S6**. (3) La note de
pied de la scène « Bon retour » (« Maquette de démonstration — D-aôna PRD v1.2… ») est **conservée
volontairement** : elle annonce la version de la maquette à un lecteur externe, elle ne renvoie à
aucune section interne.

**Vérifications :** `_check_html.js` OK · `test_ui_scenarios.js` **110/110** · `_s5_verif.js`
**24/24** · contrôle visuel avant/après (Accueil et Tournoi, desktop et mobile).

**Preuves :** `graphify-out/revue-ui/S5-avant|S5-apres/` (53 captures, `mesures.txt`,
`mesures.json`, `comparaison.txt`, journaux de campagne, `verif-mobile-etat-vide.png`). Rapport :
`REVUE_UI_UX.md` **§15** ; les points **§4.1**, **§4.6**, **§4.7** et deux points du **§5** sont soldés.

**Reste ouvert :** lots **S6** (comportements) et **S7** (gabarits) — aucun écart de contraste.


## 2026-09-23 — Lot S4 appliqué : tailles et cibles tactiles (cibles < 24 px : 77 → 65 ; contraste toujours à 0)

**Demande :** quatrième lot correctif du §9 de la revue : les tailles — horodatages du chat
(§4.10) et zone cliquable des pastilles de pagination de l'écran Jeux (§4.8, WCAG 2.2 §2.5.8).

**Périmètre relevé AVANT toute modification** (`node _s4_cibles.js`, baseline = état après S3) :
**77 cibles tactiles < 24 px** sur les 36 écrans — `button.pg-dot` (9×9 ; 30×9 pour l'active) et
des liens de pseudo **en ligne** (16–22 px, exception WCAG « cible en ligne », non retenus).

**Correctifs.** (1) **Pastilles de pagination** : le dessin ne bouge pas (9 px ; 30 px pour
l'active), il est désormais tracé par un pseudo-élément au centre d'une **boîte cliquable de
24×24 px**, et le `gap` passe de 9 px à 0 — l'**exception d'espacement** de la WCAG ne
s'appliquait pas (avec 9 px d'écart, les cercles de 24 px centrés sur chaque pastille se
recouvrent). Le sélecteur du mode « mouvement réduit » suit (`.pg-dot` → `.pg-dot::before`).
(2) **Horodatages du chat** (`span.at`, écran Messagerie) : 10 → **11 px**. (3) **Fenêtre de chat
flottante** : 9,5 px **et `opacity: .6`** → **11 px sans opacité**.

**Un défaut que la campagne ne voyait pas (consigné exprès).** La fenêtre de chat flottante n'est
pas l'un des 36 écrans capturés : son horodatage à 60 % d'opacité n'apparaissait dans aucun relevé,
donc le « 0 » du lot S3 ne couvrait pas cette surface. Calculateur dédié (`node _s4_pop.js`,
composition alpha comme le navigateur) : `.them` **3,18 → 9,01:1** (jour) et **3,30 → 7,16:1**
(nuit) ; `.me` **3,03 → 5,50:1** (jour) et **2,74 → 4,78:1** (nuit).

**Mesure** — campagne complète avant/après, même outil : cibles < 24 px **77 → 65** (`pg-dot`
9 → 0, `pg-dot.active` 3 → 0) ; non-conformités AA **0 → 0** (aucune régression) ; segments
411 → 410 (l'horodatage passé à 11 px sort de la clé de déduplication — vérifié stable sur deux
campagnes) ; **0 erreur JS · 0 débordement · 0 bouton anonyme** ; **aucun écran en hausse**. Les
65 relevés restants sont les **liens de pseudo en ligne**. Les micro-libellés en capitales à
10–10,5 px (`.logo-tag`, `.k` de statistiques, en-têtes de tables) ne sont pas touchés : famille
typographique distincte, mesurée conforme sur les 36 écrans.

**Vérifications :** `_check_html.js` OK · `test_ui_scenarios.js` **110/110** · contrôle visuel
avant/après (points de pagination identiques à l'œil — seul le confort de clic change).

**Preuves :** `graphify-out/revue-ui/S4-avant|S4-apres/` (53 captures, mesures, `comparaison.txt`,
`perimetre-cibles.txt`, deux journaux de campagne, `contraste-pop.txt`). Rapport : `REVUE_UI_UX.md`
**§14** ; les points §4.8 et §4.10 sont soldés.

**Reste ouvert :** lots S5 (contenus), S6 (comportements), S7 (gabarits) — aucun écart de contraste.


## 2026-09-23 — Lot S3 appliqué : le contraste AA est réglé (67 → 0 ; cumulé 139 → 0)

**Demande :** dernier lot de la famille « contraste » de la revue — les cinq encres restantes
listées au §12 du rapport : `--brand-2` en texte (31 relevés), `--muted` jour (30), `.chip.on` (4),
initiales d'avatar vertes (1), `--brand` nuit (1).

**Périmètre relevé AVANT toute modification** (`node _s2_scope.js S3-avant`) : 5 encres,
**14 éléments distincts**, 67 relevés. Relevé complémentaire (`_s3_grep.js`) : les 16 emplacements
où un jeton de marque sert d'encre de texte.

**Correctifs.** (1) Nouveau jeton **`--brand-ink`** (« encre de marque ») séparé de **`--brand-2`**
(« décor ») : `#0A6B4C` en jour, `#2BA37E` en nuit — appliqué à `.pos`, `.pill.green`,
`.wallet-chip .wc-ic`, `.kyc-badge.ok`, `.turn-flag.on`, `.br-slot.win`, `.amt-chip.on`,
`.avatar.av-g`, `.kpi .v`, `.chat-pop .cp-input button`, `.logo-name em`, `.help-state`, `#hint`,
étapes KYC « ✓ », mention « Non lu ». (2) `--muted` **jour** `#6B6E80 → #5C5F72` : le seuil n'était
franchi que sur les surfaces teintées (4,23:1 sur `--panel-2`). (3) `.chip.on` **jour** : fond
`--brand-ink` + encre blanche (6,5:1) — l'encre sombre plafonnait à 4,33:1 sur un fond trop clair ;
le thème nuit est inchangé. Aucune teinte de marque n'est perdue : elles restent les teintes de
**fond**, bordure et dégradé.

**Mesure** — campagne complète avant/après (même outil, 36 écrans, 411 segments) : **67 → 0**.
Par famille : `#0F8A64` 31 → 0 · `#6B6E80` 30 → 0 · `#04150E` 4 → 0 · `#15803D` 1 → 0 ·
`#17825F` 1 → 0. **Aucun écran en hausse** (25 jour/mobile + 11 nuit). **Aucune non-conformité AA
ne subsiste.**

**Vérifications :** `_check_html.js` OK · `test_ui_scenarios.js` **110/110** · 0 erreur JS ·
0 débordement · 0 bouton anonyme · contrôle visuel avant/après (Classement, Accueil).

**Preuves :** `graphify-out/revue-ui/S3-avant|S3-apres/` (53 captures, mesures, comparaison,
périmètre, relevé des encres). Rapport : `REVUE_UI_UX.md` **§13** ; cumul **139 → 99 → 67 → 0**.

**Reste ouvert :** lots S4 (tailles), S5 (contenus), S6 (comportements), S7 (gabarits) — aucun ne
porte d'écart de contraste.

## 2026-09-23 — Lot S2 appliqué : encres dédiées (badges de rang, prix, pastilles de type, titres de boutique) — 32 non-conformités réparées (99 → 67)

**Demande :** deuxième lot correctif de la revue, celui que le rapport place en priorité après S1 :
les écarts les plus graves (**1,86 – 3,66:1**), à réparer par des **encres dédiées** plutôt qu'en
touchant aux teintes de marque (§7), et sans demi-mesure sur les fonds.

**Périmètre relevé AVANT toute modification** (`_s2_scope.js`, sur la baseline = état après S1) :
**13 éléments distincts** — 4 en ambre (prix 2,67 · pastilles `.light` 2,38 / 2,59 · titre boutique
3,19), 5 en bleu (pastilles `.dark` 2,30 / 2,51 · badge Totakely 2,93 · titre 3,18), et la paire
badge + emoji des badges **or (1,86)**, argent (2,40) et bronze (3,66).

**Correctifs.** (1) **Badges de rang** : le catalogue `BADGES` porte désormais une **encre par
thème** (`color` = teinte décorative, qui sert d'encre la nuit ≈ 9:1 sur le noir ; `ink` = encre du
thème jour), et la couleur ne passe plus par un style en ligne mais par les variables CSS
`--b-ink` / `--b-ink-day` posées en ligne — une encre en ligne ne peut pas dépendre du thème, la
règle de thème choisit. (2) **Prix de la boutique** (`.skin-card .amber`) → `#92400e`, la convention
que `.pill.amber` utilisait déjà en mode clair. (3) **Pastilles de type** `.pill.light` / `.pill.dark`
et **titres de section** `.skin-group-title.light` / `.dark` → `#92400e` / `#05507f`. Le **thème
nuit n'est pas touché** : ses teintes claires y donnent 6,3 à 8,7:1.

**Correction en deux temps (consignée exprès).** La première encre bleue retenue (`#0369a1`)
mesurait **4,29:1** sur la teinte *réelle* de la pastille (`#D4DBF1` — `--blue-soft` posé sur une
carte grise — et non le `#E0F2FE` du jeton) : la campagne l'a rattrapée, l'encre est passée à
`#05507f` (**6,18:1** sur ce même fond) et la campagne rejouée. Illustration directe du §7
(« valeurs indicatives ») : la sonde tranche, pas le calcul sur le jeton.

**Preuve.** Campagne complète avant/après, même outil, classement par encre : **99 → 67**, soit
**32 relevés réparés** — exactement le delta. Cinq familles tombent à zéro (`--blue` jour 18,
`--amber` jour 8, badges or / argent / bronze 2+2+2) et **aucun écran en hausse** sur les 25 écrans
jour / mobile (Classement 12 → 4, Profil 17 → 8, mobile 5 → 3) ; les écrans de nuit restent conformes,
hors la ligne `--brand` (lot S3). Toujours **0 erreur JavaScript, 0 débordement, 0 bouton anonyme**.

**Note de méthode.** La sonde remonte au plus **14 lignes fautives par écran** : après correction,
des lignes masquées réapparaissent, si bien qu'une famille peut **monter** alors que le total baisse
(`--muted` jour 26 → 30, `.chip.on` 2 → 4 — familles S3 intactes). Le tableau par famille est un
**plancher** ; la preuve d'un lot est le **total** + les familles **tombées à zéro**.

**Fichiers.** *Modifié :* `D-aona/d-aona-web/index.html` — bloc « encres dédiées » du mode clair
(l. 101-110), règle d'encre du badge (l. 1724-1730), catalogue `BADGES` (+`ink`) et les 3 sites de
rendu (variables CSS au lieu de la couleur en ligne). *Ajouté (jetable, hors git) :* `_s2_scope.js`
(périmètre d'un lot : liste les éléments fautifs par encre). *Généralisé :* `_s1_compare.js` prend
le dossier de baseline en argument (`node _s1_compare.js S2-avant`). *Documentation :*
`REVUE_UI_UX.md` §12 + renvoi de méthode au §11 et mise à jour du §9.

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé, syntaxe du script en ligne
validée) · `node test_ui_scenarios.js` **110/110** · contrôle visuel des captures jour avant/après
(boutique : prix, pastilles, titres ; Classement : les quatre badges affichés) · `test_scenarios.js`
non rejoué : le serveur n'a pas été touché. Preuves : `graphify-out/revue-ui/S2-avant/` (baseline) et
`S2-apres/` (53 captures, `mesures.txt`, `mesures.json`, journaux de campagne, `comparaison.txt`,
`perimetre.txt`).

**Reste ouvert (lot S3).** `--brand-2` (31 : pastille wallet de la barre haute, « Gratuit », initiales
d'avatar), `--muted` jour (30 : pastilles génériques, chips de filtre, libellés de tuiles, horodatages
10 px), `.chip.on` (4), initiales vertes (1), `--brand` nuit (1) — soit **67 non-conformités**.

## 2026-09-23 — Lot S1 appliqué : le jeton `--muted` du thème nuit répare 40 non-conformités AA (139 → 99)

**Demande :** poursuivre la revue par le premier lot correctif — **S1, les jetons du thème nuit** —
en respectant le protocole que le rapport s'est fixé : sonde de contraste d'abord, puis tests, puis
re-mesure complète (avant / après) et re-capture ciblée.

**Constat confirmé par la mesure.** En thème nuit, `--muted: #5E6072` mesurait **3,20:1** sur
`--panel` (`#0A0A0C`) et **2,94:1** sur `--panel-3` : tous les libellés secondaires et les titres de
panneaux étaient sous le seuil AA 4,5:1. Vérification préalable : le jeton n'est **lu par aucun
script** (66 usages, tous en CSS) — le correctif est donc **une seule ligne de CSS**, sans effet de
bord possible sur la logique. Le fichier portait déjà deux contournements écrits pour ce défaut
(« en `--text`, pas `--muted` (AA la nuit) », l. 1407 ; « la charte nuit ne donne que 3,1:1 avec
`--muted` », l. 1613) : ils restent valides et ne sont pas rétablis (ce serait un autre lot visuel).

**Calibration par la sonde, pas à l'intuition.** Les ratios ont été calculés sur **toute l'échelle
des surfaces de nuit** (panneaux, voiles de blanc, teintes de marque). `#85879A` mesure **5,59:1**
sur `--panel`, 5,36:1 sur `--panel-2`, 5,13:1 sur `--panel-3`, 4,59:1 sur un voile de blanc à 9 % et
**4,53:1** sur `--green-soft` — conforme partout. C'est la valeur **la plus sombre qui passe** : la
hiérarchie est donc préservée au maximum (1,33:1 d'écart d'encre avec `--text` `#9C9EAE`, contre
2,13:1 en thème jour). Retenu : `--muted: #85879A`.

**Preuve — même outil, deux campagnes d'affilée.** La sonde `_revue_ui.js` a été enrichie : chaque
ligne fautive porte désormais **l'encre et le fond réellement composés**, ce qui classe les
non-conformités **par jeton** au lieu de les compter en bloc. Passe avant : **139** non-conformités
sur 411 segments de texte · passe après : **99** → **40 réparées**, exactement la famille `#5E6072`
(0 restante, compte exact : aucun écran de nuit n'atteint le plafond de 14 lignes remontées). Les
autres familles sont inchangées au relevé près — jour `--muted` 26, `--brand-2` 31, `--blue` 18,
ambre 8, badges de rang 2+2+2, `.chip.on` 2, avatars 1+1 — et **les 26 écrans jour / mobile sont
identiques** : aucun effet de bord. Huit écrans de nuit passent à zéro (Accueil 4→0, Match 1→0,
Classement 8→0, Wallet 3→0, Profil 10→0, Messagerie 7→0, Amis 4→0, Tournois 1→0) ; Notifications
3→1 (reste une ligne d'encre `--brand`, lot S2). Toujours **0 erreur JavaScript, 0 débordement,
0 bouton sans nom accessible**.

**Fichiers.** *Modifié :* `D-aona/d-aona-web/index.html` — **un jeton + son commentaire de
justification** (l. 126-131, le fichier documente déjà ses choix AA de cette façon). *Ajoutés
(outils jetables, hors git) :* `d-aona-server/_s1_analyse.js` (ratios candidats × échelle des
surfaces), `_s1_compare.js` (diff avant/après **classé par encre**), `_revue_ui.js` enrichi (encre
+ fond par ligne fautive). *Documentation :* `REVUE_UI_UX.md` **§11** (suivi du lot : tables
avant/après, preuves, nuance de hiérarchie, décision esthétique laissée ouverte) + notes de renvoi
aux §2, §7 et §9.

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé) · `node test_ui_scenarios.js`
**110/110** · relecture visuelle des captures nuit avant/après (Profil, Accueil, Classement,
Messagerie) · `node test_scenarios.js` **non rejoué** : le serveur n'a pas été touché.
Preuves : `graphify-out/revue-ui/S1-avant/` et `S1-apres/` (les 53 captures, `mesures.txt`,
`mesures.json`, journal de campagne de chaque passe, `comparaison.txt`). **Aucune donnée client
sollicitée** : la sonde travaille sur une copie jetable de la base (port 8095).

**Reste ouvert.** Lots **S2** (badges de rang, prix, pastilles de type, titres de boutique),
**S3** (familles de petit texte du jour), **S4** (tailles), **S5** (contenus), **S6**
(comportements), **S7** (gabarits) — familles restantes : 99 non-conformités. Une décision
esthétique est notée au §11 : remonter `--text` en nuit si l'on veut retrouver l'écart
texte / texte secondaire du thème jour.

## 2026-09-23 — Revue UX/UI mesurée (3 gabarits, 2 thèmes) : 133 non-conformités de contraste, 12 causes racines

**Demande :** avant de figer une maquette, confronter l'application à des **mesures objectives**
(contraste AA, débordement horizontal, cibles tactiles, accessibilité de base, robustesse) sur les
**3 gabarits** (1440 / 390 / 360 px), les **2 thèmes** et les états particuliers (modales, vues
profondes, onglets, compte neuf), puis hiérarchiser les correctifs — **sans modifier le code
applicatif**.

**Méthode (rejouable).** Outil jetable `d-aona-server/_revue_ui.js` (motif `_*.js`, hors git) :
**instance jetable** — copie de la base réelle par `VACUUM INTO` (la source n'est ouverte qu'en
lecture seule), serveur de travail sur le port **8095**, deux comptes de revue créés **sur la copie**
(`ZzRevueUI` KYC vérifié, `ZzRevueVide` compte neuf), jeu de démonstration appliqué à la copie,
captures et mesures prises sur les états réels (jeton posé avant le démarrage de la SPA, clics
réels), copie supprimée à la fin. **Aucun compte réel n'est ouvert, modifié ni photographié.**
Rapport : `REVUE_UI_UX.md` ; preuves : `graphify-out/revue-ui/` (53 PNG, `mesures.txt`,
`mesures.json`, `captures.md`). Rejouer : `cd d-aona-server && node _revue_ui.js` (≈ 4 min).

**Chiffres.** 53 captures · **36 mesures d'écran** · 411 segments de texte · **0 erreur JavaScript** ·
**0 débordement horizontal** (1440/390/360) · 0 bouton ni lien sans nom accessible · 0 image sans
`alt` · **133 non-conformités AA** (≈ 12 sont des faux positifs d'emoji → ≈ 121 réelles) · 77 cibles
< 24 px, dont ≈ 60 liens de texte en ligne (exception WCAG 2.2 « cible en ligne ») et **4 pastilles
de pagination de 9×9 px**.

**Moteur de mesure validé :** en thème nuit, `--muted: #5E6072` sur `--panel: #0A0A0C` donne
**3,196:1** au calcul manuel → l'outil mesure **3,20:1** sur le même couple (fiable au centième).

**Constat n° 1 (systémique).** Les 133 lignes se réduisent à **12 causes racines** — corriger des
jetons, pas des écrans. Le défaut principal est le thème **nuit** : `--muted` y est *plus sombre* que
celui du thème jour (`#5E6072` contre `#6B6E80`) alors que le fond passe de `#FFFFFF` à `#0A0A0C` :
tous les textes secondaires, **y compris les titres de panneaux**, mesurent **3,20:1**. En jour, le
même jeton donne **5,04:1** (conforme) et les écarts restants sont rampants (3,6–4,34), sauf trois
familles franchement insuffisantes : badges de rang (1,86–3,66), pastilles de type « Clairs/Sombres »
(2,30–2,59) et prix (2,67). **Recalibrer les jetons de texte secondaire supprimerait ≈ 100 des
133 non-conformités**, sur tous les écrans, sans toucher à la mise en page.

**Autres constats retenus.** Références internes « PRD §x.y » affichées aux joueurs (5 emplacements) ·
**barre joueur de l'entraînement IA figée sur la maquette** (« TR », « 1126 Elo », « Vous » alors que
le compte a **1100 Elo** : `Fanorona.start` ne passe pas par `startServerGame`, seul endroit qui
remplit le HUD) · récapitulation de la modale de dépôt qui ne s'additionne pas (5 000 + 100 = ?) ·
Classement dont la 8e ligne est **coupée par la barre d'onglets** · Accueil : **6 tuiles pour
4 valeurs**, dont une contradiction (« 0 VICTOIRES » et « 0% » sans partie jouée) · état vide de
l'Accueil faible (≈ 440 px, sans icône ni action) alors que celui de Match est exemplaire ·
« Tournoi introuvable. » en **impasse** (aucun retour) · **3 champs sans nom accessible**
(`#wd-phone`, `#wd-amount`, `#avatar-input` : `<label>` sans `for`) · horodatages du chat à **10 px**
(2,61:1 en nuit) · **modale de tirage au sort affichée par-dessus le plateau** au moment précis où la
position doit être lue.

**Écartés après vérification** (vérifié dans le fichier, pas dans le terminal) : « Défs » et
`<spanclass="s">` — le mono-fichier contient bien « Défis » et `<span class="s">` (0 occurrence du
motif incomplet) : artefacts d'affichage du terminal · tuiles Match (grammaire active/inactive
documentée, scénario S12) · barre d'onglets claire en nuit (inversion volontaire) · ≈ 60 liens de
pseudo (exception « cible en ligne ») · emojis mesurés à 1,86–2,93:1 (la propriété `color` les
ignore : la mesure ne porte sur rien) · nœuds cachés du DOM (`#avatar-input`, `#wd-phone`,
`#wd-amount` signalés sans étiquette sur des écrans où ils ne sont pas visibles).

**Fichiers.** *Ajoutés :* `REVUE_UI_UX.md` (rapport complet, 303 lignes : méthode, 12 causes racines,
10 points majeurs, 10 points mineurs, propositions retenues et écartées, lots correctifs),
`graphify-out/revue-ui/` (53 PNG + `mesures.txt` + `mesures.json` + `captures.md`),
`d-aona-server/_revue_ui.js` (outil jetable, hors git). *Modifiés :* `CONTEXTE_PROJET.md` (cette
entrée, arborescence, commandes). **Aucun code applicatif modifié** : tout s'est fait sur une copie
jetable de la base et de l'instance.

**Suite proposée** (lots ordonnés par rendement décroissant, à valider lot par lot) : **S1** jetons du
thème nuit (≈ 37 non-conformités) · **S2** badges de rang, prix, pastilles de type, titres de section
de la boutique (≈ 21) · **S3** familles de petit texte du jour (≈ 45) · **S4** tailles (horodatages
10 → 11 px, zone cliquable des pastilles de pagination) · **S5** contenus (« PRD §x.y », état vide de
l'Accueil, « Tournoi introuvable », contacts tronqués, doublon « Ar ») · **S6** comportements (HUD de
l'entraînement IA, récapitulation du dépôt, chevron trompeur, noms accessibles des 3 champs) ·
**S7** gabarits (marges basses, barre haute mobile, pastilles étirées, séparation des surfaces en
nuit). Protocole de validation de chaque lot : `node test_ui_scenarios.js` **110/110** (+
`node test_scenarios.js` **226/226** si le serveur est touché), `node _check_html.js` OK, sonde de
contraste du projet **jour et nuit**, **0 erreur JavaScript**, re-capture ciblée avant/après dans
`graphify-out/revue-ui/`.

## 2026-09-23 — Skins de pions : deux catégories séparées (CLAIRS / SOMBRES), achats et équipement indépendants

**Demande :** passer d'un système de skins de pions unique à **deux catégories étanches** — un skin appartient soit aux pions clairs (`LIGHT`), soit aux pions sombres (`DARK`) ; l'achat de l'un ne débloque jamais l'autre ; boutique et inventaire doivent les distinguer ; un skin incompatible ne doit pouvoir être équipé **ni par l'interface ni par un appel direct** — le tout en modifiant le système existant plutôt qu'en en créant un second.

**Constat (système d'origine).** Un skin de pions n'était qu'un `id` opaque (`kind:'pions'`) : les deux camps partageaient **une seule** colonne d'équipement (`equipped_skins.pions`), donc un seul skin de pions équipé à la fois ; le catalogue ne portait aucun type ; la boutique affichait une grille unique et l'« inventaire » n'existait pas ; `POST /api/skins/equip` faisait confiance au **`kind` envoyé par le client** (`Skins.equip(user.id, sk.kind, sk.id)`), rien ne reliait donc un skin au camp qu'il habille. En revanche, `pions-emeraude` habillait `.piece.me` et `pions-obsidienne` `.piece.opp` par deux règles CSS codées en dur : la séparation existait *de fait* dans le rendu, sans être formalisée nulle part.

**Modèle retenu.** `type` (`LIGHT` / `DARK`, absent pour plateau et effets) sur chaque entrée du catalogue serveur (`data.js`) et de son miroir d'interface ; **deux emplacements** `equipped_skins.pions_light` et `pions_dark` ; le slot est **déduit du type côté serveur** (`data.skinSlot`) et le `type`/`slot` envoyé par le client n'est qu'une revendication, refusée en **400** si elle contredit le catalogue — un appel direct ne peut donc pas forcer un skin incompatible. Convention d'affichage conservée (correctif POV inchangé) : « clairs » = les pions du joueur tels qu'il les voit (`.piece.me`), « sombres » = ceux de l'adversaire (`.piece.opp`).

**Migration `008_skins_pions_type` (aucun achat perdu).** `pions-classique` (gratuit, les deux camps) remplacé par `pions-clair-classique` + `pions-sombre-classique`, attribués **et équipés** d'office à tous les comptes ; `pions-emeraude` → `pions-clair-emeraude` (LIGHT) et `pions-obsidienne` → `pions-sombre-obsidienne` (DARK), **identifiants réécrits dans `user_skins`** : les possesseurs gardent exactement ce qu'ils avaient acheté ; table reconstruite (procédé de la 005) avec `ON DELETE CASCADE` conservé. Résultat contrôlé sur la base réelle après application : 31 lignes `user_skins`, 13 `equipped_skins`, achats `emeraude` / `obsidienne` / `plateau` / `trace` / `anim` intacts — sauvegarde vérifiée (`backup_db.js`) faite **avant**.

**Catalogue : 11 skins** (8 de pions = 2 gratuits + 6 payants, prix par skin) — clairs : Vato, Émeraude, Obsidienne, Dragon ; sombres : Vato, Émeraude, Obsidienne, Ombres ; plus le plateau Nuit d'Anosy et les 2 effets. Les nouveaux thèmes n'ajoutent **aucun fichier** : uniquement des dégradés CSS, comme les skins existants.

**Interface.** Boutique groupée (`PIONS CLAIRS` / `PIONS SOMBRES` / `Plateau & effets`) avec filtres `[Tous] [Clairs] [Sombres]` (composants `.chips` / `.chip` déjà présents), pastille de type et état de possession sur chaque carte, et **panneau Inventaire** rangé par catégorie (Équipé / Possédé / Non possédé) ; `applySkins` et les aperçus sont désormais pilotés par le **catalogue** : chaque dégradé n'est décrit qu'une fois (aperçu de la boutique **et** plateau) et les règles CSS des pions sont générées au démarrage (`mountSkinStyles`), ce qui supprime les `if (id === …)` et les deux règles codées en dur ; `equipSkin(id, target)` refuse côté interface un camp incompatible, avec message explicite, **avant** tout appel réseau.

**Ajustement (même jour) — un skin = un pion, une couleur.** L'aperçu des cartes héritait de l'ancien skin unique et montrait la paire clair + sombre : il n'affiche plus qu'**UNE** pièce (34 px), à la couleur du skin, la catégorie restant portée par la pastille de type. Contrôlé par capture réelle (boutique « Tous », boutique filtrée « Sombres », inventaire) et par un contrôle supplémentaire du scénario S8 : un seul `.demo-piece` par carte de pions, dégradés clair ≠ sombre, aucun débordement du panneau Inventaire.

**Fichiers.** *Ajouté :* `d-aona-server/migrations/008_skins_pions_type.sql`. *Modifiés :* `data.js` (catalogue typé + `skinSlot` / `skinSlotMatches`), `db.js` (schéma à deux colonnes, `Skins.ensureDefaults`, `Skins.equip` à liste blanche de slots), `server.js` (catalogue typé, équipement à slot déduit + refus 400), `auth.js` (inscription via `Skins.ensureDefaults` — le SQL dupliqué disparaît), `D-aona/d-aona-web/index.html`, `test_scenarios.js` (phase 7 : 21 contrôles), `_p10.js` + `_p12.js` (+ `test_ui_scenarios.js` régénéré par `_build.js`), `d-aona/d-aona-web/README.md`, `CONTEXTE_PROJET.md`.

**Vérifications.** `node test_scenarios.js` **226/226** — dont refus croisé `LIGHT` → `pions_dark` en 400, achat clair qui n'accorde pas la version sombre, deux emplacements qui coexistent, plateau et effet intacts ; `node test_ui_scenarios.js` **110/110** (S8 : 12 contrôles — sections séparées, filtres qui isolent réellement, catalogue d'interface **confronté** à celui du serveur, débit exact, refus d'interface **et** refus serveur en appel direct, classes `skin-*` posées sur le plateau avec la règle claire visant `.piece.me` et la règle sombre visant `.piece.opp`) ; `node test_auth.js` **tous les tests passent** (chemin d'inscription modifié) ; `node _check_html.js` (script en ligne : 5 077 lignes) ; `node check_db.js`. **Aucune donnée client touchée par les tests** : serveurs et copies de base jetables (ports 8098 / 8099).

**Non fait (assumé).** Les skins équipés ne sont pas transmis pendant une partie : chacun voit **ses** choix appliqués aux deux camps affichés (comportement d'origine, inchangé). Montrer les skins de l'adversaire demanderait d'étendre l'état de partie et le WebSocket — décision à part.

## 2026-09-21 — Correctifs de données : badge Amis, classement vivant, photo de profil, noms cliquables, Elo gagné/perdu

**Demande :** cinq corrections d'affichage **et** de synchronisation — badge d'alerte sur
l'icône Amis, classement qui n'accueille pas les nouveaux joueurs, photo de profil absente
de l'Accueil et du header, noms de joueurs non cliquables, et « `undefined Elo` » dans la
dernière section du profil — avec la consigne explicite : *identifier la cause réelle
(données, état, API, cache) avant de toucher à l'interface*.

**Principe suivi.** Aucune correction cosmétique : pour chaque point, la cause a été
cherchée côté **données**. Trois défauts de synchronisation ont été trouvés au passage
(voir plus bas), invisibles tant qu'aucun test ne les mesurait.

**Causes réelles (et correctifs).**

1. **Badge Amis — la notion de « nouvelle demande » n'existait nulle part.**
   Rien ne distinguait une demande vue d'une demande neuve, et toute mémoire côté
   navigateur se serait rallumée au premier rechargement. D'où un **filigrane persisté en
   base** (migration `007_friends_seen.sql` : `users.friends_seen_request_id`), un
   `POST /api/friends/seen` (ouverts = vus), `newIncoming` dans `GET /api/friends`, et un
   second champ `newSinceId` (identifiant de la dernière demande reçue) qui permet au
   client d'**ignorer une réponse partie avant sa consultation** — sans lui, ouvrir
   l'écran Amis éteignait le badge puis le voyait se rallumer dans la seconde. Le filigrane
   est un **identifiant, jamais une date** : `datetime('now')` (SQLite) et l'ISO-UTC du
   reste du code ne se comparent pas sans bug silencieux.

2. **Classement — la requête était bonne, la fraîcheur ne l'était pas.**
   `/api/leaderboard` renvoie déjà **tous** les comptes (`User.listAll()`, aucun cache) :
   le client ne le relisait qu'à la connexion, et le serveur ne poussait rien. D'où
   `broadcast({ type: "leaderboard_update" })` à l'inscription et à la fin d'une partie
   classée, `renderRanks()` qui **redemande** la liste avant de peindre, un gestionnaire
   client qui recharge et redessine l'écran visible, et `Cache-Control: no-store` sur
   toute réponse d'API (le serveur peut être derrière le tunnel Cloudflare).

3. **Photo de profil — l'Accueil écrivait des initiales en dur, et quatre écrans
   fabriquaient leur avatar chacun de leur côté.** Une seule fabrique désormais
   (`avatarInnerHtml` / `avatarBox`) pour le header, l'Accueil, la carte Profil, le profil
   public et le Classement ; après dépôt d'une photo, l'état unique est propagé aux écrans
   qui l'affichent (plus de « à jour dans le header, périmée sur l'Accueil »).

4. **Noms cliquables — la classe `.link-pseudo` n'avait AUCUNE règle CSS**, donc rien ne
   signalait qu'un nom ouvrait un profil ; et plusieurs charges utiles ne transportaient
   que des pseudos (défis : `fromId`/`toId` et photo de l'expéditeur ; tournois :
   `registeredUsers` avec identifiant ; `/api/tournaments/my` : `opponentId`). Un pseudo
   n'est pas une clé (il peut changer) : les liens passent par l'**identifiant**, via une
   fabrique unique `pseudoLink(id, pseudo)` (avec `stopPropagation` là où la ligne est
   elle-même cliquable : bracket, chat).

5. **`undefined Elo` — trois bugs empilés.**
   - le profil public lisait `g.result` / `g.vs` / `g.delta` alors que la table expose
     `p1_name` / `p2_name` / `delta1` / `delta2` → « undefined contre undefined » ;
   - l'Accueil lisait `delta1` **quel que soit le camp** : le joueur 2 voyait l'écart de
     son adversaire, avec le signe inversé (le cas réel mesuré : Ari perd 16 points,
     l'écran annonçait « +16 ») ;
   - l'Elo **avant/après** n'était stocké nulle part : la migration
     `006_game_elo_snapshot.sql` ajoute `elo1_before/after` et `elo2_before/after` sur
     `games`, écrits au moment exact de la fin de partie. Les parties antérieures gardent
     leurs colonnes vides et l'interface affiche alors **« Données indisponibles »** —
     jamais un chiffre reconstitué à l'aveugle.
   Une seule lecture sert désormais tous les écrans : `mapGameRows(rows, viewerId)` +
   `gameRowHtml(g)` (« 1100 → 1116 · +16 Elo »).

**Trois défauts de synchronisation découverts en écrivant les tests.**

- **« Solde disponible : NaN Ar ».** Plusieurs poussées `wallet_update` ne portaient que
  `balance` : le client écrasait `bonusLock` avec `undefined`, et l'écran Wallet (calcul
  `solde − bonus verrouillé`) affichait `NaN Ar`. Corrigé à la source : une fabrique unique
  `walletPayload(userId)` côté serveur (charge complète), et un client qui ne stocke que ce
  qu'il reçoit réellement.
- **Le temps réel mourait en silence après un rechargement.** À la fermeture d'une ancienne
  socket, le serveur supprimait `userSockets[userId]` **sans vérifier qu'elle était encore
  la courante** : la nouvelle socket (ouverte par le rechargement) perdait son entrée, et
  la page ne recevait plus rien — badge, classement, état de partie — tout en affichant
  « connecté ». Le même défaut pouvait programmer un **abandon de la partie en cours** d'un
  joueur pourtant reconnecté. Corrigé des deux côtés : garde d'identité serveur
  (`broadcast`/`handleDisconnect`) et client (`connect()` vérifie que chaque gestionnaire
  parle bien de la socket courante + **chien de garde 15 s**).
- **L'Accueil gardait l'état d'avant la partie.** `onServerGameEnd` n'appelait que
  `refreshUser()` : l'historique et le classement restaient figés jusqu'au prochain
  rechargement. `refreshAfterGame()` recharge historique + classement + utilisateur et
  redessine l'écran visible (partie en ligne **et** entraînement).

**Et un écart de règle, mesuré.** Une partie d'**entraînement IA** modifiait l'Elo
(1100 → 1081 constaté) alors que l'écran affiche « aucun impact Elo ni wallet ». Le camp du
joueur était mis à jour sans condition de mode. Un entraînement est désormais **non
classé** : ni Elo, ni victoires, ni défaites, écart enregistré à 0, delta annoncé nul.

**Migrations.** `006_game_elo_snapshot` (colonnes d'instantané d'Elo sur `games`),
`007_friends_seen` (`users.friends_seen_request_id`). Appliquées :
`node migrate.js --status` les liste comme telles.

**Fichiers touchés.** `db.js` (filigrane amis, instantané d'Elo, avatars des défis),
`server.js` (routes et charges utiles, diffusions, instantané d'Elo, partie d'entraînement
non classée, `Cache-Control: no-store`, gardes de socket), `index.html` (fabriques
`avatarInnerHtml`/`avatarBox`/`pseudoLink`/`mapGameRows`/`gameRowHtml`, badge Amis, rendu du
classement, `refreshAfterGame`, règles CSS `.link-pseudo`, robustesse de `connect()`),
`migrations/006…` et `007…`, `test_scenarios.js` (phase 11 + contrôles d'entraînement),
`_p14.js` (**nouveau** scénario S13) + `_build.js`.

**Preuves (toutes vertes après correctifs).**
- `test_scenarios.js` — **216/216** (phase 11 : classement, badge et son filigrane après
  « rechargement », identifiants des charges utiles, instantané d'Elo des deux camps,
  signes, entraînement non classé).
- `test_ui_scenarios.js` — campagne complète, **104/104**, **S13 « Données » inclus** : le
  joueur créé apparaît au classement **sans rechargement**, son nom est un lien vers son
  profil, le badge s'allume / s'éteint / **reste éteint après un rechargement**, la photo
  est la même sur l'Accueil, le header, le Classement et le profil public, et une partie
  classée affiche « −N Elo » chez le perdant comme « +N Elo » chez le vainqueur (valeurs
  confrontées à `/api/games/history`).
- `_data_probe.js` (**nouveau**) — 11 écrans + profil d'un tiers : aucun `undefined`, `NaN`
  ni `[object Object]` visible ; chaque ligne d'historique porte soit un delta signé, soit
  « Données indisponibles ».
- `_ws_probe.js` (**nouveau**) — la poussée serveur arrive **avant et après** un
  rechargement de page.
- `_ai_elo.js` (**nouveau**) — mesure ciblée : entraînement sans impact Elo.
- `_layout_fill.js` — 194/194 (la règle `.link-pseudo` n'ajoute pas de hauteur).
- `_livecheck.js` (**nouveau**) — surface d'API du serveur **en service** (tunnel) :
  13/13, dont `Cache-Control: no-store` sur le classement, filigrane des demandes
  d'ami exposé, inscrits de tournoi avec identifiant, et front à jour.
- `test_auth.js` — inchangé, tout passe (la limitation de débit reste mesurée là).

**Note d'outillage.** Les instances jetables des campagnes lancent le serveur avec
`D_AONA_AUTH_RATE_MAX=400` : une campagne inscrit une dizaine de comptes depuis la même IP
et finissait par se limiter **elle-même** en 429, ce qui faisait échouer le scénario en
cours pour une raison étrangère au produit. Le quota réel reste couvert par `test_auth.js`,
sur le serveur de production.

La campagne `test_ui_scenarios.js` compte désormais **13 scénarios** (S13 ajouté) ; son
assemblage reste généré par `node _build.js` à partir des fragments `_p*.js` — ne jamais
éditer `test_ui_scenarios.js` à la main.

## 2026-09-20 — Section « Je participe » dans l'onglet Tournois (déplacement automatique)

**Demande :** ajouter un bouton **« Je participe »** dans la barre de filtres de
l'onglet Tournois (à côté de Ouvert / En cours / Terminé). Un tournoi y entre
**automatiquement** à la confirmation de l'inscription, et en sort de même si
l'inscription est annulée ou retirée.

**Ce qui a été fait.**
- **4ᵉ segment** `#match-root [data-tfilter="participe"]` en tête de la barre
  (« Je participe » · Ouvert · En cours · Terminé), avec son **compteur** comme les
  autres. Le groupe ARIA devient « Filtres des tournois — participation et statut ».
- **Le filtre n'est pas un statut** : `tnIsMine(t)` s'appuie sur `t.isRegistered`
  (recopié dans `S.myRegs` par `refreshTournaments()`), donc la section suit le
  SERVEUR. Un tournoi ouvert où je suis inscrit apparaît **dans les deux vues** —
  c'est une vue de mes inscriptions, pas un tiroir qui les retire des autres ; un
  tournoi dont je suis retiré ne reste que dans la sienne.
- **État vide dédié** : « Aucune participation en cours » + le lien « Voir les
  tournois ouverts » (action `data-mtact="open-tournaments"` déjà branchée), pour ne
  jamais laisser un cul-de-sac.
- **Automatique à l'entrée** : `joinTournament()` appelait déjà `refreshTournaments()`
  → `renderMatch()` : la carte, le compteur et la nouvelle vue se mettent à jour sans
  rechargement — le seul geste est celui du joueur (son inscription).
- **Automatique à la sortie** : `API.on("tournament_update")` rafraîchissait les
  données **sans redessiner** — la section serait restée figée jusqu'à une action.
  Le gestionnaire redessine désormais le panneau visible (`renderMatch()` si l'onglet
  Tournois est affiché, `renderHome()` sur l'accueil), et **sans requête
  supplémentaire** : les données sont déjà en mémoire. Tout événement serveur
  (inscription, génération du bracket, fin de match — et demain un retrait) tient
  donc la section à jour toute seule.

**Portée sur le retrait d'inscription.** Il n'existe toujours **aucune** action
« se retirer » (ni route serveur, ni bouton) : le mécanisme ci-dessus la rendra
automatique le jour où elle arrivera — les deux vérifications empruntent déjà le
chemin réel (données serveur + diffusion WebSocket).

**Vérifications.**
- Campagne d'interface (`node test_ui_scenarios.js`, 1440×900) → **87/87**, dont
  deux étapes nouvelles : « le tournoi rejoint « Je participe » dès l'inscription
  confirmée » et « inscription retirée côté serveur : le tournoi sort de
  « Je participe » sans geste ». Cette dernière supprime la ligne d'inscription dans
  la copie jetable puis fait s'inscrire un second joueur : le serveur diffuse
  `tournament_update` et la carte disparaît **sans clic ni rechargement**.
- Suite API (`node test_scenarios.js`) → **184/184**, dont « le tournoi rejoint
  « Je participe » : isRegistered = true pour l'inscrit » et « inscription retirée :
  isRegistered = false — la section se vide d'elle-même ».
- Mesure de mise en page (`_layout_fill.js`) → **194/194** avec le 4ᵉ segment ;
  capture `graphify-out/revue-fill/desktop-1440x900-match-tournois.png` : la barre
  affiche « Je participe · Ouvert 2 · En cours 3 · Terminé 1 ».

**Fichiers :** `D-aona/d-aona-web/index.html` (`tnIsMine`, `tournoisPanel()`,
gestionnaire `tournament_update`), `d-aona-server/_p11.js`,
`d-aona-server/test_ui_scenarios.js` (généré), `d-aona-server/test_scenarios.js`,
`d-aona-server/_layout_fill.js` (capture), `CONTEXTE_PROJET.md`.


## 2026-09-20 — Retrait du système de rang (les badges de place restent)

**Demande :** « enlever tout le système de rang », les badges (Remenabila, Malaso,
Dahalo, Totakely, Akofa, Vary masaka) devant rester affichés.

**Ce qui a disparu.** Les 7 paliers `RANKS` (Bronze → Grand Maître) et tout ce qui en
dépendait :
- **interface** : table `RANKS`, `rankFor()`, `rankProgress()`, la pastille
  « ◆ Argent » (accueil, profil, profil public), la carte « Votre rang — Saison 2 »
  et sa barre de progression au Classement, les pastilles de rang du HUD de partie
  (`#me-rank-mini`, `#opp-rank-mini`) et l'affichage du rang de l'adversaire quand un
  match est trouvé ;
- **serveur** : `data.js` (`RANKS`, `rankFor`, `rankProgress` et leurs exports),
  `ranks` retiré du payload `/api/config`, `minRank` retiré du payload des tournois ;
- **condition d'accès** : l'inscription à un tournoi n'est plus filtrée par le rang —
  plus de refus 403 « Rang X requis », ni côté serveur, ni côté interface
  (`rankOk`, ligne « Rang minimum », bouton verrouillé).

**Ce qui reste.** L'Elo (le score), le classement national / provincial par place,
les médailles 🥇🥈🥉 et **les badges de place** (`BADGES` / `badgeFor`, indexés sur la
position au classement national) : ils sont intacts au Classement, sur le profil et
sur le profil public. La carte de gauche du Classement devient « Votre classement —
Saison 2 » (avatar, Elo, `#place` nationale, badge) et ses règles parlent d'Elo —
« Calibration : aucune perte d'Elo sur les 10 premières parties » (la formulation
d'origine disait « perte de rang »), « Saison de 6 mois : classement recalculé ».

**Colonne `tournaments.min_rank` : conservée mais INERTE.** Plus personne ne la lit
(aucune requête, aucun affichage) et les seeds historiques continuent de l'écrire
('Bronze' / 'Platine'). La retirer exigerait de reconstruire la table (SQLite ne sait
pas supprimer une colonne) : hors périmètre pour un changement de comportement déjà
complet, et sans effet visible. À faire dans une migration dédiée si le schéma doit
être nettoyé.

**Tests adaptés, pas contournés.**
- `test_scenarios.js` : « tournoi exigeant le rang « Or » → 403 » devient « tournoi
  gratuit : plus aucune condition de rang, inscription acceptée (200) ». Le tournoi de
  test 9002 garde **volontairement** `min_rank = 'Or'` : c'est la preuve qu'une valeur
  historique non vide ne bloque plus rien. Les intitulés « profil : rang et badge » et
  « leaderboard : rang, pseudo… » parlent désormais de *place au classement*, et le
  contrôle de `/api/config` exige 3 formats, 3 opérateurs **et l'absence de `ranks`**.
- Campagne d'interface **régénérée** : `_p1.js` (commentaire de la fixture) puis
  `node _build.js` → `test_ui_scenarios.js`.

**Textes de démonstration et documentation.** Le message de chat de démo « Gg pour ta
montée Argent » devient « Gg pour ta montée au classement » ; la description du format
Pro (« réservé aux tournois Masters / Grand Maître ») devient « réservé aux tournois à
long format » (`index.html` **et** `data.js`) ; le mapping PRD du README frontend
(« 7 rangs Bronze → Grand Maître ») annonce désormais « classement par place et badges
(paliers de rang retirés) ».

**Vérifications.** `node test_scenarios.js` → **182/182** (dont les quatre contrôles
adaptés) · `node test_ui_scenarios.js` → **85/85** (dont « aucune erreur JavaScript ni
console.error ») · mesure de mise en page `_layout_fill.js` → **194/194**. Capture du
Classement revue (`graphify-out/revue-fill/desktop-1440x900-ranks.png`) : aucun palier
nulle part, podium, médailles et badges intacts.

**Fichiers :** `D-aona/d-aona-web/index.html`, `D-aona/d-aona-web/README.md`,
`d-aona-server/data.js`, `d-aona-server/server.js`,
`d-aona-server/test_scenarios.js`, `d-aona-server/_p1.js`,
`d-aona-server/test_ui_scenarios.js` (généré), `CONTEXTE_PROJET.md`.


## 2026-09-20 — Mise en page « plein écran » : plus de vide latéral sur les vues de consultation

**Constat.** Sur un écran 1920 px, `#screens { max-width: 1180px; margin: 0 auto }`
laissait ~370 px de vide de chaque côté, et la page défilait globalement : l'interface
restait une colonne de téléphone au milieu du bureau.

**Décision — la portée est une LISTE BLANCHE, pas une exception CSS.** Le routeur pose
`body.is-fill` pour les routes de `FILL_ROUTES` : Accueil, Match, Classement, Wallet,
Profil, Messagerie, Amis, Notifications, Détail tournoi. **« Jeux » et le plateau en
sont exclus** — le wizard de jeu a une hauteur calculée (`calc(100dvh - 212px)`) et le
plateau un ratio 1647/955 avec un HUD de 280 px : les deux ont besoin du défilement de
page. Ajouter une route = une entrée dans le tableau.

**Mécanisme.** Une coquille `body → #screens → .screen.active` en flex : en-tête figé
(`flex: none`), zone de contenu en `1fr`, `min-height: 0` à chaque niveau. Trois
comportements, et **un seul niveau qui défile** dans chaque cas :

1. **Flux** (Amis, Notifications, Détail tournoi) — la zone de contenu défile ; le
   bracket garde son `overflow-x: auto` (il défile seul, en travers) ;
2. **Deux colonnes** (Match, Classement, Wallet, Profil) — la grille passe en
   `height: 100%` + `align-items: stretch`, et **chaque colonne** défile pour son compte ;
3. **Accueil** — deux colonnes pleine hauteur et c'est le **bloc** qui défile :
   `grid-auto-rows: minmax(0, 1fr)` fait se partager la hauteur restante par les blocs
   souples (Dernières parties, Mes tournois, Défis) tandis que le héro et les trois
   tuiles restent des rangées `auto`. Si « Mes tournois » est absent, « Dernières
   parties » prend tout : la répartition est dynamique, pas figée.

Mobile (≤ 1080 px) : **aucune** de ces règles ne s'applique (tout est sous
`min-width: 1081px`) → pile verticale à 100 % de la largeur et défilement de page
retrouvé. Un garde-fou explicite (`overflow: visible`, `height: auto`) repasse les
blocs `hg-*` en blocs de flux, et une variante `max-height: 820px` compacte les
espacements pour 1366×768 / 1280×720.

**Défaut trouvé par la mesure, puis corrigé.** La colonne de droite de l'Accueil
restait 201 px plus courte que la gauche. Cause réelle : `.side-stack` (L519) est
déclaré **après** `.hg-col` (L512) et, à spécificité égale, son `display: flex`
l'emportait — la règle plein écran ne redéfinissait donc pas le mode d'affichage, et
les rangées `1fr` n'existaient pas. C'est le contrôle « les colonnes sont remplies
jusqu'en bas » qui l'a révélé ; il est resté dans le script.

**Vérifications.**
- Nouveau script de mesure `d-aona-server/_layout_fill.js` (serveur + base **jetables**
  sur 8098 : copie `VACUUM INTO`, compte créé par l'API, jeton injecté dans
  `localStorage`) : **194/194**. Il ne se contente pas d'affirmer :
  - desktop : hauteur de page dans la fenêtre **et** `window.scrollTo()` sans effet ;
  - **preuve du défilement interne** : on gonfle un bloc de 40 lignes factices → le
    bloc défile, la page non ;
  - `#screens` à 100 % de la largeur, et les deux colonnes de l'Accueil occupent la
    largeur utile de part et d'autre (aucun vide latéral) ;
  - routes exclues : `max-width: 1180px` et écran en `block` — inchangées ;
  - mobile 360×760 et 390×844 : blocs à 100 % de la largeur utile, et la page
    redéfile (prouvé en gonflant le contenu) ;
  - écran Messagerie mesuré **avec** une conversation (amorcée dans la copie
    jetable) : sans elle, `renderChat()` sort par son état vide et la grille n'est
    jamais montée — donc jamais mesurée ;
  - zéro erreur JavaScript pendant toute la mesure.
- Campagne d'interface du projet : **85/85** — dont S2 (les dix écrans s'ouvrent et se
  remplissent) et « mobile 360 px : tuiles tapables, colonnes empilées, aucun
  débordement ».
- Captures dans `graphify-out/revue-fill/` : Accueil / Match / Classement / Wallet en
  1440×900, Accueil et Match en 360×760 et 390×844.

**Fichiers :** `D-aona/d-aona-web/index.html` (bloc CSS « Coquille plein écran »,
`.hg-col` / `.hg-block` / `.hg-scroll`, classes ajoutées à `renderHome()` et
`myTournamentsHtml()`, `FILL_ROUTES` + `body.is-fill` dans `route()`),
`d-aona-server/_layout_fill.js` (outil de mesure local, ignoré par git),
`CONTEXTE_PROJET.md`.


## 2026-09-19 — Jeu de données de démonstration (chaque écran a du contenu à montrer)

**Deux scripts** remplissent un environnement de test avec des données **réelles**
(mêmes tables, mêmes modules que le serveur — rien n'est inventé côté client) pour
que l'interface se juge sur du contenu et non sur des écrans vides :

- [demo_seed.js](d-aona-server/demo_seed.js) — 8 joueurs `Demo…` (mots de passe
  Argon2id réels, Elo / victoires / soldes / provinces variés) ; le compte visé
  devient ami avec 5 d'entre eux, reçoit **2 demandes d'ami** et en a envoyé 1 ;
  **2 défis reçus** en attente (la carte de défi et sa jauge existent vraiment) +
  **1 défi envoyé** (le bouton « Annuler » a une cible), la mise étant réellement
  débitée chez l'expéditeur ; notifications lues et non lues (badge de la cloche) ;
  historique de wallet cohérent (solde = somme des mouvements) ; conversations de
  chat ; les 5 tournois officiels garnis d'inscrits, « Blitz Cup » à 3/8 et un
  tournoi **en cours** au bracket à moitié joué.
- [demo_live.js](d-aona-server/demo_live.js) — deux **parties en direct** (bêtes
  qui jouent coup par coup) : le fil « En direct », le mode spectateur et le
  passage en lecture seule ont du contenu sans second joueur humain.

**Le script de parties en direct ne joue que SA partie.** À la (re)connexion, le
serveur pousse l'état de la **première session vivante** du compte : un
redémarrage en moins de 20 s (délai de grâce d'abandon) laissait la partie
précédente vivante, la nouvelle s'installait par-dessus, et le bot jouait un état
étranger — tous les coups refusés (« Coup invalide », « Prise en chaîne ») et une
partie figée dans le fil. Trois protections : les messages sont **filtrés par
`sessionId`**, toute session poussée alors qu'aucune partie n'est en cours est
**résiliée** (donc retirée du fil), et l'arrêt (Ctrl+C) résilie **avant** de
fermer. Un `sync_game` sans identifiant fait renvoyer la session suivante →
`--clean` purge les restes d'un essai précédent. **Aucun changement serveur** : le
client de l'app filtre déjà par session (`msg.sessionId === S.currentSession`) et
une partie gelée dont le joueur actif est en ligne finit par perdre au temps
(horloge). Vérifié après nettoyage : **0 erreur**, 6 fins de partie enchaînées sur
3 tables, et plus aucune paire en double en base.

`demo_seed.js` **ajoute** et ne retire que ce qu'il a lui-même posé (`--clean`) ;
il est **relançable** (un défi expiré n'est plus « en attente », donc il est recréé
avec une nouvelle échéance et un identifiant neuf). Durées de vie paramétrées en
tête de fichier : `DEFI_RECU_MIN = 45`, `DEFI_ENVOYE_MIN = 15`.
`demo_live.js` accepte `--matches=1..4` (2 bêtes par table) et `--clean`.

**Un défaut trouvé grâce à ces données** : un tournoi dont le serveur a posé
`en_cours` (heure de départ atteinte) n'apparaissait dans **aucun** des trois
filtres de l'écran — ni ouvert, ni en cours, ni terminé — il disparaissait en
pleine compétition. `tnIsRunning` accepte désormais `en_cours` (et un tournoi
`inscriptions` dont l'heure est passée), avec le commentaire qui l'explique.

**Vérifications.** `node test_ui_scenarios.js` : **85/85** avec le jeu de données
en base — le harnais tolère désormais les défis et tournois de démonstration
(morceaux `_p3`, `_p9`, `_p11`, `_p12`, puis régénération par `node _build.js`),
et la campagne repasse **85/85** après le durcissement du script de parties en
direct. Captures jour / nuit / mobile dans `graphify-out/revue-demo/` (héro, défi
reçu et sa jauge, tournois, parties en direct).

**Fichiers :** `d-aona-server/demo_seed.js`, `d-aona-server/demo_live.js`,
`D-aona/d-aona-web/index.html`, `d-aona-server/_p3.js`, `_p9.js`, `_p11.js`,
`_p12.js`, `test_ui_scenarios.js` (assemblé), `CONTEXTE_PROJET.md`.


## 2026-09-19 — Écran « Match » : passage au style « Desktop Soft » (maquette fournie)

**Nouvelle maquette** (`match-soft-preview.html`, aperçu autonome hors application)
sur la **même structure** que la refonte du 17/09 — héro, trois tuiles de
statistiques, deux colonnes — mais un **habillage** différent : héro vert plein à
halo, rayons 24 px, cartes **sans bordure**, cartes « défi » et « tournoi » à
**badge flottant** à icône, filtres en **pastilles**, actions principales
**dans** le héro. Le style est repris **intégralement**, y compris les points que
l'aperçu laissait en arbitrage, en préservant ce que les tests et le serveur
attendent :

1. **Barème conservé** : l'aperçu sortait le panneau « Comment ça marche » de la
   colonne et laissait le barème « à rebrancher ». Il reste dans la colonne de
   droite, restylé (`.mt-rules`), avec le bouton `#mt-prize` intact — remboursement
   top 3, 50 / 25 / 0, commission 25 % continuent d'être affichés et dépliables.
2. **Statut du tournoi conservé** : les cartes douces gardent `.tn-head` + `.pill`
   (Ouvert / En cours / Terminé) — le badge flottant **s'ajoute** à l'information,
   il ne la remplace pas.
3. **Trois tuiles à toutes les largeurs** : l'aperçu n'en montrait que deux en
   mobile ; elles servent de **navigation** entre les trois sections, les réduire
   priverait d'un accès. En 360 px elles se resserrent (libellés et compteurs
   réduits), elles ne disparaissent pas.

**Ce qui change, écran par écran.** Le héro regroupe son **en-tête** (titre,
promesse, pastille « TEMPS RÉEL », statut rapide cliquable), les **deux actions**
réelles (`.mt-cta-solid` « Trouver un adversaire », `.mt-cta-ghost` « Inviter un
ami ») et les **trois tuiles** ; la tuile active s'inverse en blanc. Le panneau de
l'écran passe à **24 px, sans bordure** — surcharge **scopée à `#screen-match`**
(sauf en thème nuit, où la hairline reste pour détacher le panneau du fond noir) :
les autres vues gardent `--radius-card` (8 px) et leurs bordures. Les cartes défi
et tournoi prennent un **badge flottant** (`mt-sc__badge`, or = à traiter,
ciel = terminé), un sous-titre, la jauge et les actions
(`mt-defi__spec` / `mt-defi__acts`) ; les tournois passent en **grille deux
colonnes** (`.mt-grid2`) avec **filtres en pastilles**. Les avatars gagnent les
teintes pastel de la maquette (`.av-g/.av-o/.av-b/.av-p`).

**Jetons : préfixe `--mt-*` uniquement** (18 jetons déclarés dans les deux blocs
`:root` et `night`). **Aucun jeton global n'est modifié** (`--radius-card`,
`--brand`, `--shadow-*` inchangés) : le style ne peut pas déborder sur Accueil,
Jeu, Wallet, Classement. Le héro est **vert dans les deux thèmes** — variante OLED
assombrie (`#12744B → #06301D`) pour tenir le même seuil sur fond noir.

**Deux mesures ont changé le rendu (AA, mesuré sur les pixels rendus) :**
(1) le paragraphe du héro (13 px, blanc 92 %) tombait à **3,00:1** sur l'arrêt le
plus clair du dégradé → le 1ᵉʳ arrêt passe de `#1FA357` à **`#15803D`** (**4,51:1**
pour le paragraphe, 5,02:1 pour le blanc pur), correctif documenté sur
`--mt-grad-green` ; (2) les pastilles du héro en **verre clair** éclaircissaient le
vert sous leur texte — **3,04:1** (temps réel) et **2,93:1** (statut) mesurés → les
pastilles passent en **verre fumé** (fond sombre translucide, encre blanche
conservée) et la variante d'alerte du statut en fond blanc quasi opaque.

**Deux calages à valeur unique** : `--mt-lift` (le badge flottant dépasse de
30 px, la carte du défi démarre d'autant et **la colonne d'en face s'y cale**) et
`--mt-filter-lift` (16 px pour la rangée de filtres des tournois, reprise par
« Prochains départs »). Sous 1080 px les colonnes s'empilent et les deux calages
retombent à zéro.

**Vérifications.** Campagne d'interface `node test_ui_scenarios.js` : **85/85** —
scénario `S12` (héro, tuiles, deux colonnes, défis réels, jauge, annulation,
mobile 360 px) **18/18**, et bloc `SX` **3/3** (version servie + **aucune erreur
JavaScript** dans les navigateurs de test). Audit de contraste dédié
(`_contraste.js`, serveur et base jetables, port 8098) : **20/20 seuils AA**
dans **les deux thèmes** (héro, pastilles, tuile active et inactive, cartes,
badges, filtres, états vides). Captures jour/nuit/mobile dans
`graphify-out/revue-soft/` (live, défis, tournois).
`test_ui_scenarios.js` est **régénéré par `node _build.js`** (morceaux
`_p1.js` … `_p13.js`) : le fichier livré est un assemblage, il ne s'édite pas à la
main. **Aucun changement serveur** : l'écran reste une vue de consultation.
**Fichiers :** `D-aona/d-aona-web/index.html`, `CONTEXTE_PROJET.md`
(+ `d-aona-server/_contraste.js`, script de mesure de contraste réutilisable, **hors
dépôt** : le motif `_*.js` est ignoré, seul le harnais `_p1…_p13` + `_build.js` est
versionné).

## 2026-09-17 — Écran « Match » : héro, tuiles de statistiques, deux colonnes (refonte visuelle)

**Refonte visuelle** de l'écran Match sur une maquette fournie, **sans changer son
rôle** (voir l'entrée « trois onglets » ci-dessous) : l'écran reste une vue de
consultation — suivre, défier, s'inscrire. Ce qui vient de la maquette : un
**héro** de tête (titre, promesse, pastille « TEMPS RÉEL » à point pulsant, statut
rapide, deux actions) et les trois onglets transformés en **tuiles de
statistiques** — chacune annonce ce qu'elle contient : libellé, **compteur
vivant**, sous-libellé (« 2 · parties en cours », « 1 · à répondre », « 3 ·
ouverts »). Sous le héro, chaque onglet se déplie en **deux colonnes** (la liste à
gauche, le contexte à droite) : fil + contacts sur « En direct », défi à traiter +
défis envoyés + joueurs en ligne sur « Défis », tournois + « Comment ça marche » +
« Prochains départs » sur « Tournois ». Sous 1080 px les colonnes s'empilent.

**Aucune donnée inventée par rapport à la maquette.** Elle montrait un score
« 2 – 1 », « Meilleur de 3 », « il y a 4 min », une série de saison : le serveur ne
sait rien de tout ça. Chaque écart a été comblé par une donnée réelle :

1. **Pions restants** (`GET /api/games/live` expose désormais `pieces1`/`pieces2`
   via `countPieces`) là où la maquette affichait un score de manches — il n'existe
   aucun compteur de manches, et un score décoratif mentirait.
2. **Compteurs des tuiles** : parties en cours (serveur), défis reçus en attente,
   tournois ouverts aux inscriptions. Tant que le serveur n'a pas répondu, la
   tuile « En direct » affiche « — » : un tiret plutôt qu'un zéro qui affirmerait
   que personne ne joue.
3. **Disponibilité des contacts** : « en ligne » vient de `/api/chat/contacts`,
   « en partie » du fil des parties en cours, le reste est « hors ligne » — et
   l'action est alors **désactivée** au lieu d'échouer au clic.
4. **Jauge de défi** : `GET /api/challenges` expose `createdAt`/`expiresAt` en
   **ISO-UTC** (la date SQLite brute « 2026-09-17 20:39:46 » serait lue comme une
   heure **locale** par le navigateur et décalerait le compte à rebours du fuseau ;
   `expires_at` brut n'est plus exposé). La jauge se vide avec le temps réel
   restant et affiche « reste 14 / 15 min ».
5. **Annulation d'un défi envoyé** : nouveau message WebSocket
   `cancel_challenge`, miroir exact du refus — remboursement immédiat, statut
   `cancelled`, et poussée `challenges_update` au destinataire qui voit la carte
   disparaître sans recharger. L'annulation est **réservée à l'expéditeur**
   (vérifié côté serveur, pas seulement à l'écran).

**Deux incohérences trouvées PAR les tests, corrigées :** (1) après l'envoi ou
l'acceptation d'un défi, la mise était bien débitée en base mais **la barre du haut
gardait l'ancien solde** (aucune poussée `wallet_update`) — corrigé dans
`send_challenge` et `accept_challenge` ; (2) refuser ou accepter un défi laissait
la carte affichée jusqu'au rendu suivant — l'écran se rafraîchit maintenant
immédiatement.

**Couleurs : uniquement les tokens existants** (aucun token créé). Les deux
seuils AA de l'écran ont été **mesurés** : libellé de tuile active `--brand` /
`--brand-2` (5,50 / 5,75), sous-libellé de tuile en `--text` et non `--muted`
(9,01 / 7,16 — `--muted` tombe à 3,1:1 la nuit), et la pastille de statut de jour
passe à un **fond blanc translucide** : posée sur le halo du héro, sa teinte
translucide composait un fond vert trop proche du texte (**3,87:1 mesuré**, sous
AA) — 6,41:1 après correction. Le point pulsant respecte
`prefers-reduced-motion`.

**Vérifications.** `node test_scenarios.js` : **182/182** (dont pions annoncés
confrontés au plateau du spectateur, dates ISO-UTC à 900 s près, annulation
remboursée / interdite au destinataire / disparue des deux listes).
Harnais d'interface : scénario `S12` **réécrit** pour la nouvelle structure —
**18/18** — dont tuile « En direct » cohérente avec la liste affichée, jauge
confrontée aux dates du serveur (± 2 points) puis vérifiée décroissante sur 3 s,
remboursement vérifié **en base puis à l'écran**, annulation qui fait disparaître
le défi chez les deux joueurs, colonnes 2 → 1 en mobile 360 px.
Parcours Playwright (serveur + base jetables, port 8098) : **115/115 — TOUT
PASSE**, avec les nouveaux contrôles de contraste sur le héro (titre 10,96 / 13,89,
pastille temps réel 15,33 / 14,56, tuile active 5,50 / 5,75, solde de pions 13,85 /
13,94), l'état d'erreur capturé **dans les deux thèmes**, et les captures
jour/nuit/tournois/défis/erreur/mobile.
**Défaut préexistant corrigé au passage :** l'étape S11 « le message arrive chez
le destinataire en temps réel » visait `.cp-msgs[data-pop]` alors que
l'application marque ses fenêtres `data-pop-msgs` (déjà dans HEAD) — le sélecteur
du test était simplement périmé ; la campagne est verte de bout en bout depuis.
**Aucune donnée client touchée** : tous les tests tournent sur copie jetable.
**Fichiers :** `D-aona/d-aona-web/index.html`, `d-aona-server/server.js`,
`d-aona-server/test_scenarios.js`, `d-aona-server/_p3.js`, `_p12.js`, `_p13.js`,
`test_ui_scenarios.js` (régénéré), `CONTEXTE_PROJET.md`.


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

## 2026-09-17 — Écran « Match » : trois onglets, filtres réels, états vides et d'erreur

**L'écran Match devient une vue de CONSULTATION à trois entrées** — suivre
(**En direct**), défier (**Défis**), s'inscrire (**Tournois**) — servie par une
barre d'onglets segmentée. L'ancien écran était une pile de panneaux
(`#match-root` : direct + défis + joueurs en ligne + tournois empilés) sans
onglet, sans filtre et sans état d'erreur. **Aucun onglet « À jouer »** : mettre
sa partie en file reste le travail de l'écran Jeux, on l'ouvre depuis le CTA.
L'en-tête reprend le langage de l'app : titre + sous-titre temps réel, **pastille
de statut cliquable** (« ✓ Rien d'urgent », « ⚔️ 1 défi en attente », « ⏸ Partie
en pause », « 👁 Vous suivez un match » — la plus urgente d'abord, elle ouvre
l'onglet concerné) et **deux actions** : « ⚔️ Trouver un adversaire » (ouvre le
récapitulatif de mise en file, mode classé) et « 🔗 Inviter un ami » (lien de la
plateforme à copier + accès à la recherche de joueur — aucun parrainage inventé).
Le header de l'app (logo + localisation, KYC, solde Ar, notifications, avatar) et
la navigation à six entrées ne sont pas touchés : l'écran s'y insère.

**Deux capacités serveur ajoutées, pas simulées côté client :
1. `GET /api/games/live?scope=contacts|all`** — `contacts` (défaut) garde le
   périmètre historique (amis + contacts) ; `all` alimente le filtre « Toutes les
   parties ». Les parties d'entraînement (IA) n'y entrent jamais et la liste est
   **plafonnée à 60 entrées** (`LIVE_FEED_MAX`) : c'est un fil de découverte, pas
   un export de l'activité du serveur. La réponse annonce sa portée (`scope`), et
   une partie où VOUS jouez est filtrée à l'affichage — le serveur refuse déjà un
   joueur comme spectateur de son propre match, donc aucun bouton inerte.
2. **`GET /api/challenges`** — `{ received, sent }` via `Challenge.getByUser` /
   `Challenge.listSent` (déjà en base). L'onglet Défis montre donc les **reçus**
   (Accepter / Refuser) *et* les **envoyés** avec leur statut (En attente /
   Accepté / Refusé / Expiré) — le client n'avait jusqu'ici que les reçus poussés
   par WebSocket. Les envoyés sont limités aux **cinq plus récents**, le reste
   étant annoncé en texte : la liste reste courte après des mois de jeu.

**Couleurs : uniquement les tokens de la charte** (`--panel-2/3`, `--brand`,
`--brand-2`, `--brand-dark`, `--text`, `--line`) — l'écran suit les deux thèmes
sans surcharge, à trois exceptions près, **mesurées dans le navigateur** :
- `--muted` (4,2:1 jour / **3,1:1 nuit**) est inutilisable pour des libellés :
  onglets inactifs, ligne de règles et compteurs passent en `--text` (9,0 / 7,2) ;
- la pastille de statut de jour prend `--brand-dark` (6,5:1) là où `--brand-2`
  plafonnait à 3,9:1 sur sa propre pastille teintée ;
- l'onglet actif se détache en surface du thème (blanc + `--brand` le jour,
  `--panel-3` + `--brand-2` la nuit) : 5,5:1 et 5,8:1.

**Un piège de MESURE corrigé (le test se trompait, pas l'interface).** Le helper
de contraste du parcours Playwright lisait une couleur semi-transparente
(`rgba(29,158,117,.10)`) comme un **aplat plein** — il annonçait 2,23:1 pour la
pastille de statut. Il **compose désormais** toute la pile de fonds (dégradés
compris, alpha compris, du plus proche au plus lointain) sur le fond de page.
Premier correctif insuffisant : couper la remontée sur un dégradé *ancêtre* (halo
de fond translucide) écrasait le titre « Match » à 1,48:1 — un dégradé partiel
doit lui aussi se composer, il ne s'arrête plus la remontée.

**Vérifications.** `node test_scenarios.js` : **169/169** (161 + 8 : portée
`contacts`/`all`, plafond et absence de partie IA dans le fil public, défis reçus
/ envoyés / statut après refus). Harnais d'interface livré — nouveau scénario
`S12` (`_p13.js`, enregistré dans `_build.js` et `SCENARIOS`) : **13/13**, et
`S6`/`S9` adaptés aux onglets (`goMatchTab`) pour rester verts. Parcours
Playwright de campagne (serveur + base **jetables** sur le port 8098) : **90 / 90
— TOUT PASSE**, dont les nouveaux contrôles de l'écran Match (3 onglets, requête
`?scope=all` réellement émise, état d'erreur 401 simulé avec « Réessayer » qui
recharge, filtres de statut cohérents carte par carte, état vide actionnable,
mobile 390/360 sans débordement, actions et pastille de statut **visibles et non
recouvertes** en haut de page, actions du bas hors de la barre d'onglets
flottante). Contrastes mesurés dans la page : onglet actif
**5,5 / 5,75**, inactif **9,0 / 7,2**, statut **5,16 / 7,77**, règles **10,7 /
7,5**, titre **15,3** (jour / nuit) — tous AA ou mieux.
**À savoir :** l'étape S11 « le message arrive chez le destinataire en temps
réel » du harnais livré échoue **aussi sur la version committée** (vérifié par
comparaison) — défaut préexistant, hors périmètre de cette livraison.
**Aucune donnée client touchée** : tous les tests tournent sur copie jetable.
**Fichiers :** `D-aona/d-aona-web/index.html`, `d-aona-server/server.js`,
`d-aona-server/test_scenarios.js`, `d-aona-server/_p3.js`, `_p9.js`, `_p11.js`,
`_p12.js`, `_p13.js` (nouveau), `_build.js`, `test_ui_scenarios.js` (régénéré),
`CONTEXTE_PROJET.md`.

## 2026-09-17 — « Reprendre » : nouvelle carte centrée « Que voulez-vous faire ? »

**Refonte visuelle** de la modale du bandeau « Reprendre », sur maquette fournie :
elle adopte le gabarit d'un **dialogue « permission »** — une icône SVG unique
(anneau + triangle « lecture », `PG_ICO.resume`, trait 1.6, `currentColor`), un
**titre centré**, **une seule ligne de contexte**, puis **deux pilules** de même
gabarit : « Reprendre » pleine, « Regarder » creuse.
La surface sombre `.rp-shell` et le vocabulaire de l'onglet Jeux (eyebrow, titre à
mot accentué, tuiles `.pg-opt`, tags) disparaissent : la carte vit sur la surface
claire du thème courant, donc lisible de jour comme de nuit.

**Couleurs : la charte de l'app, pas le bleu de la maquette.** La carte reprend
**mot pour mot le bouton principal** : la pilule pleine porte le dégradé
`linear-gradient(180deg, var(--brand-2), var(--brand))`, l'arête
`rgba(124,240,200,.55)`, l'ombre verte et le texte blanc du thème jour — exactement
la recette de `.btn.primary` ; la pilule creuse prend le vert de marque en contour et
texte (`var(--brand)` le jour → `var(--brand-2)` la nuit, seuils AA). Aucun token
inventé, aucune constante en dur : la carte suit automatiquement les deux thèmes.
Un test interdit désormais toute trace de bleu de maquette (`#4f8ff7`, `#2f6fe0`,
`#7a9eff`) dans le sous-arbre de `#modal`.

**Règle métier inchangée, exprimée autrement.** Les deux choix restent toujours
affichés ; celui qui n'est pas disponible est neutralisé par l'attribut `disabled`
(opacité `.38`, `cursor: not-allowed`, `title` explicatif) au lieu d'une classe
`.pg-opt.off` — la cible tactile reste, le clic ne fait rien (vérifié).

**Ligne de contexte calculée sur les quatre situations** : les deux (« Votre partie
contre X · Blitz est en pause, et le match A vs B est toujours en direct. »), la
partie seule (« … est en pause. »), le visionnage seul (« Vous suivez le match A vs
B en direct. »), rien (« Rien à reprendre pour le moment. »). Repli grammatical si
le libellé du match n'est pas encore connu (« un match »).

**Deux pièges CSS trouvés et corrigés (documentés dans le code) :**
1. *Spécificité* : `html[data-theme="light"] .btn { color: var(--text-strong) }`
   compte un sélecteur de TYPE (`html`) en plus de ses deux classes ; aucune règle à
   classes seules ne pouvait la battre. La pilule creuse perdait sa couleur et la
   pleine son texte blanc → les règles de pilules sont ancrées à `#modal`.
2. *.rp-\* défini avant .btn* : le bloc `.rp-*` vit en haut de la feuille (près de la
   scène `/play`), `.btn` plus bas → le même ancrage `#modal` rend le résultat
   indépendant de l'ordre des déclarations.

Le ✕ passe en `position: absolute` dans la nouvelle variante `.modal.sm` (420 px,
coins 24 px, contenu centré, `showModal(html, "sm")`) : le `sticky/float` de
`.modal .m-close` cassait le centrage. Sous 360 px, les pilules s'empilent.
Nettoyage : `.rp-shell` retiré des sélecteurs partagés avec `.pg-shell` (plus aucun
consommateur), `.rp-head` / `.rp-split` / `.rp-note` supprimés ; `.pg-eyebrow`,
`.pg-title`, `.pg-acc`, `.pg-opt` intacts (toujours utilisés par l'onglet Jeux).

**Vérifications.** `node test_scenarios.js` : **161/161**. Parcours navigateur réel
(Playwright, serveur + base **jetables** sur le port 8098, match en direct entre deux
joueurs de test) : **TOUT PASSE** — carte centrée (icône 44 px, titre exact, deux
pilules 182 × 46 px, marges symétriques 23/23), « Reprendre » désactivé sans partie
en cours, « Regarder » actif, retour au plateau en mode spectateur, arrêt explicite,
390 px côte à côte, 360 px empilé sans débordement. Contrastes **calculés dans la
page** (le fond effectif de la pilule pleine est la moyenne des arrêts de son
dégradé — le test lit le `background-image`, pas une `background-color`) :
titre **18,3:1**, contexte **5,0:1**, **jour** pilule creuse 5,5:1 et pilule pleine
**4,85:1** — les deux tiennent enfin AA, contre 3,2:1 pour l'ancien blanc sur bleu ;
**nuit** pilule creuse 6,3:1 et pleine 4,89:1. Les pilules sont en outre comparées
aux tokens du thème résolus dans le navigateur (`--brand`, `--brand-2`), et tout bleu
de maquette dans `#modal` fait échouer la suite.
**Aucune donnée client touchée** : tests sur copie jetable de la base.
**Fichiers :** `D-aona/d-aona-web/index.html` (seul code modifié), `CONTEXTE_PROJET.md`.


## 2026-09-16 — « Reprendre » : split-screen « Mon match / Regarder » (entrée MANUELLE)

**Deux causes rendaient tout retour impossible.**
1. `route()` appelait `stopSpectating()` pour **toute route ≠ `board`** : changer
   d'onglet pendant qu'on suivait un match détruisait la session de visionnage
   (côté client *et* côté serveur, via `unspectate`). Revenir était donc
   impossible par construction.
2. `hasActiveGame()` ne consultait que `S.currentSession` — **votre** partie. Le
   bandeau disparaissait dès qu'on regardait le match de quelqu'un d'autre.

**Corrigé (`D-aona/d-aona-web/index.html`).** Le visionnage **survit** au
changement d'onglet ; il ne se termine plus que de deux façons : la fin du match
ou une action explicite. `updateResumeBanner()` affiche le bouton si une partie
est en cours **ou** si un match est suivi, dès qu'on n'est pas sur le plateau.
Libellé réduit à **« Reprendre »** (accolé au compteur, la phrase précédente était
illisible en largeur réduite). Le bandeau ouvre un **split-screen** reprenant le
langage visuel de l'onglet Jeux (eyebrow, titre à mot accentué, tuiles `.pg-opt`,
tags) : **Mon match** à gauche, **Regarder** à droite, les deux toujours affichés
et celui qui est indisponible **grisé** (`.pg-opt.off`), jamais retiré — on
comprend d'un coup d'œil ce qui est reprenable. « Regarder » réabonne
(`spectate`, sans doublon : le serveur garde un `Set`) et reçoit un état frais ;
un garde-fou de 2,5 s retire l'entrée si aucun état n'arrive (« Ce match n'est
plus disponible. »). Lancer **sa propre** partie — classée (`startServerGame`)
ou entraînement (`launchGame`) — met fin au visionnage : on ne peut pas jouer et
regarder le même plateau. Un match qui se termine pendant qu'on est ailleurs
prévient par notification au lieu d'imposer une modale par-dessus l'écran utilisé.

**Sortie explicite : bouton « Arrêter de regarder »** sur le plateau, visible
uniquement en mode spectateur (seul bouton actif, pleine largeur). Il devient
nécessaire précisément parce que le visionnage ne s'arrête plus en changeant
d'onglet. Piège CSS retrouvé et documenté : l'attribut `hidden` est **battu par
le `display` du bouton** → `.board-actions .btn[hidden] { display: none !important }`
(même correctif que `.help-toggle`).

**Mobile (même seuil que la scène `/play`, 860 px).** Le split **s'empile** en une
colonne. La scène `/play` passe ses tuiles en ligne compacte et **masque** leur
description ; ici les deux cartes *sont* tout le contenu de la modale, la
description est donc restaurée et le contenu aligné à gauche (sinon « Mon match »
se coupait). L'en-tête est placé **sur** la surface sombre : le titre de la scène
est blanc, il était invisible sur la modale claire du thème jour.

**Vérifications.** `node test_scenarios.js` : **161/161** (contre 160/161 avant, la
seule assertion en échec exigeait « plus de 20 » entrées de classement — elle
supposait la base peuplée par le seed, désormais vide par défaut ; réécrite pour
vérifier ce qui doit rester vrai). 3 assertions ajoutées au scénario spectateur :
reprendre renvoie un **état frais**, et **arrêt explicite puis reprise** fonctionne
(comptage des messages reçus, pas une simple relecture de la boîte). Parcours
**navigateur** (Playwright, serveur et base **jetables**) : 30 vérifications
passées — bandeau visible hors plateau, split 2 colonnes, « Mon match » grisé puis
**actif** quand une partie est en cours, « Regarder » ramène au plateau en mode
spectateur, « Arrêter de regarder » ramène à l'onglet Match et éteint le bandeau,
mobile empilé 1 colonne avec descriptions lisibles. **Aucune donnée client
touchée** : tests sur copie jetable de la base.
**Fichiers :** `D-aona/d-aona-web/index.html` (seul code modifié),
`d-aona-server/test_scenarios.js`, `CONTEXTE_PROJET.md`.

> **Rendu revu le 2026-09-17** — la description ci-dessus (split 2 colonnes, tuiles
> `.pg-opt`, tags, en-tête sur surface sombre, `.rp-split` / `.rp-shell`) est
> **historique** : la modale est devenue une carte centrée « Que voulez-vous
> faire ? » (voir l'entrée du 2026-09-17). La règle métier — les deux choix toujours
> affichés, l'indisponible neutralisé — n'a pas changé.


## 2026-09-16 — Inscription réparée · bouton « Définir mon mot de passe » retiré · base vidée

**Cause racine du « Créer mon compte » sans effet : les messages d'erreur étaient
INVISIBLES.** `.auth` (écran connexion/inscription) est un overlay **opaque** en
`z-index:200`, alors que `.toasts` était en `z-index:120` et `.modal-overlay` en
`z-index:90` : tout refus (pseudo déjà pris, quota, panne réseau) était peint
DERRIÈRE l'écran. Le journal d'audit le confirme — **aucun `register` enregistré**
alors que le bouton était cliqué.
- Correctif : `.toasts` → `z-index:500`, `.modal-overlay` → `z-index:400`.
- Contre-preuve : `POST /api/auth/register` renvoyait bien **200 + jeton** (compte
  créé) et **409 « Ce pseudo est déjà pris »** pour un pseudo existant. Le backend
  n'était pas en cause ; seule la restitution manquait.

**Synchronisation base ↔ backend ↔ frontend.**
- `TAKEN_PSEUDOS` (7 noms codés en dur) divergeait des **98 comptes** en base →
  remplacé par la route publique `GET /api/auth/available?pseudo=` (limitée en
  débit), interrogée pendant la saisie et au passage à l'étape 2/2.
- Un refus 409 s'affiche désormais **sous le champ pseudo** (et non plus seulement
  en notification).
- `users.email` n'était **jamais écrite** : l'email saisi dans « Email ou
  téléphone » était silencieusement jeté. Il est maintenant enregistré.
- « Compte unique par numéro / email » annoncé par l'interface est appliqué :
  409 si le téléphone ou l'email appartient déjà à un compte.
- Les **refus d'inscription sont journalisés** (`register_fail`) : un échec n'est
  plus indiagnosticable.
- Garde `file://` : ouverture du fichier par double-clic → message explicite au
  lieu d'un échec muet (`location.origin` vaut « null »).

**Retiré :** bouton « Définir mon mot de passe », sa modale, la route
`POST /api/auth/claim` et `D_AONA_ALLOW_LEGACY_CLAIM` — c'était le dernier point
faible connu (le premier arrivé pouvait réclamer un compte hérité), et il n'a plus
d'objet après le vidage. `test_auth.js` adapté (il vérifie désormais que la route
ne crée plus rien, avec et sans session) : **suite complète au vert**.

**Base vidée** via `wipe_db.js` : `DROP` des 18 tables (le `DELETE` est refusé par
les déclencheurs ajout seul du journal d'audit) puis `VACUUM`. Le schéma est recréé
au démarrage suivant (les 3 migrations se réappliquent). **0 ligne** dans toutes les
tables de données ; seul `schema_migrations` conserve ses 3 lignes de traçage.
Le **seed est désormais désactivé par défaut** (`D_AONA_SEED=1` pour le réactiver) :
il réécrivait 98 comptes + 5 tournois à chaque démarrage, ce qui annulait tout
nettoyage.

**Skills installés** (via `npx skills add`, dans `.agents/skills/` + `.claude/skills/`) :
`addyosmani/agent-skills` (25 skills) et `DietrichGebert/ponytail` (6 skills).

**Deux défauts trouvés en revue de code, puis corrigés (migrations 004 et 005).**
- `004_unique_contact` : « compte unique par numéro / email » n'était qu'un
  contrôle applicatif — deux inscriptions simultanées pouvaient passer toutes les
  deux. Index UNIQUE **partiels** sur `users.phone` et `users.email` (les NULL et
  valeurs vides restent autorisés) : c'est la base qui tranche désormais, et
  `register` distingue le refus par le nom de l'index en cause.
- `005_skins_foreign_keys` : `user_skins` et `equipped_skins` n'avaient **aucune
  clé étrangère** — supprimer un compte laissait ses lignes de skins orphelines
  pour toujours (3 + 3 constatées). Tables reconstruites avec
  `REFERENCES users(id) ON DELETE CASCADE` (SQLite ne sait pas ajouter une
  contrainte à une table existante : recréation + recopie + renommage), lignes
  sans propriétaire écartées au passage. Cascade vérifiée par test.
- Autre point de revue : la vérification de disponibilité du pseudo se fait
  **au quitter le champ** (et à l'étape 2/2), plus à chaque frappe — le limiteur
  de débit (12 requêtes / 5 min) est partagé avec `register` et `login`, une
  requête par frappe aurait recréé un « Trop de tentatives ».

**Modifiés :** `d-aona-server/server.js` (seed conditionnel, route `available`,
`email` transmis), `auth.js` (`register` : email, unicité email/téléphone, refus
journalisés ; suppression de `claim`), `test_auth.js`, `.env.example`,
`SECURITE_AUTH.md`, `D-aona/d-aona-web/index.html`, `skills-lock.json`.
**Ajouté :** `d-aona-server/wipe_db.js`, `migrations/004_unique_contact.sql`,
`migrations/005_skins_foreign_keys.sql`.

**Simplifications volontairement NON faites (assumées) :** suppression des colonnes
mortes `users.password_hash` et `users.region` — la migration historique de db.js
lit encore `region`, il faudrait réécrire ce bloc ; à faire quand le schéma sera
figé. Colonnes `kyc`/`bonus_lock`/`bonus_used` laissées telles quelles.

**Vérifications :** `node test_auth.js` → tous les tests passent · inscription de
bout en bout sur **copie jetable** de la base (200 + jeton, `GET /api/user` 200,
409 doublons, email/téléphone en base, `register_fail` journalisé) · base réelle
**vide** après redémarrage · HTML servi : `z-index` corrigés, bouton et route
`claim` absents.
## 2026-09-26 — Bouton « Déconnexion » rendu visible : remonté sur la carte d'identité du profil

**Demande.** « Ajoute le bouton déconnecter dans le profil. »

**Constat.** Le bouton **existait déjà**… mais tout en bas de `#/profile`, dans le panneau
« Paramètres », donc **après** la boutique de skins et l'inventaire : il fallait dérouler
tout le profil pour le trouver, aux deux gabarits (la maquette v3a, elle, n'en prévoyait
aucun — vérifié : aucune occurrence de « connexion » dans son HTML).

**Correctif (`D-aona/d-aona-web/index.html`).** Le bouton **remonte sur la carte
d'identité** — première carte de la colonne gauche, visible **sans défilement** aux deux
gabarits — dans un pied `.pstats-account` (filet de séparation `.5px --line`, même rythme
que la rangée secondaire des statistiques). Mêmes recettes que le reste de l'app : classe
`.btn.danger.block` (douceur rouge + encre du thème, `html[data-theme="light"] .btn`
fournit l'encre du thème jour) et libellé **« Déconnexion » conservé à l'identique**, donc
les sélecteurs `#profile-root button.danger` + `hasText` des tests continuent de le
retrouver. L'icône est un **SVG `stroke="currentColor"`** (flèche sortante, famille des
icônes de la barre haute) : l'émoji 🚪 s'affichait en aplat monochrome illisible.
Le **doublon est retiré** du panneau « Paramètres » (une action = un contrôle ; « Service
client » et « Partager le lien » y restent). Aucune requête supplémentaire : le bouton
appelle toujours `App.logout()` (révocation **serveur** puis jeton oublié).

**Vérifications.** `_probe_profil_v3.js` **42/42** — dont « non-régression : avatar
S/M/L, photo, badge, Déconnexion » et « 360 px : le profil passe en une colonne, sans
débordement » · `test_ui_scenarios.js` **110/110**, y compris l'étape S1 « déconnexion par
le bouton « Déconnexion » de l'écran Profil » · captures jour / nuit / mobile relues :
bouton lisible dans les deux thèmes, cible ≥ 44 px. **Aucune donnée client touchée.**
**Fichiers :** `D-aona/d-aona-web/index.html` (seul code modifié), `CONTEXTE_PROJET.md`.


## 2026-09-26 — Correctif visuel profil v3a : la bannière « Sample » et le CTA boutique étaient écrasés en mode plein écran

**Constat.** Après l'intégration de la maquette v3a, les captures montraient la bannière
`#pf3-ad` **aplatie à ~44 px** (ses seuls paddings, contenu rogné par `overflow: hidden`)
et la carte CTA « Boutique de skins » réduite au minimum, tandis que les cartes
Notifications et Wallet semblaient **manquantes** dans la colonne gauche.

**Cause racine** (instrumentation navigateur `_dbg_v3a.js`, instance jetable port 8095,
base seedée) : en mode « plein écran » (`body.is-fill`), chaque colonne du profil est un
conteneur **flex à hauteur imposée** inférieure à la hauteur cumulée du contenu (espace
négatif). `.pf3-ad` et `.pf3-skin-cta` portent `overflow: hidden`, ce qui abaisse leur
**taille minimale automatique à 0** (`min-height: auto` = 0 dès que `overflow ≠ visible`) :
l'algorithme flex les réduisait jusqu'à leurs paddings. Notifications et Wallet n'étaient
**pas absentes** : la colonne gauche fait ~1056 px pour ~658 px visibles — elles étaient
sous la ligne de flottaison (la colonne défile, motif des autres écrans plein écran).

**Correctif (2 lignes CSS, `D-aona/d-aona-web/index.html`).** `flex: 0 0 auto` sur
`.pf3-ad` et `.pf3-skin-cta` : la hauteur de contenu est garantie quelle que soit la
contrainte de la colonne ; commentaires CSS expliquant la garde. Aucune retouche de la
carte d'identité (motif partagé avec d'autres écrans).

**Vérifications.** Sondes instrumentées : `adH 44 → 126`, enfants de la bannière tous
peints ; après défilement de la colonne gauche, Notifications et wallet « carte bancaire »
(96 px) visibles ; mobile 360 px : **aucun débordement** (`docW = winW = 360`),
`.pf3-bottom` en une colonne ; captures jour / nuit / mobile relues. Sondes
`_probe_profil_v3.js` **42/42**, `test_ui_scenarios.js` **110/110**. Script de débogage
`_dbg_v3a.js` supprimé (outil jetable).

**Reste ouvert.** Échec préexistant `_layout_fill.js` (Accueil `defis-home hg-scroll`) ;
limite des 50 dernières transactions du wallet inchangée ; recharger localhost:8080.


## 2026-09-26 — Profil réorganisé (maquette « carte unique »), filtres du Wallet, recherche de joueurs dans la barre haute

**Demande.** (1) Adapter l'interface en s'inspirant de la maquette HTML
`daona-profil-v3a-carte-unique.html` (hors dépôt) — **palette et barre de
navigation d'origine conservées**, la maquette ne servant que d'inspiration pour
l'organisation du tableau de bord ; (2) ajouter dans le Wallet une barre de
filtre des transactions (date : récent / ancien / entre deux dates · type ·
libellé) ; (3) ajouter dans le header une recherche de joueurs (amis ou non).

**Écran retenu : le Profil** (`#/profile`) — c'est le sujet de la maquette
(« Profil ») et il portait déjà la carte d'identité, le KYC et la boutique.

**1. Profil réorganisé.** La carte d'identité passe à **trois statistiques
séparées par des filets** (Parties · Victoires · Défaites) puis une **rangée
secondaire sous un filet** (Taux de victoire · Rang national), exactement la
hiérarchie de la maquette ; le solde quitte les tuiles et reçoit **sa propre
carte** (« Solde disponible » + Déposer/Retirer + raccourci historique, variante
`balance-card.mini`) ; une carte **Notifications** montre les **trois dernières**
notifications réellement poussées par le serveur (mention « Non lu » selon leur
état, jamais marquées lues à la place du joueur) ; la colonne de droite ouvre sur
une carte **Progression Elo** tracée depuis les **instantanés réels** de `games`
(migration 006) avec fenêtre **10 / 20 / 50 dernières parties** — un compte sans
deux parties suivies voit un **état vide explicité**, jamais une courbe inventée.
La fabrique `profileStatsHtml` est partagée par « mon profil » et le **profil
public** : un tiers voit la même carte, mais **aucun bloc privé** (ni solde, ni
notifications, ni KYC, ni courbe) — vérifié en navigateur.

**2. Wallet : filtres de l'historique.** Dans le panneau « Historique des
transactions » : chips **Toutes dates / Récent (30 j) / Ancien (> 30 j)** + deux
champs **`<input type="date">`** natifs (« Du » / « Au » — aucune dépendance),
chips des **huit familles réelles** de libellés (`Dépôts`, `Retraits`,
`Remboursements`, `Achats`, `Gains`, `Mises`, `Bonus`, `Autres`, dérivées des
appels `Wallet.credit` / `Wallet.spend` de `server.js`), `searchbar` du composant
`SearchToggle` pour le **libellé** (insensible à la casse **et aux accents**),
compteur `n / total` + bouton **Réinitialiser**. Le filtrage est **local** sur
`S.txs` (les 50 derniers mouvements de `/api/user`) : aucun appel réseau par
frappe, aucune ligne fabriquée, état vide explicite. La comparaison de dates
porte sur la **chaîne affichée** (UTC SQLite), donc « ce qui est lu est ce qui est
filtré ».

**3. Header : recherche de joueurs.** Une **pastille `.searchbar.compact`**
(`#top-searchbar`) prend place entre le logo et les contrôles existants — mêmes
composant et API que l'écran Amis (`/api/users/search?q=`, debounce 300 ms,
Entrée immédiate) ; les résultats s'affichent dans un **panneau ancré sous la
barre** (avatar, pseudo, Elo, `Déjà ami` / `Demande envoyée` / `📨 Envoyer une
demande`), le clic ouvre le profil (`App.openProfileById`), un pied « Voir tous
les résultats » mène à l'écran Amis ; croix, `Échap` et clic extérieur replient.
À 360 px, la pastille garde 34 px et **la barre ouverte recouvre la ligne** :
la barre haute reste sur **une seule ligne** (mesuré), aucun débordement.

**Palette et navigation.** Aucun jeton nouveau : `--panel*`, `--line`,
`--brand*`, `--brand-ink`, `--green/--red/--amber(-soft)`, `--radius-card`,
`--shadow-*`. La **barre d'onglets lumineuse est intacte** (aucun changement de
`#mainTabbar`), comme la barre haute existante (KYC, thème, amis, notifications,
solde, avatar) : la pastille de recherche **s'ajoute**, rien n'est déplacé.

**Défaut réel corrigé en cours de route (trouvé par mesure, pas par lecture).**
Les points de la courbe étaient dessinés **décalés d'un demi-écran** : la classe
`.dot` existe déjà dans la feuille du plateau (`.dot { transform:
translate(-50%,-50%) }`, l. 1208) et s'appliquait aux cercles du SVG. Les classes
de la carte sont désormais **préfixées** (`elo-line`, `elo-dot`, `elo-dot-last`,
`elo-grid`, `elo-area`) ; mesure après correction : **écart point↔tracé = 0** sur
les 8 points, en positions rendues. Même vigilance appliquée aux autres noms
(`.pstats*`, `.tx-filters`, `.tsr-*`, `.balance-card.mini` : aucun conflit avec
la feuille existante).

**Contrôles.** `node _check_html.js` **OK** (script en ligne compilé) ·
`node test_ui_scenarios.js` **110/110** (dont S2 navigation, S7 wallet, S8
boutique/profil, SX hygiène : aucune erreur JS) · `node _probe_profil_v3.js`
**37/37** (nouvelle sonde : profil, profil public, recherche du header, filtres
du wallet, mobile 360 px) · `_dbg_elo.js` / `_dbg_wallet.js` (diagnostics) ·
`_layout_fill.js` **193 ✓ / 1 ✗** — l'échec `[home] les 4 familles de blocs`
est **antérieur** : l'Accueil n'a pas été touché, et là où le HEAD porte
`class="defis-home"`, l'arbre de travail porte `defis-home hg-scroll` (lot
« plein écran » précédent) · captures jour/nuit/bureau/mobile dans
`%TEMP%\daona_shots`.

**Fichiers.** *Modifié :* `D-aona/d-aona-web/index.html` (CSS Accueil/Profil/
Wallet/barre haute ; `renderProfile`, `renderPublicProfile`, `renderWallet`,
`bindGlobal` ; nouveaux helpers `profileStatsHtml`, `profileWalletCardHtml`,
`profileNotifCardHtml`, `eloCurveCardHtml`, `txKind`/`txList`/`txListRender`,
`mountTopSearch`). *Ajoutés (outils de vérification, comme `_s*_verif.js`) :*
`_probe_profil_v3.js`, `_shots_profil_v3.js`, `_dbg_elo.js`, `_dbg_wallet.js`.
*Serveur :* **aucun changement** — les filtres lisent l'historique déjà renvoyé
par `/api/user`.

**Écarté de la maquette** (et pourquoi) : sa barre latérale teal et sa police
Poppins (navigation et identité d'origine conservées) · la bascule factice D/S/M/A (remplacée par la
fenêtre réelle 10/20/50) · la bande de jours du « prochain match » (aucune date
réelle à y attacher sur le Profil) · toutes ses données d'exemple (Ny Angola,
Ar 135 400, « Rakoto H. », axe 2024-2026…), jamais affichées.

> **Mise à jour du 27/09/2026** : seul le **bandeau publicitaire** a finalement été
> repris, à la demande du commanditaire — il porte désormais le visuel officiel du
> partenaire **Yas** (trophée nPerf 2025). Voir l'entrée « Emplacement publicitaire
> du Profil » ci-dessous, qui remplace le « aucune publicité dans l'app » ci-dessus.

## 2026-09-27 — Jeu de données de test : l'historique de « Ny Angola » porté à 50 parties

**Demande.** « Mettre le donnée de Ny angola avec beaucoup de jeux, ce sera pour un test. »

**Point de départ.** Le compte #1 `Ny Angola` n'avait qu'**une** partie classée (Elo 1084) :
sa carte affichait donc légitimement « Pas encore de courbe », et ses statistiques
tenaient en un chiffre par case.

**Ce qui a été inséré.** **49 parties classées terminées** réparties sur **120 jours**
(23/05 → 20/09/2026) avec leurs instantanés d'Elo : le Profil montre désormais **50 points**
de courbe, une progression **912 → 1084 (+172)**, **29 victoires / 21 défaites**, des
formats variés (blitz, rapide, pro) et des fins variées (capture, abandon, blocage), avec
plusieurs parties le même jour — ce qui exerce au passage le tri chronologique.

**Règle d'honnêteté respectée.** Les nouvelles parties sont insérées **avant** la plus
ancienne du compte, et la plus récente se termine exactement sur l'Elo « avant » de la
partie #547 (1 100) : l'Elo courant du compte reste la vérité, sans aucune retouche des
données existantes. Les parties se jouent contre un **compte de test dédié**
(« Sparring Test », #30) et non contre un compte existant, et le camp adverse garde ses
colonnes d'instantané **vides** (seul l'écart symétrique est enregistré) : aucun
historique d'un autre joueur n'est modifié, et sa propre courbe ne bouge pas.

**Outil — `_seed_parties_elo.js` (nouveau).** Mesure par défaut, `--apply` pour écrire,
**sauvegarde vérifiée** avant écriture, puis **manifeste** (`_seed_parties_manifest.json`)
qui liste les 49 identifiants insérés et le compte adverse créé : l'opération est
**annulable** ligne par ligne. Options `--pseudo=`, `--nb=`, `--jours=`, `--adv=`,
`--seed=` (tirage reproductible). Contrôle après écriture relu en base : **51 conformes,
0 écart** (chaîne continue, `after = before + delta`, dernier point = `users.elo`).
Les compteurs ont ensuite été réalignés (`_sync_compteurs.js --apply`) : **14/14 comptes
conformes** — `Ny Angola` affiche 29 V / 21 D et `Parties = 50`, `Sparring Test` 20 V / 29 D.

**Vérification à l'écran.** `_check_elo_reel.js "Ny Angola"` : **7/7** — `ELO 1084 ·
PARTIES 50 · RANG #14 · GAGNÉ 29 · DÉFAITE 21`, 50 points tracés, pied
« 912 → 1084 (+172) », écart point ↔ tracé ≤ 0,75 px, aucune erreur JS. Le harnais a
d'ailleurs été corrigé à cette occasion : il jugeait le remplissage des **deux** camps
alors que l'interface juge celui du joueur — un adversaire sans instantané faisait
disparaître à tort les parties de la courbe.

**Fichiers.** *Ajoutés :* `d-aona-server/_seed_parties_elo.js`, `d-aona-server/_inspect_compte.js`
(mesure d'un compte précis, lecture seule) et `d-aona-server/_seed_parties_manifest.json`
(généré à l'écriture).


## 2026-09-27 — Courbe Elo et statistiques du Profil : fonctionnelles sur les données réelles

**Demande.** « Je voudrais maintenant que la courbe d'élo marche et que les statistiques
marchent et fonctionnel à 100 % — faire tous les tests. »

**Ce que la mesure a montré.** Sur la base réelle : **547 parties, 0 instantané d'Elo**
(`elo1_before/after` tous à NULL). Les colonnes ne sont écrites qu'à la **fin d'une
partie**, et toutes les parties existantes dataient d'avant la livraison de la
migration `006` : la carte affichait donc honnêtement « Pas encore de courbe » pour
**tous** les comptes, y compris ceux qui avaient 188 parties au compteur. Le code, lui,
était correct (`test_scenarios.js` vérifie l'écriture de l'instantané des deux camps) :
ce sont les **données** qui manquaient. Deuxième écart mesuré : `users.wins/losses`, cache
dénormalisé de `games`, s'écartaient de 28 à 36 parties de l'historique réel sur 8
comptes de démonstration.

**1. Reconstitution des instantanés manquants — `_backfill_elo.js` (nouveau).** L'Elo
avant/après est remonté depuis **deux faits enregistrés** : `users.elo` (vérité du
dernier point) et l'écart réel de chaque partie (`delta1`/`delta2`). D'où, de la plus
récente à la plus ancienne, `after(i) = before(i+1)` et `before(i) = after(i) − delta(i)` :
le niveau est ancré sur l'Elo affiché, les variations sont les écarts enregistrés —
aucun modèle, aucune estimation. **Garde-fous** qui arrêtent la remontée, en laissant
les parties plus anciennes vides (« Données indisponibles ») : écart de joueur absent,
pénalité d'inactivité (`users.last_decay`) postérieure à une partie (l'Elo a bougé hors
partie), instantané déjà présent mais incohérent avec la chaîne. Mode par défaut :
**mesure seule** ; `--apply` écrit en une transaction **après** une sauvegarde vérifiée
(`backup_db.js`). Résultat : **1 088 camps complétés, 0 rupture, 1 096 contrôles
conformes après écriture**. Contrôle d'ancrage ensuite sur la base réelle : pour chaque
compte suivi, `users.elo` = dernier instantané (`_inspect_stats.js`, nouveau).

**2. Compteurs du Profil alignés — `_sync_compteurs.js` (nouveau).** Les compteurs sont
recalculés depuis les parties réellement enregistrées, avec la règle de `handleGameEnd`
(une partie d'entraînement IA ne compte ni victoire ni défaite) : `wins` = parties
gagnées, `losses` = parties perdues. Après alignement : **13/13 comptes conformes**, donc
`Parties = Gagné + Défaite` partout, et l'affichage cesse de contredire l'historique.

**3. Ordre chronologique garanti.** La courbe et l'historique ne se fiaient qu'à
`created_at` : deux parties jouées **le même jour** (fréquent, l'heure n'est pas
affichée) ou une date absente laissaient l'ordre au hasard, et la courbe reliait alors
les points dans le désordre. `db.js` trie désormais `ORDER BY g.created_at DESC,
g.id DESC`, et `eloSeries` (index.html) trie explicitement par date **puis** par
identifiant de partie avant de tracer.

**4. `_dbg_elo.js` réparé.** Le contrôle rapproché des points **plantait** sur le tracé
lissé : il relisait les commandes cubiques (`C…`) comme des sommets et produisait un
`NaN`. Il échantillonne maintenant le **chemin rendu** (`getPointAtLength`) et garde les
sommets à part. Mesure sur 8 points : **écart point ↔ tracé ≤ 0,35 px, écart aux sommets
= 0 partout** — le décalage du bug historique `.dot` est bien derrière nous.

**5. Sonde dédiée — `_probe_elo_stats.js` (nouveau, 31 contrôles).** Elle relie la
donnée serveur au pixel : statistiques = `/api/user` + classement (`Parties = Gagné +
Défaite`, encres `pos`/`neg`, rang réel) ; courbe = **un point par partie suivie** (une
partie « en cours » n'en produit aucun) ; fenêtres D / S / M / A recalculées depuis
l'API (2 / 3 / 6 / 8 points sur le jeu de contrôle) ; marqueur du dernier point posé sur
le dernier point ; état vide expliqué pour un compte à une seule partie ; profil public
sans courbe ; encre du tracé qui suit le thème jour/nuit. **31/31.**

**Vérification complète (base jetable à chaque fois, aucune écriture réelle).**
`test_auth.js` · `test_scenarios.js` **240/240** · `test_ui_scenarios.js` **114/114** ·
`_probe_profil_v3.js` **41/41** · `_probe_elo_stats.js` **31/31** · `_apercu_pub.js`
**42/42** · `_data_probe.js` **16/16** · `_probe_ovf_360.js` (aucun débordement de page
à 360 / 390 px) · `_contraste.js` (AA) · `_check_html.js` (**5 989 lignes**, balises
équilibrées, syntaxe OK, `_inline.js` régénéré) · `_layout_fill.js` **202/2** — les 2
échecs sont **antérieurs** et sans rapport (conteneur défilant de la page Chat) ·
`_revue_ui.js` (60 captures, **450 segments** mesurés, **0 sous le seuil AA**, 0
débordement, 0 erreur JS) · `_livecheck.js` **13/13** sur le serveur en service (8080,
front à jour servi sans redémarrage) · **7/7** sur les **données réelles**
(`_check_elo_reel.js`, nouveau : compte `DemoFara`, 49 points tracés, 1 576 → 1 657,
écart point ↔ tracé ≤ 0,75 px, mot de passe redéfini **sur la copie seulement**).

**Fichiers.** *Modifiés :* `d-aona-server/db.js` (tri stable de l'historique),
`d-aona/d-aona-web/index.html` (`eloSeries` : tri chronologique explicite),
`d-aona-server/_dbg_elo.js` (mesure sur le chemin rendu). *Ajoutés :*
`_inspect_stats.js`, `_backfill_elo.js`, `_sync_compteurs.js`, `_probe_elo_stats.js`,
`_check_elo_reel.js`.
Rien n'est fabriqué : la reconstitution ne s'appuie que sur `users.elo` et sur les écarts
réellement enregistrés, et tout ce qui n'est pas reconstructible reste vide à l'écran.



## 2026-09-27 — Emplacement publicitaire du Profil : le visuel officiel du partenaire Yas (trophée nPerf 2025)

**Demande.** Remplacer le placeholder publicitaire du Profil par le visuel
**officiel** du partenaire Yas — l'annonce « Yas, élu meilleur réseau mobile de
Madagascar avec le trophée nPerf » — et le rendre lisible sur téléphone.

**Ce qui était en place.** Une **reconstitution vectorielle** maison
(`assets/ad/yas-nperf-2025.svg`) rasterisée en JPEG sous le nom attendu par la
page, faute de photo d'origine sur le disque : un dessin valide, mais pas l'asset
du partenaire.

**1. L'asset officiel, servi avec son vrai type.** Le WebP est récupéré du CDN de
yas.mg — `NPERF-yas.mg_2560x960.webp`, **2 560 × 960**, **247 Ko** (URL vérifiée
HTTP 200 / `image/webp` / 253 076 octets, identiques au fichier local) — et déposé
`assets/ad/yas-nperf-2025.webp`. Aucun ré-encodage : `image/webp` est ajouté à la
**table MIME** de `server.js`, plutôt que de faire croire à un `.jpg` en reniflant
un en-tête menteur. Le repli `onerror` (`AD_VISUEL`, `index.html`) bascule sur le
SVG : ni image cassée, ni 404 en console. `_pub_rasteriser.js` et son JPEG de
remplissage sont **supprimés** — plus rien à fabriquer, le fichier est celui du
partenaire.

**2. Cadrage mobile 16:9 ancré à gauche.** À 390 px la colonne ne fait que
**362 px** : le ratio natif 2,67:1 y réduisait le bandeau à ~136 px, texte
illisible. Sous 560 px, `@media (max-width: 560px) .pf3-ad-img` passe donc en
`aspect-ratio: 16 / 9` + `object-position: 0% 50%` → boîte **362 × 204**, fenêtre
source visible **x 0 → 1707** : le bloc qui porte le sens (titre, picto 5G, logo
nPerf, médaillon, `www.yas.mg`) reste entier, et seul l'emblème `yas` du coin
droit sort du cadre — à dessein. Au-delà de 560 px, rien ne change : le plafond
`max-height: 420px` ne mord qu'au-dessus de ~1 500 px d'écran et ne rogne que le
ciel et le bois de la table.

**Vérification.** `_apercu_pub.js` : **42/42**. Le harnais mesure les **deux
chemins séparément** (`NATIF` 2 560 × 960 pour le WebP, `NATIF_SECOURS`
2 304 × 864 pour le SVG maison — chacun est jugé contre la source qu'il affiche),
à cinq largeurs de colonne (1 334 → 292 px) et à 390 px ; l'encre de marque est
isolée par le discriminant `B > G + 25` (un premier masque « bleu » capturait les
verts de la photo). `_probe_profil_v3.js` : **41/41** (bandeau présent, fermeture
✕ mémorisée, aucune erreur JS ; libellés « bannière Sample » renommés « bannière
partenaire (Yas / nPerf) »). `_revue_ui.js` : 60 captures, 450 segments mesurés,
**0 sous le seuil AA**, 0 débordement, 0 erreur JS. `_check_html.js` : 5 982
lignes, balises équilibrées, syntaxe OK.

**Documentation.** `assets/ad/README.md` (provenance du WebP, remplacement du
visuel, zone sûre) et la section « Emplacement publicitaire du Profil » de
`d-aona-web/README.md` (la limite « lisibilité mobile » y passe de *non traitée*
à *traitée*).


## 2026-09-26 — Boutique de skins : page dédiée `#/skins` — couleur × motif, deux choix indépendants (16 × 9 = 144 combinaisons)

**Demande.** Sortir la boutique de skins du Profil et abandonner les « skins de
pions » prêts-à-porter : le joueur compose lui-même son pion en choisissant une
**couleur** (16) puis, s'il le souhaite, un **motif** (9, « Aucun motif » inclus).

**Écran retenu : « Boutique de skins »** (`#/skins`). Nouvelle section
`#screen-skins` (racine `#skins-root`), entrée de routeur `skins` inscrite dans
`ROUTES` et `FILL_ROUTES` (gabarit plein écran), onglet **Profil** allumé — la
personnalisation reste du ressort du profil — et lien de retour « ← Profil ». Le
point d'entrée depuis le Profil est la carte CTA existante (`#pf3-skin-cta`,
`href="#/skins"`), relabellisée pour la page dédiée.

**1. Deux axes indépendants — aucune combinaison n'existe.** Deux catalogues :
`PION_COLORS` (16 : 8 claires, encre sombre / 8 sombres, encre claire) et
`PION_PATTERNS` (9, dont `aucun` = pion uni, obligatoire pour qu'une couleur
seule reste utilisable). Côté **serveur** (`data.js`) les catalogues ne portent
que les **identités** (`id`, `name`, `group`) ; toute l'**apparence** vit côté
client (trois arrêts de dégradé + encre pour les couleurs, géométrie pour les
motifs), comme `grad` pour les skins. Ce qui s'enregistre n'est jamais une
combinaison : la table `pion_style` porte un `color` ET un `pattern` **séparés**,
donc 16 × 9 = 144 apparences possibles **sans qu'aucune n'existe** en base ni en
CSS — ajouter « Rose » ou un motif « Fosikabo » au catalogue (et son apparence)
suffit à le rendre combinable avec toute l'autre liste, sans migration.

**2. La page, en cinq parties.** (a) « Aperçu du pion » — le pion **en grand**
puis à la **taille réelle du plateau**, plus la phrase qui énonce la règle
(« changez l'un, l'autre est conservé ») ; (b) « Personnalisation actuelle » —
résumé Couleur / Motif, bouton « Appliquer ce skin » **désactivé tant que rien
n'a changé**, phrase d'aide qui distingue « non appliqué » de « déjà appliqué » ;
(c) « Couleur du pion » — deux sous-groupes (claires / sombres), 16 cartes, **le
nom est écrit** (jamais la seule pastille : lisibilité daltonienne) ;
(d) « Motif du pion » — les 9 motifs en vignettes (silhouettes, puis les quatre
illustrations servies par `assets/pions/` depuis le 03/10/2026), « Aucun motif » en tête ;
(e) « Plateau & effets » — les skins du plateau et des effets restent vendus ici,
inchangés. Les deux choix vivent dans un **brouillon** (`pionDraft`) distinct de
l'état enregistré : cliquer une couleur ne touche jamais au motif, et
inversement (`refreshPionPreview()` redessine l'aperçu, le résumé et l'état du
bouton sans toucher `S.pion.style`).

**3. Le motif est un masque, jamais une image.** Chaque `svg` du catalogue est
inséré dans un SVG `viewBox="0 0 24 24"` par `motifUri()` et appliqué en
`mask-image` sur un pseudo-élément : le motif prend donc l'encre
`--pion-ink` de la couleur choisie — lisible sur « Blanc » comme sur « Noir »
(un motif blanc disparaîtrait sur les couleurs claires, un motif noir sur les
sombres). `mountPionStyles()` génère **une fois** les 16 blocs couleur et les
9 blocs motif dans `#pion-styles` (`--pion-grad`, `--pion-ink`, `--pion-mask`) :
l'aperçu, les vignettes, la taille réelle et le plateau consomment **exactement
les mêmes variables**, un écart d'aperçu est donc impossible.

> **Complément du 03/10/2026 — quatre motifs passent à l'illustration.** Le principe
> « le motif est un masque, jamais une image » vaut encore pour les **cinq** motifs
> dessinés à la main (caméléon, PRA, pangalatra, lefona, `aucun`) ; le **lémurien, le
> zébu, le crocodile et le ravinala** sont désormais les PNG détourés de
> `assets/pions/`, peints tels quels en `background-image` (`--pion-motif-img`,
> `--pion-mask: none`, encre transparente) : ils portent leurs propres couleurs et ne
> prennent donc pas l'encre du pion. `mountPionStyles()` génère les deux familles dans
> les quatre jeux de variables (moi | adversaire × clair | sombre), et `_pions_verif.js`
> (33/33) le vérifie — plateau compris. Cf. l'entrée du 03/10/2026 et
> `assets/pions/README.md`.
>
> **Complément du 04/10/2026 — un dessin par camp.** Ces quatre motifs portent désormais
> DEUX fichiers : `img` (pions CLAIRS, lot `Assets-premiere-version`) et `imgDark` (pions
> SOMBRES, lot `Assets-noirs-contraste-initial`). C'est le **groupe du jeu de variables**
> qui choisit le fichier — suffixes clairs → lot clair, `-dark` / `-opp-dark` → lot
> sombre — sans variable ni rebinding de plus : aperçu, vignettes, plateau et inventaire
> suivent la recette unique. Les deux lots sont des dessins différents du même sujet (le
> zébu sombre est blanc-dominant), ce que le lot sombre annonce lui-même. `_pions_verif.js`
> (**54/54**) le vérifie, captures des deux camps à l'appui. Cf. l'entrée du 04/10/2026.

**Bug corrigé en cours de lot.** « Aucun motif » est un masque *vide*, or un
pseudo-élément non masqué peignait un disque d'encre plein sur le pion. Une
variable dédiée `--pion-motif-ink` (transparente pour `aucun`, égale à l'encre
du pion sinon) sépare l'encre du motif de celle du pion : la couleur seule donne
désormais un pion **uni**, vérifié par mesure du `mask-image` et de la
`screenshot` (jour/nuit).

**4. Profil nettoyé.** Le panneau « Boutique — Skins », l'inventaire et les
filtres de portée (`data-skinscope`) sont **retirés** du Profil ; les vues
partagées se redessinent selon la route réellement affichée
(`refreshSkinsViews()`), plus « le Profil » en dur. `mountSkinStyles()` ne
génère plus que les règles des skins **sombres** de pions et **seulement** pour
`.piece.opp` : les pions du joueur (`.piece.me`) n'obéissent plus qu'à
`pion_style`, un seul mécanisme par camp.

**5. Serveur.** `data.js` : `PION_COLORS` / `PION_GROUPS` / `PION_PATTERNS` /
`PION_DEFAULT` et les deux résolveurs `pionColor()` / `pionPattern()` exportés.
`db.js` : table `pion_style(user_id PK, color, pattern)` + objet `PionStyle`
(`get` / `set`) et **initialisation à l'inscription** dans les deux chemins de
création de compte (le défaut est écrit, jamais deviné). `server.js` :
`GET /api/skins` renvoie en plus `colors`, `groups`, `patterns`, `pionStyle`
(les clés existantes `skins` / `owned` / `equipped` sont intactes) et
`POST /api/pion/style` valide **chaque** identifiant contre les catalogues
serveur — couleur ou motif inconnu, ou champ vide → **400**, et **rien n'est
écrit**. Un appel direct ne peut donc pas enregistrer une combinaison ou une
couleur inventée.

**6. Migration `009_pion_style` (aucun achat perdu).** Crée la table et une ligne
par compte existant, la couleur étant **reprise de l'ancien skin de pions clairs
équipé** : `pions-clair-emeraude` → `vert_clair`, `pions-clair-obsidienne` →
`jaune`, `pions-clair-dragon` → `orange_clair`, tout le reste →
`blanc` (l'ivoire du pion Vato, qui est aussi le défaut). Le skin **sombre**
équipé n'est pas converti : il continue d'habiller les pions de l'adversaire, le
joueur retrouve donc **le même plateau** que la veille. Les lignes de
`user_skins` et `equipped_skins` sont **conservées** (historique des achats
lisible). Chaîne de migrations revalidée sur base **neuve** : un défaut de
graine (`equipped_skins` créée d'emblée avec `pions_light`/`pions_dark`, alors
que les migrations 005/008 attendent la colonne d'origine `pions`) faisait
échouer la 008 sur une base vierge — graine remise dans sa forme d'origine, les
migrations restant la seule source du schéma final. Aucun fichier de migration
**déjà appliqué** n'est retouché, même dans ses commentaires : l'empreinte
SHA-256 conservée dans `schema_migrations` refuse toute réécriture (la garde a
été déclenchée puis le fichier restauré à l'octet près, `migrate.js --status`
revenant au vert) — la reprise exacte des couleurs est donc décrite ici, dans le
journal, et non dans le fichier SQL.

**7. Vérifications (bases et instances jetables, base réelle copiée par
`VACUUM INTO`).** Chaîne complète relancée après le lot : **API** 240/240
(`test_scenarios.js`, phase 7bis incluse : miroir des catalogues, indépendance
des deux axes, « couleur seule » acceptée, couleur/motif inconnus → 400 sans
écriture, persistance après relecture) · **parcours d'interface** 114/114
(`test_ui_scenarios.js`, S8 réécrit sur la page dédiée : page atteinte depuis la
carte du Profil, 16 couleurs / 9 motifs **et** groupes claires-sombres affichés,
catalogues client et serveur **identiques**, indépendance des deux choix,
enregistrement `color` + `pattern` séparés, persistance après rechargement,
bouton inactif quand tout est appliqué, « Aucun motif » qui neutralise bien le
masque) · **sonde boutique** 24/24 (`_probe_boutique_v1.js`, captures jour/nuit,
sélection, aucun motif, mobile 360 px — une seule colonne, cibles ≥ 44 px, résumé
affiché en entier —, Profil) · **sonde Profil** 41/41
(`_probe_profil_v3.js` : le Profil n'affiche plus aucun skin, le CTA pointe vers
`#/skins`) · **base neuve** (`_chk_fresh.js` : 009 appliquée, `pion_style`
présente, formes finales de `equipped_skins`) · **mise en page** 204/204
(`_layout_fill.js`, l'écran `skins` compris : plein écran, blocs empilés,
défilement interne) · **revue mesurée** (`_revue_ui.js`) : 447 segments de texte,
**0** sous le seuil AA, **0** débordement horizontal, **0** erreur JS. Les deux
« débordements » que la revue signalait sur le Profil étaient un **faux
positif** de la mesure (les cercles décoratifs de la carte boutique, rognés à
dessein par `overflow: hidden`) : le relevé ignore désormais tout élément rogné
par un ancêtre, qui ne peut pas élargir la page.

**Fichiers.** *Client :* `D-aona/d-aona-web/index.html` (catalogues, `#screen-skins`,
CSS de la boutique et des pions, `pionGradient` / `motifUri` / `mountPionStyles` /
`applyPionStyles` / `applyPionStyle`, `renderSkins`, `refreshPionPreview`,
`refreshSkinsViews`, route `skins`, Profil nettoyé). *Serveur :* `data.js`,
`db.js`, `server.js`, **nouvelle** `migrations/009_pion_style.sql`.
*Vérification :* `test_scenarios.js` (phase 7bis), `test_ui_scenarios.js` (S8),
`_p10.js` (S8 réécrit), `_p12.js`, `_p2.js`, `_p5.js`, `_layout_fill.js`,
`_revue_ui.js` ; **nouvelles** `_chk_fresh.js`, `_probe_boutique_v1.js`,
`_probe_ovf_360.js`. Aucune donnée client lue ni modifiée par ces outils.

**Limite assumée.** Les quatre skins **clairs** de pions restent au catalogue et
l'API les vend et les équipe encore (compatibilité et historique — les scénarios
de la phase 7 les exercent), mais **l'interface ne les propose plus** : les pions
du joueur appartiennent à `pion_style`, un skin clair acheté par un appel direct
resterait donc sans effet visible. Les skins **sombres** conservent leur rôle
(les pions de l'adversaire), et le plateau et les effets sont inchangés.

## 28/09/2026 — Formes des tuiles uniformes, filtre de la courbe Elo

**Demande.** (1) « Les formes des tuiles doivent être uniformes comme sur l'image
(mockup) sur tout le site. » (2) « Bug sur la courbe Elo : à chaque clic sur le
style de visu (D, S, M, A), ça rafraîchit la page ; il faut un vrai filtre de
données avec une bonne animation fluide — et le filtre ne fonctionne pas sur tous
les boutons. »

### 1. Échelle unique des formes (rayons)

**Constat, mesuré.** `_shape_scan.js` (nouvel outil, analyseur CSS réel) relève
**168 déclarations `border-radius` et 23 valeurs distinctes** (5, 6, 7, 8, 9, 10,
12, 13, 14, 16, 18, 19, 20, 24, 26, 28, 30, 42, 52, 99, 999 px, 50 %, 0) pour des
surfaces de même nature : `.panel` à 8 px voisin de `.mt-row` à 14 px, `.pg-cta`
en pilule à côté de `.mt-cta-solid` à 12 px, `.amt-chip` à 7 px quand `.chip`
était une pilule.

**Correctif.** Quatre jetons en tête de feuille, une famille par usage :
`--r-sm` 10 px (contrôles, rangées, tuiles imbriquées — une rangée fait ~44 px,
16 px la rendrait « pilule ») · `--r-md` 16 px (**tuiles et panneaux**,
`--radius-card` en est l'alias) · `--r-lg` 24 px (héros, modales, carte
d'authentification, barre d'onglets, scène `/play`) · `--r-pill` 999 px
(pastilles) · les cercles par nature gardent 50 %. Le rangement est appliqué
**dans la règle de chaque composant** (une seule vérité par sélecteur) par
`_shapes_apply.js`, table explicite de 68 sélecteurs, mode lecture seule par
défaut. `.mt-r` (écran Match, 24 px) est ramené à `--r-md` — c'était la seule
famille de cartes qui ne ressemblait pas aux autres ; `--lgtab-radius` passe à
`--r-lg`. Les formes **accrochées à un bord** (`.chat-pop`, `.chat-panel`,
`.chat-fab`, `.pod`, queues des bulles `.msg`) sont ajustées **sur place** : leur
rayon est partiel par nature. Exceptions documentées dans la feuille (§9) :
tuiles d'icône à rayon proportionnel (`.pg-icon-card`, `.wb-mini`,
`.mt-sc__badge`), traits et décorations.

**Mesure après lot.** `_shape_scan.js --no-var` : **94 déclarations en clair**,
toutes dans les exceptions (43 × 50 %, 33 × 999 px, tuiles d'icône, traits) —
aucune surface de contenu ne porte plus de valeur hors échelle. `_probe_formes.js`
(nouveau) relève le rayon **effectif** donné par le navigateur : **15/15** sur
10 écrans, deux thèmes et le mobile 390 px (panneau 16 · héro 24 · bouton 10 ·
les quatre tuiles D/S/M/A à 30 × 30 px, rayon 50 %), captures dans
`graphify-out/formes/`.
### 2. Filtre de la courbe Elo

**Constat.** Les quatre tuiles appelaient `renderProfile()` : tout le Profil était
reconstruit à chaque clic (position de défilement perdue, animations rejouées,
focus perdu) — d'où l'impression d'un rafraîchissement de page. Deux autres
défauts expliquaient « le filtre ne fonctionne pas sur tous les boutons » :
(1) les fenêtres étaient **glissantes** (1 / 7 / 30 × 24 h depuis l'instant
présent), si bien que « Aujourd'hui » ne couvrait pas le jour courant — une partie
jouée le matin en sortait à 23 h ; (2) un compte dont les parties sont anciennes
lisait la **même phrase** pour D, S et M, sans rien pour élargir la fenêtre.

**Correctif.** (a) **Fenêtres calendaires** en jours UTC (D = jour courant, S =
jour courant + 6, M = + 29, bornes incluses), même horloge que `g.at` et les deux
dates sous le tracé. (b) Le filtre ne reconstruit que **`#elo-body`** : l'en-tête
(titre + tuiles) est stable, le bouton cliqué garde le focus, le défilement et le
reste du Profil ne bougent pas. (c) **Animation fluide** : sortie courte
(130 ms), puis tracé qui **se dessine** (dashoffset calculé sur la longueur
réelle du chemin), aire en fondu, points en cascade (`--i`), respect de
`prefers-reduced-motion`. (d) **Toutes les tuiles répondent** : délégation sur la
carte (plus un `onclick` par bouton), groupe `role="radiogroup"` / `role="radio"`,
tabulation qui suit la sélection, flèches ← → et Origine/Fin au clavier, et le
**compte réel** de chaque période dans `aria-label` et l'infobulle (« 30 derniers
jours · 6 parties »). (e) État vide **actionnable** : « Aucune partie suivie du
6 sept. au 28 sept. — 0 sur 12 au total » + bouton « Voir “30 derniers jours” ↗ ».
(f) Optimisation : tri chronologique mémoïsé (invalidé dès qu'une partie est
enregistrée), comptes calculés en une passe. Le **strip « Prochain match »** et la
**taille de la photo** (mêmes re-rendus du Profil sans raison) ne reconstruisent
plus que leur carte / appliquent leur état sur place.

**Mesure.** `_probe_elo_stats.js` — **37/37** (31 + 6 contrôles neufs) : fenêtre
« D » = jour courant, compte annoncé = compte réel, groupe radio (un seul état
coché, une seule tabulation), **repère d'identité** sur la carte d'identité
conservé après les quatre clics (preuve de l'absence de re-rendu du Profil),
défilement inchangé, longueur de tracé mesurée pour l'animation, géométrie des
points toujours ≤ 0,75 px, thèmes jour/nuit, états vides, profil public sans
courbe.





### 3. Incident : `D-aona/` supprimé puis restauré (à savoir)

Pendant le lot, une commande de nettoyage a visé un chemin mal orthographié
(`…\Root\D-Aona`, alors que le dossier est `…\Root\D-aona` — Windows ne distingue
pas la casse) : **le dossier `D-aona/` a été supprimé**. Reprise :
1. **point de contrôle Git** (`d68e5be`, 27/09 18:06) pour retrouver l'arbre ;
2. puis **copie de sauvegarde `…\Documents\Nouveau dossier\V21\D-Aona\Root\`**,
   qui contenait `index.html` **à l'octet et à l'horodatage près** (599 219 o,
   27/09 21:06:19), `README.md` (11 647 o) **et les visuels `assets/ad/`** — tout
   a été restauré de là ;
3. le **script de l'application** (le plus gros bloc `<script>`) a été réinjecté
   depuis `d-aona-server/_inline.js`, extrait par `_check_html.js` juste avant
   l'incident : il contient le travail du lot ET celui de la fin de session
   précédente (6 154 lignes) ;
4. toutes les modifications CSS du lot ont été réappliquées puis **re-mesurées**.

Aucune donnée client n'a été touchée (`d-aona.db` n'a jamais été concernée). Leçon
consignée : **ne jamais nettoyer par chemin littéral**, et garder la copie `V21`
(elle a sauvé la session). Les deux outils jetables de la reprise
(`_repair_shapes.js`, `_restore_js.js`) ont été supprimés après usage.

### 4. Vérifications

`_check_html.js` (6 154 lignes, balises équilibrées, syntaxe OK, `_inline.js`
régénéré) · `_shape_scan.js --check` (**aucune déclaration malformée** — contrôle
grammatical ajouté à l'outil, une valeur invalide étant silencieusement supprimée
par le navigateur) · `_probe_formes.js` **15/15** · `_probe_elo_stats.js`
**37/37** · `_probe_profil_v3.js` (Profil, bannière, courbe) · `_contraste.js`
(AA, aucun segment sous le seuil) · `_probe_ovf_360.js` (aucun nouveau
débordement : seul le faux positif connu des cercles décoratifs rognés) ·
`test_ui_scenarios.js` (parcours complet).

### 5. Fichiers

`D-aona/d-aona-web/index.html` (jetons, §9 « échelle des formes », CSS de la
carte Elo et du filtre, fenêtres calendaires, `setEloPeriod` /
`mountEloCurveAnimation` / `applyAvatarSize` / `refreshMatchCard` /
`bindMatchStrip`) · `D-aona/d-aona-web/README.md` (échelle des formes) ·
`d-aona-server/_shape_scan.js` (**nouveau** — inventaire des rayons + contrôle
grammatical) · `_shapes_apply.js` (**nouveau** — table de rangement, lecture seule
par défaut) · `_probe_formes.js` (**nouveau** — rayon effectif, captures) ·
`_probe_elo_stats.js` (6 contrôles neufs : fenêtre calendaire, comptes annoncés,
groupe radio, absence de re-rendu, défilement, animation) ·
`_probe_profil_v3.js` (la bannière partenaire se vérifie par un **rechargement**,
le filtre Elo ne provoquant plus de rendu du Profil).



## 28/09/2026 — Skins des pions : deux apparences ÉTANCHES (clairs / sombres)

**Demande.** « Il faut modifier le système de skins. Les skins clairs doivent être disponibles uniquement
pour les pions clairs, tandis que les skins noirs ou sombres doivent être réservés uniquement aux pions
sombres ou noirs. Ainsi, chaque skin sera automatiquement adapté à la couleur du pion correspondant.
» Le découpage retenu (question posée avant d'écrire) : **deux apparences étanches**, une par camp, la
boutique scindée, le serveur refusant en 400 toute couleur du mauvais groupe.

**Constat.** Deux mécanismes cohabitaient. 1) Les **skins du catalogue** (`SKINS_CATALOG`, `type`
LIGHT/DARK) avaient bien deux emplacements d'équipement (migration 008), mais depuis le lot du 27/09 les
skins clairs n'étaient **plus proposés** par l'interface : seuls les sombres habillaient le camp adverse.
2) La **personnalisation** (`pion_style`, migration 009) ne portait qu'UNE apparence, appliquée aux pions
du joueur, et son catalogue de 16 couleurs mêlait les deux groupes : un joueur pouvait donc enregistrer
« Noir » ou « Bleu marine » (groupe **sombre**) pour ses propres pions **clairs** — exactement ce que la
demande interdit. La base réelle en contenait un cas (compte au camp clair en `gris_sombre`).

**Modèle retenu — un camp, une apparence.** Le camp devient une **clé** de `pion_style`
(`user_id`, `camp`, `color`, `pattern`) : `light` = les pions du joueur tels qu'il les voit
(`.piece.me`), `dark` = ceux de l'adversaire (`.piece.opp`). Une couleur du groupe « clair » ne peut viser
que `light`, une couleur sombre que `dark` : le serveur **refuse en 400** l'inverse, y compris par appel
direct à l'API — l'étanchéité n'est pas une convention d'affichage. Chaque camp garde SON motif, et les
deux apparences sont indépendantes (enregistrer l'une ne touche jamais l'autre). Le catalogue reste la
seule source des identifiants : `PION_CAMPS` / `PION_CAMP_GROUP` / `PION_DEFAULTS` et le contrôle
`pionColorFitsCamp()` vivent dans `data.js`, miroir exact côté client.

**Migrations.** `010_pion_style_camps` reconstruit la table avec `(user_id, camp)` en clé primaire,
reprend l'ancienne ligne comme camp `light` (c'est ce qu'elle habillait) et crée le camp `dark` de chaque
compte à partir du **skin sombre équipé** : `pions-sombre-emeraude` → `vert_arme`, `-obsidienne` → `noir`,
`-ombres` → `gris_sombre`, tout le reste → `noir` (le noir d'encre du pion Vato sombre). Aucun achat
perdu ; `user_skins` et `equipped_skins` sont conservés. `011_pion_style_coherence` remet ensuite chaque
camp **dans son groupe** (une couleur hors groupe redevient la couleur par défaut du camp, le motif est
conservé) et garantit les deux lignes par compte. La 010 étant déjà appliquée quand le cas réel a été
constaté (empreinte SHA-256 verrouillée par `migrate.js`), la correction est passée par une **migration
corrective** — la 010 n'a pas été réécrite. Base réelle après application : 28 lignes (2 par compte),
0 compte sans les deux camps.

**Client.** La boutique (`#/skins`) reçoit **un onglet par camp** (« Pions clairs — vos pions » / « Pions
sombres — les pions de l'adversaire ») : l'onglet actif ne propose que les **8 couleurs de son groupe** et
ses 9 motifs, avec son propre aperçu (grand format + taille réelle), son résumé et son bouton
« Appliquer ce skin » — qui n'enregistre que ce camp. Deux brouillons séparés : un choix non enregistré
d'un camp est conservé en visitant l'autre, et **ne part pas** au rechargement (seul l'état enregistré
revient). Côté rendu, le plateau porte **deux jeux de variables** : le camp clair écrit `--pion-grad` /
`--pion-ink` / `--pion-mask` (attributs `data-pion-color` / `data-pion-motif`), le camp sombre leurs
jumelles `--pion-*-dark` (attributs `data-pion-color-dark` / `data-pion-motif-dark`), que `.piece.opp` et
`.pion-view--dark` **rebindent** sur les génériques : une seule recette de rendu sert les deux camps, donc
l'aperçu ne peut pas mentir sur le plateau. Une couleur n'existe que dans UN jeu de variables — un dégradé
sombre ne peut pas peindre les pions clairs, même en forçant l'attribut à la main. Les onglets sont des
cibles de 52 px, l'état actif passe par la bordure, le fond, le poids de la police ET `aria-selected`.

**Skins du catalogue.** Plus aucune règle de skin ne peint un camp de pions : `mountSkinStyles()` et les
classes `skin-pions-*` sont retirées (seuls le plateau et les effets restent pilotés par le catalogue), un
seul mécanisme par camp. Les entrées de pions restent vendues et équipées par l'API (historique,
compatibilité, phase 6 des tests) mais leur apparence en cours a été convertie en couleur du camp sombre
par la 010 — aucune apparence payée n'est perdue.

**Vérifications** (bases et instances jetables ; sauvegarde vérifiée de la base réelle **avant** toute
migration). **API 247/247** (`test_scenarios.js`, phase 7bis réécrite : 16 couleurs / 9 motifs, 8 + 8
groupes, deux camps exposés avec leur groupe, défauts par camp, indépendance des deux camps, refus croisés
400 dans les deux sens, camp inconnu 400, cinq refus sans écriture, compatibilité d'un appel sans `camp`,
persistance, isolation par compte, couleur seule) · **interface 115/115** (`test_ui_scenarios.js`, S8
réécrit : onglet par camp, 8 couleurs du groupe affiché, miroir des trois catalogues **et des camps**,
indépendance des axes et des camps, rendu partagé aperçu / vignettes / plateau pour les deux camps,
enregistrement du seul camp affiché, brouillon non persisté après rechargement, cinq refus 400, aucun skin
de pions sur le plateau, 360 px sans débordement ni cible sous 44 px) · **sonde boutique 30/30**
(`_probe_boutique_v1.js` : captures jour / nuit / 360 px, **0** non-conformité AA dans les deux thèmes,
étanchéité des onglets vérifiée sur les attributs, camp sombre enregistré sans toucher au clair) ·
**base neuve** (`_chk_fresh.js` : 010 + 011, clé `(user_id, camp)`, deux lignes par compte) ·
**authentification** (`test_auth.js` : l'inscription écrit bien les deux apparences) · **contrôle HTML**
(`_check_html.js` : balises équilibrées, script compilé).

**Fichiers.** *Client :* `D-aona/d-aona-web/index.html` (catalogues `PION_CAMPS` / `PION_DEFAULTS` /
`pionColorOf` / `pionColorsOfCamp`, CSS des deux camps et des onglets, `pionView`, `mountPionStyles`,
`applyPionStyles`, `applyPionStyle`, `renderSkins`, `refreshPionPreview`, `applySkins` allégé).
*Serveur :* `data.js`, `db.js`, `server.js`, **nouvelles** `migrations/010_pion_style_camps.sql` et
`011_pion_style_coherence.sql`. *Vérification :* `test_scenarios.js` (phase 7bis), `_p10.js` (S8) et
`test_ui_scenarios.js` reconstruit par `_build.js`, `_probe_boutique_v1.js`, `_chk_fresh.js`.
*Documentation :* ce journal, `D-aona/d-aona-web/README.md`.

**Limite assumée.** Les quatre skins clairs **et** les quatre skins sombres de pions restent au catalogue
et l'API les vend et les équipe (compatibilité et historique — la phase 6 des scénarios les exerce), mais
**aucun** n'habille plus le plateau : l'apparence des deux camps vient des deux lignes de `pion_style`.
Les skins de plateau et d'effets sont inchangés.

## 03/10/2026 — Les deux photos de la pièce de 50 ariary, détourées, remplacent les dessins vectoriels

**Demande.** « Implémente ces images pour remplacer la pièce de money actuel » — les deux clichés
d'origine, cette fois **fournis sur le disque** (`Downloads\coin\coin_pile_raw.png` et
`coin_face_raw.png`, 1024 × 1024, ~1,8 Mo).

**Constat.** Les deux `.svg` du lot du 28/09 avaient été dessinés **faute de photos** : ils sont donc
remplacés par les clichés réels. Mais ce sont des photographies **opaques, prises sur fond noir** :
posées telles quelles, elles auraient dessiné un **carré noir** autour de la pièce, dans les deux
thèmes (le rendu ne pose ni `border-radius` ni `border` — la forme octogonale vient de l'image). Un
détourage était nécessaire ; or le projet n'a **ni `sharp` ni `jimp`** : la seule chaîne d'image
disponible est Chromium, déjà installé pour Playwright.

**Réalisation.** `_coin_prep.js` (jetable, nouveau) sert les deux clichés par un petit serveur
statique puis les traite dans un `<canvas>` de Chromium — **même origine obligatoire**, sinon le
canvas serait *tainted* et `getImageData` lèverait. Chaîne, dans cet ordre : seuil **d'Otsu**
(~100) → **flood fill** du fond depuis les quatre bords → plus **grande composante** connexe (les
poussières claires du fond tombent) → **érosion** de 2 px → recadrage carré au plus juste →
réduction à **192 px** (2 × les 84 px de la bande, pour les écrans denses) → **rampe d'alpha** (les
alpha faibles repassent à 0, sinon le halo du fond reste collé). Sortie **WebP** à canal alpha :
**13,2 Ko** (pile) et **12,0 Ko** (face) — cinq fois moins que les PNG équivalents (69,6 / 68,5 Ko),
et loin des 60 Ko visés.

**Le défaut qu'il a fallu traiter — le liseré noir.** La première version laissait un **halo sombre**
collé au contour : les pixels de bord sont un **mélange** du métal et du noir du fond, et la rampe
d'alpha ne fait que rendre ce mélange plus ou moins transparent — elle ne le « dés-mélange » jamais.
Correction : **décontamination** du contour avant la rampe — chaque pixel de bord est dé-multiplié sur
le noir (composante par composante, `F = C / α`) pour retrouver sa vraie couleur. Mesure : la
luminance moyenne des 1 151 px de bord de PILE passe de **126 à 213**, celle des 1 136 px de FACE de
**125 à 214** — le bord est désormais aussi clair que l'argent de la pièce. C'est l'aperçu sur **aplat
rouge vif** qui l'a rendu visible, puis confirmé.

**Intégration.** Quatre attributs `src` d'`index.html` (bannière `#toss-banner-coin`, deux boutons de
`renderChooseModal`) pointent maintenant les `.webp` ; **aucun CSS n'a bougé** (44 px dans la bande,
56 px sur les boutons, un seul fichier par face, identique dans les deux thèmes). `.webp` était déjà
servi par `server.js` : aucune table MIME à compléter. Les deux `.svg` du lot précédent sont
**supprimés** : les fichiers de ce dossier sont désormais les seules copies des clichés, et
`assets/coins/README.md` — réécrit — porte la provenance, la recette de détourage et les invariants.

**Vérification — 9/9, 0 erreur JavaScript** (`_coin_verif.js`, port 8094, base jetable, parcours réel
Jeux → IA → format → LANCER, clics réels) : deux faces chargées et **distinctes** (56 × 56) ·
**contrôle P1b, nouveau** : les **quatre coins** de chaque image ont un alpha nul et leur centre est
opaque — sans cette transparence, un carré s'afficherait autour de la pièce · tirage
**déterministe** (`Math.random` figé) → **PILE** affiche `pile.webp` et l'annonce dit PILE, **FACE**
affiche `face.webp` et l'annonce dit FACE · un seul `<img>` visible sur les deux · pièce de
**44 × 44 px** dans une bande de 58 px · cohérence à **390 px** · **aucun 404** ni requête échouée sur
`assets/coins/`. Captures : `%TEMP%\daona_shots\pieces-*.png` ; contrôle statique `_check_html.js`
(balises équilibrées, script compilé).

**Fichiers.** *Ajoutés :* `D-aona/d-aona-web/assets/coins/pile.webp`, `assets/coins/face.webp`,
`d-aona-server/_coin_prep.js` (jetable : détourage + aperçu jour / nuit / rouge vif, journal
`%TEMP%\daona_coin_prep.log`). *Supprimés :* `assets/coins/pile.svg`, `assets/coins/face.svg`.
*Modifiés :* `D-aona/d-aona-web/index.html` (les 4 `src`, un commentaire CSS),
`D-aona/d-aona-web/assets/coins/README.md` (réécrit), `D-aona/d-aona-web/README.md` (section « Pièce
du tirage au sort » : provenance, format, tailles, 9 contrôles), `d-aona-server/_coin_verif.js`
(`P1b`), `d-aona-server/_coin_apercu.js` (nouveaux fichiers, 4 tailles d'usage, aplat rouge vif), ce
journal (table des fichiers).

**Limite assumée.** Le détourage est **automatique** — le contour suit le seuil d'Otsu et n'est pas
retouché à la main ; la pièce reste un cliché, pas un dessin vectoriel, donc un peu de flou à 44 px
(assumé : c'est la photo du joueur qui est à l'écran, pas une reconstitution). Les sources ayant
quitté le disque, ces deux `.webp` sont la seule copie conservée ; leur régénération à l'identique
suppose de retrouver les deux PNG d'origine (`_coin_prep.js --src <dossier>`).

## 28/09/2026 — Tirage au sort : les deux VRAIES faces de la pièce malgache remplacent le rond doré

**Demande.** « Je voudrais maintenant que tu changes l'image des pièces quand on fait le pile ou face par
les pièces suivantes » — deux photos de la pièce malgache de **50 ariary (1992)** : le côté
« REPOBLIKA DEMOKRATIKA MALAGASY / ariary 50 / 1992 » et le côté « ARIARY DIMAMPOLO » (baobabs, devise
TANINDRAZANA · FAHAFAHANA · FAHAMARINANA).

**Constat.** Le tirage au sort ne montrait **aucune pièce** : `.coin` était un rond doré en CSS portant
deux `<span>` « PILE » / « FACE » dont un seul s'affichait, et les boutons du choix portaient deux emojis
décoratifs (💙 / ✋) sans rapport avec un dessin. Rien, dans l'interface, ne disait quel côté était PILE.

**Réalisation.** (1) Deux **dessins vectoriels** dans `assets/coins/` — `pile.svg` (légende circulaire
« REPOBLIKA DEMOKRATIKA MALAGASY », étoile, « ariary », le grand **50**, couronne de laurier, millésime
**1992**) et `face.svg` (« ARIARY DIMAMPOLO », **baobabs**, brousse, ruban de la devise) : les photos
transmises n'existent **pas** sur le disque, la reconstitution suit donc la géométrie de la pièce —
flan **octogonal** à coins arrondis, double listel, légende répartie **lettre par lettre** sur un cercle
(contrôle exact du débordement), métal argenté en deux dégradés, relief rendu par de la gravure. Le
README du dossier dit comment déposer les photos à la place, sans toucher au code.
(2) `.coin` devient un conteneur de **deux** `<img class="coin-side">` : la classe `result-pile` /
`result-face` — celle de la face **tirée par le serveur** — décide de l'image visible, une seule à la
fois ; il n'y a plus **aucun** texte de pièce à styler, donc la bannière ne peut pas montrer une autre
face que celle qu'elle annonce. (3) Les boutons du choix portent le **dessin** du côté qu'ils désignent
(56 px) : le joueur voit la pièce qu'il choisit. (4) La convention est dite **en clair** — dans la modale
et dans les règles — « PILE, le côté où le 50 est écrit en chiffres ; FACE, le côté des baobabs ».

**Convention assumée (réversible).** PILE = côté de la valeur chiffrée (le « 50 »), FACE = côté du décor
national (baobabs et devise) : c'est la lecture populaire de « pile = côté de la valeur », et elle est
documentée aux deux endroits où un joueur la cherche. L'inverser = échanger les deux attributs `src`
(bannière et boutons), ce que le README des assets décrit.

**Vérification fonctionnelle — 8/8, 0 erreur JavaScript** (`_coin_verif.js`, port 8094, base jetable,
parcours réel Jeux → IA → format → LANCER, clics réels) : modale de choix avec **deux** dessins chargés
et **distincts** (56 × 56, plus aucun emoji) · tirage **déterministe** (`Math.random` figé) → **PILE**
affiche `pile.svg` et l'annonce dit PILE, **FACE** affiche `face.svg` et l'annonce dit FACE · un seul
`<img>` visible sur les deux dans chaque cas · pièce de **44 × 44 px** dans une bande de 58 px (aucune
coupe) · cohérence à **390 px** · **aucun 404** ni requête échouée sur `assets/coins/`. Captures :
`%TEMP%\daona_shots\pieces-choix-desktop-jour.png`, `pieces-tirage-desktop-jour.png`,
`pieces-tirage-desktop-nuit.png`, `pieces-choix-mobile.png`, `pieces-tirage-mobile.png` ; contrôle
statique `_check_html.js` (balises équilibrées, script compilé).

**Fichiers.** *Ajoutés :* `D-aona/d-aona-web/assets/coins/pile.svg`, `assets/coins/face.svg`,
`assets/coins/README.md`, `d-aona-server/_coin_verif.js` (outil jetable, + relevé `_coin_verif.txt`),
`d-aona-server/_coin_apercu.js` (aperçu des deux faces hors application : 160 et 44 px, thèmes jour et
nuit — c'est lui qui a fait corriger le feuillage rogné et la légende trop proche de la couronne).
*Modifiés :* `D-aona/d-aona-web/index.html` (CSS `.coin` / `.coin-side` / `.coin-opt .coin-thumb` /
`.toss-banner .coin.mini`, bannière `#toss-banner`, modale `renderChooseModal`, règle du tirage),
`D-aona/d-aona-web/README.md` (section « Pièce du tirage au sort », arborescence), ce journal
(table des fichiers et commande de contrôle).

**Nettoyage.** La règle CSS `.toss-wrap` — dernier reste de l'ancienne modale du tirage, supprimée au lot
S8 — est retirée : plus aucun élément ne la portait (vérifié dans le HTML et dans tous les scripts).

**Limite assumée.** Ce sont des **reconstitutions**, pas les clichés d'origine (aucune photo du disque) :
elles ne prétendent pas remplacer l'asset source, mais elles suffisent là où elles servent (44 px dans la
bannière, 56 px sur les boutons — tailles où seuls les aplats comptent) et se remplacent par les photos
réelles en déposant deux fichiers et en changeant quatre attributs `src`.

## 2026-10-03 — Onglet Jeux : un choix vaut « suivant », le bouton « Suivant » est retiré, le « Retour » redevient visible

**Demande :** « dans l'onglet jeux, j'arrive pas à cliquer et je ne trouve pas le bouton retour. Il faut
que quand je clique à un choix cela signifie suivant et non forcément toujours cliquer sur le bouton
suivant. **Enlever le bouton suivant.** » — demande accompagnée d'un test responsive sur modèles de
téléphone.

**Aucune extension de navigateur n'a été installée.** La demande citait `webmobilefirst.com`. Un agent ne
dispose pas d'un navigateur à instrumenter, et cet outil est une simulation **manuelle**, faite pour un
humain qui choisit le modèle à la main. Le projet a déjà mieux, et sans téléchargement : **Playwright
1.63.0** + Chromium déjà présents (`d-aona-server/node_modules`, `%LOCALAPPDATA%\ms-playwright`) —
**207 profils d'appareils** (iPhone 12→17, Galaxy S24, Pixel 9/10, iPhone SE, repliés/paysage). Automatisé,
reproductible, chiffré, avec captures. Le test « au doigt » se fait sur le serveur déjà à l'écoute
(`http://<IP>:8080`).

**Deux causes relevées au code, AVANT toute modification.**
1. **« Je ne trouve pas le retour »** — `index.html` masquait *les deux* flèches sur mobile/tablette :
   `.pg-nav .pg-arrow { display: none }` (`@media max-width:860px`). Le bouton « Retour » existait bien
   (50×52 px, conforme WCAG 2.2 §2.5.8) mais était **invisible** ; il ne restait que les pastilles de
   pagination, trop discrètes.
2. **« J'arrive pas à cliquer »** — la tuile du jeu (étape 1, « Fanorona ») n'avait **aucun gestionnaire** :
   `style="cursor:default"`, aucun `data-*`, donc aucun lien. Taper la carte ne faisait rien. Aux étapes 2
   et 3, taper un choix **sélectionnait sans avancer** : il fallait viser ensuite « Suivant ».

**Correctif (`D-aona/d-aona-web/index.html`).**
- **Un choix vaut « suivant »** : le clic sur la tuile du jeu, sur le mode et sur le format fait avancer
  l'assistant. Les tuiles deviennent `role="button"` + `tabindex="0"`, avec anneau de focus et relais
  **Entrée / Espace** ; les tuiles « Bientôt » restent inertes (`aria-disabled="true"`).
- **Bouton « Suivant » retiré** : `#pg-next` supprimé du bandeau, avec son état `canNext` devenu inutile.
  La barre basse ne porte plus que « Retour » ; le CTA n'est rendu **qu'à l'étape 4** et nomme l'**action**
  (« Lancer le matchmaking » / « Envoyer le défi » / « Lancer l'entraînement ») — ce n'est plus un
  « Suivant » déguisé.
- **« Retour » redevient visible sur mobile** : la règle qui masquait les flèches est remplacée par une mise
  à gauche de la barre ; les pastilles de pagination restent un retour alternatif.
- **Défi entre amis — arbitrage tranché avec l'utilisateur.** « Défi » exige un adversaire *et* une mise :
  il ne peut donc pas avancer seul. Le clic sur « Défi » **affiche le formulaire et reste** ; c'est **la mise
  (500 / 1000 / 2000 Ar) qui valide et fait avancer**. Zéro exception, zéro bouton supplémentaire.

**Troisième cause — découverte par la MESURE, pas par la lecture.** Le balayage de 6 modèles de téléphone a
montré que sur les petits écrans la barre basse passait **sous** la barre d'onglets flottante :
`.pg-shell { min-height: 460px }` (mobile) ne laissait que `100dvh − 212 px = 356 px` sur un écran de 568 px
— la scène débordait de 104 px et « Retour » comme les puces de mise devenaient **inatteignables**. C'était
exactement le geste décrit par l'utilisateur. Plancher abaissé à **320 px** : sur les téléphones courants la
scène tient désormais dans la fenêtre ; sur un écran plus court (paysage de téléphone), la page défile et
`#screens` réserve 110 px en bas, ce qui dégage la barre d'onglets.

**Vérification — `node d-aona-server\_verif_jeux_mobile.js` (nouvel outil de mesure, base jetable).**
6 appareils, **clics réels**, 25 contrôles par appareil : iPhone SE 1re gen (320×568), iPhone SE 3e gen
(375×667), iPhone 12 (390×664), Galaxy S24 (360×780), Pixel 9 (360×732), iPhone SE **paysage** (568×320).
Contrôlé : `#pg-next` absent · « Retour » 50×52 px, visible et cliquable · parcours jeu → mode → format →
lancement **au clic** · « Défi » reste puis la mise avance · retour effectif à l'étape précédente · aucun
débordement horizontal · barre basse dégagée (au repos là où la scène tient, après défilement sur écran
court) · thème nuit. **Tous les contrôles passent**, sur les 6 appareils.

Le contrôle le plus direct du « j'arrive pas à cliquer » : `elementFromPoint` **au centre** de chaque cible
doit renvoyer la cible elle-même — s'il renvoie autre chose, un élément la recouvre et le doigt ne l'atteint
pas. C'est ce test qui a mis au jour le recouvrement par la barre d'onglets. 19 captures :
`%TEMP%\daona_shots\jeux-mobile\*`.

**Non-régression.** `node test_ui_scenarios.js` **115/115** (campagne complète, 0 échec) · S3 **10/10** ·
S5 **9/9** · S12 **21/21** · 0 erreur JavaScript. Le harnais **dépendait** du bouton supprimé : `wizard()`
cliquait `#pg-cta` trois fois pour franchir les étapes, et `mtSendChallenge()` faisait « 3 clics » sur le même
bouton. Les deux sont réalignés sur le geste réel (tuile → mode → format → CTA de lancement), et
l'assertion `#pg-cta` de l'étape 1 (qui n'existe plus) est remplacée par le contrôle de la tuile du jeu.

**Fichiers.**
*Modifiés :* `D-aona/d-aona-web/index.html` (CSS : barre basse mobile, plancher de la scène, focus des
tuiles ; rendu des étapes 1 à 3 ; bandeau bas sans « Suivant » ; bindings `advance()` / `bindTile()`),
`d-aona-server/_p6.js` et `d-aona-server/_p13.js` (morceaux **sources** du harnais),
`d-aona-server/test_ui_scenarios.js` (régénéré à l'identique par `node _build.js`), outils jetables
`d-aona-server/_revue_ui.js`, `_coin_verif.js`, `_s6_verif.js`, `_s8_verif.js`, ce journal (table des
commandes).
*Ajouté :* `d-aona-server/_verif_jeux_mobile.js` (outil de mesure jetable, motif `_*.js` donc hors Git).

## 04/10/2026 — Boutique « vitrine » : le prototype NEON devient la vraie page `#/skins`

**Demande.** Intégrer dans l'application le prototype validé sur le Bureau
(`Boutique-D-aona-style-NEON.html`) : habillage premium de la page « Boutique de
skins » (`#/skins`), header (topbar) et barre d'onglets **conservés**, logique
réelle intacte (API `pion_style`, wallet serveur) — boucle test/correction
jusqu'à « tout vert ».

**1. Habillage scopé `#skins-root`.** Panneaux « verre » (filet fin, dégradé de
surface, ombre de la charte), scène d'aperçu **sombre dans les deux thèmes**
(encres « nuit » de la charte dessus — mesuré), **4 ambiances** (Néon défaut,
Vide, Braise, Studio) : pur décor de **session** — remis à « neon » au
rechargement, jamais enregistré. **Loupe d'inspection 3D** : glisser/pincer =
tourner, molette = zoomer, double-clic / touche 0 / bouton « Face avant » =
remise de face ; bornes |rotX| ≤ 30°, |rotY| ≤ 58°, zoom 1–2× ; la rotation vit
sur le tourillon `#pion-3d`, jamais sur le pion. **Essai au survol** : la tuile
survolée s'affiche en grand (pastille « Essai · Nom »), le résumé, les coches et
le bouton ne suivent QUE le brouillon ; le clic tranche. Aucune couleur
inventée ; échelle des rayons maison ; keyframes préfixées `sk-`.

**2. Vignettes de motif sur MONTURE BLANCHE.** Le DESSIN s'y choisit (silhouette
SVG → encre neutre, illustration PNG → le fichier clair), la couleur se juge sur
le pion d'aperçu — la recette de rendu de l'aperçu reste **la même que le
plateau**. Le contrôle S8 « aperçu, vignettes et plateau partagent le même
rendu » a été **adapté au nouveau contrat** (vignette = monture blanche
découplée ; aperçu + plateau inchangés) ; le résumé porte **3 valeurs**
(Camp · Couleur · Motif — contrôle de `_probe_boutique_v1.js` ajusté).

**3. « Plateau & effets » réel.** Cartes vitrine (halo par skin — teintes
relevées dans la feuille, reflet au survol, tags `Plateau`/`Effet`,
`Possédé`/`Équipé`), achat/équipement par les VRAIS chemins
(`App.buySkin`/`App.equipSkin`, wallet serveur), étincelles à l'application ;
plus aucun reste du wallet de démonstration du prototype (« + 5 000 » supprimé).

**4. Coque plein écran : contrat `body.is-fill` réparé pour la page** (relevé par
la sonde NÉON). La base scopée écrasait le contrat de l'app (spécificité ID >
classe) : rangée contrainte (`grid-template-rows: minmax(0,1fr)`), panneaux
jamais comprimés (`flex: 0 0 auto` — « Plateau & effets » tombait de 348 à
215 px, rogné par son propre overflow), réserve de fin de course 64 px pour la
colonne : à fond de défilement, le pied de page passe au-dessus de la barre
d'onglets (bouton « Acheter » 929 → 897 px, barre à 916). Le défilement interne
par colonne est conservé (1081 px et plus) ; sous 1081 px, colonne unique et
défilement de page, comme le reste de l'app.

**Mesure (tout vert).** `_check_html.js` OK · `_probe_boutique_v1.js` **30/30**
· **nouvelle sonde `_probe_skins_neon.js` 47/47** (structure, rendu, API réelle,
essai au survol, monture blanche, ambiances de session, loupe 3D bornée,
achat/équipement réels, thèmes via `#btn-theme`, pied de page atteignable
desktop ET mobile 360, 0 erreur JS) · `_layout_fill.js` **204/204** ·
`_probe_ovf_360.js` conforme · `_probe_formes.js` **15/15** · `_revue_ui.js` :
Boutique **11/11 AA** jour (min 5,28) et nuit (min 4,99), **0 non-conformité**
au relevé complet, 0 débordement, 0 erreur JS · `test_ui_scenarios.js`
**115/115** (S8 adapté) · `test_scenarios.js` (API) **251/251**.

**Fichiers.** *Modifiés :* `D-aona/d-aona-web/index.html` (CSS vitrine scopé ;
état et gestes `pionHover`/`stageEnv`/`heroView` ; `pionColorCardHtml` /
`pionPatternCardHtml` / `refreshPionPreview` / `renderSkins` / `skinCardHtml` /
`applyPionStyle`), `d-aona-server/test_ui_scenarios.js` (S8, nouveau contrat
monture blanche), `d-aona-server/_probe_boutique_v1.js` (résumé 3 valeurs).
*Ajoutés :* `d-aona-server/_probe_skins_neon.js` (sonde, motif `_*.js` → hors
Git), `tasks/plan.md` + `tasks/todo.md` (suivi de l'intégration). Le prototype
du Bureau reste inchangé (référence de style).

<!-- JOURNAL_AUTO_START -->
## 2026-10-05
**Modifiés :** `AGENTS.md`, `yas-nperf-2025.svg`, `yas-nperf-2025.webp`, `index.html`, `.env.example`, `auth.js`, `MANIFEST.txt`, `data.js`, `db.js`, `demo_live.js`, `demo_seed.js`, `game.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `LIEN_REMOTE.bat`, `004_unique_contact.sql`, `005_skins_foreign_keys.sql`, `006_game_elo_snapshot.sql`, `007_friends_seen.sql`, `008_skins_pions_type.sql`, `009_pion_style.sql`, `SECURITE_AUTH.md`, `server.js`, `test_auth.js`, `test_scenarios.js`, `test_ui_scenarios.js`, `wipe_db.js`, `_build.js`, `_chk_fresh.js`, `_cline_pid.txt`, `_inline.js`, `_layout_fill_report.txt`, `_p1.js`, `_p10.js`, `_p11.js`, `_p12.js`, `_p13.js`, `_p14.js`, `_p2.js`, `_p3.js`, `_p5.js`, `_p6.js`, `_p9.js`, `_probe_boutique_v1.js`, `_revue_ui.js`, `_s6_verif.js`, `_s8_verif.js`, `_s8_verif.txt`, `_seed_parties_manifest.json`, `_shapes_apply.js`, `last_query_stamp`, `desktop-jour__chat.png`, `desktop-jour__friends.png`, `desktop-jour__home.png`, `desktop-jour__match.png`, `desktop-jour__notifications.png`, `desktop-jour__play.png`, `desktop-jour__profile.png`, `desktop-jour__ranks.png`, `desktop-jour__skins.png`, `desktop-jour__wallet.png`, `desktop-nuit__home.png`, `mobile-390__profile.png`, `desktop-1440x900-home.png`, `desktop-1440x900-match-tournois.png`, `desktop-1440x900-match.png`, `desktop-1440x900-ranks.png`, `desktop-1440x900-wallet.png`, `mobile-360x760-home.png`, `mobile-360x760-match.png`, `mobile-390x844-home.png`, `mobile-390x844-match.png`, `captures.md`, `desktop-jour__plateau-ia-coups.png`, `desktop-jour__plateau-ia.png`, `desktop-jour__plateau-tirage.png`, `desktop-jour__tournament.png`, `desktop-nuit__chat.png`, `desktop-nuit__friends.png`, `desktop-nuit__match.png`, `desktop-nuit__notifications.png`, `desktop-nuit__plateau-ia-coups.png`, `desktop-nuit__plateau-ia.png`, `desktop-nuit__plateau-tirage.png`, `desktop-nuit__play.png`, `desktop-nuit__profile.png`, `desktop-nuit__ranks.png`, `desktop-nuit__skins.png`, `desktop-nuit__tournament.png`, `desktop-nuit__wallet.png`, `etat__match-defis.png`, `etat__match-tournois.png`, `etat__profil-public.png`, `etat__ranks-province.png`, `etat__tournoi-detail.png`, `etat__wallet-depot.png`, `etat__wallet-retrait.png`, `mesures.json`, `mesures.txt`, `mobile-360__home.png`, `mobile-360__match.png`, `mobile-360__profile.png`, `mobile-360__tournament.png`, `mobile-390__chat.png`, `mobile-390__friends.png`, `mobile-390__home.png`, `mobile-390__match.png`, `mobile-390__notifications.png`, `mobile-390__plateau-ia-coups.png`, `mobile-390__plateau-ia.png`, `mobile-390__plateau-tirage.png`, `mobile-390__play.png`, `mobile-390__profile-pleine-page.png`, `mobile-390__ranks.png`, `mobile-390__skins.png`, `mobile-390__tournament.png`, `mobile-390__wallet.png`, `vide__chat.png`, `vide__friends.png`, `vide__home.png`, `vide__notifications.png`, `vide__tournament.png`, `vide__wallet.png`, `GUIDE_LIEN_REMOTE.md`, `REVUE_UI_UX.md`, `_graphify_ver.txt`
**Ajoutés :** `face.webp`, `pile.webp`, `crocodile-sombre.png`, `crocodile.png`, `lemurien-sombre.png`, `lemurien.png`, `ravinala-sombre.png`, `ravinala.png`, `zebu-sombre.png`, `zebu.png`, `avatar_31_1790621465549.jpg`, `avatar_35_1790622047443.jpg`, `avatar_35_1791021008804.jpg`, `avatar_35_1791035082722.jpg`, `avatar_35_1791036359795.jpg`, `avatar_35_1791040113685.jpg`, `avatar_35_1791042682860.jpg`, `avatar_35_1791043163395.jpg`, `avatar_35_1791130843145.jpg`, `avatar_35_1791132934761.jpg`, `avatar_36_1790621126761.png`, `avatar_40_1790621805857.png`, `avatar_40_1791034839337.png`, `avatar_40_1791036125493.png`, `avatar_40_1791039843206.png`, `avatar_40_1791039866408.png`, `avatar_40_1791042446546.png`, `avatar_40_1791131280684.png`, `4fbdd98b4d0c433c5b977fdf99712e72df2293cdca29bad315f9cb7c7d86bf55.json`, `b6ea206843332fef4c8f677d5fd7ffe430d4bd55757cf32171552ab95b1ce4ec.json`, `c7798580f51e47042b87e7dad784a2517b5b966c582c3151d5cf33f362197ed1.json`, `e1953bba93963a05f74ee3c49e18ab72a775231e5ce0c8972def11d70254a7af.json`, `010_pion_style_camps.sql`, `011_pion_style_coherence.sql`, `_coin_3d.js`, `_coin_apercu.js`, `_coin_prep.js`, `_coin_verif.js`, `_coin_verif.txt`, `_pions_verif.js`, `_pions_verif.txt`, `_probe_skins_neon.js`, `_proto_neon_verif.js`, `_verif_jeux_mobile.js`, `_xss_probe.js`, `jeux__1440__home.png`, `jeux__1440__match.png`, `jeux__1440__ranks.png`, `jeux__1440__wallet.png`, `jeux__1920__home.png`, `jeux__1920__match.png`, `jeux__1920__ranks.png`, `jeux__1920__wallet.png`, `jeux__360__home.png`, `jeux__360__match.png`, `jeux__360__ranks.png`, `jeux__360__wallet.png`, `jeux__768__home.png`, `jeux__768__match.png`, `jeux__768__ranks.png`, `jeux__768__wallet.png`, `mesures-jeux.json`, `rapport-jeux.md`, `0a0ec27cdd0190fd30b55122500ae21e44ae9e7624fec41d2dc296218069ff98.json`, `170997dd5ea947f73b5cc48ea1c2ac7a026d47f5aa208f81efbb82f2bbb59662.json`, `18adb9f3afd5adda0630b0c3e8c1f36ec2143521debc4c66e70a6cda5dd2150d.json`, `19dac8a5b0bf00bb006625fe195bc21694469ef37668227eabcd4843e74301e0.json`, `266f51f8f3b09e3866c0f1e55ab4f4f34a07dd8b838569c0c8dc5ad49fd620a2.json`, `328f4697a0beaf028868e6c78e267df5881f29df95b8cbd6c06db561e87ef8d1.json`, `3780c2cfebc7585dcd978deb51fdcf9bd3ed71ba16096b5712cb10174febd4bf.json`, `38ff0196cc7df7ddeb5e418582a51125171f6406a62ac1c44de08873776f68b9.json`, `45c7ffe89298b38b6916e0ebaed4cf4d8dd82e30b86c9613702d806148e7af5a.json`, `46c7bd3434f93fe9d97c1cce949276794c3ad731c66d95b5f5429363103b68d9.json`, `56f8e6921ba64ac74b08d86d8992bb41bfbacfbb36c68364038e72ec87e632a2.json`, `5fb205f7c3f55ecd0ec8cd35e719589c27b81b127d4d5224819325789d37c286.json`, `7137d051ed228f1cb0e652de227389bf9fd26a5b685f3915688fa76034e89837.json`, `7f94b2527adcf1611517ce7b3a71c44b9933088f8a119c40890d8644b732e4b2.json`, `8e378db24e6f80b26ea77209460bbe0f7d4c82cb1dfc7a6d0ec63b95c41922d1.json`, `915caf925b17518786db5781557be817bf89b1db34709fc285dca786fc460a6c.json`, `965415163b388e2db49cf5371f986601be653df10574b45cfbe789841b545dd3.json`, `9be0132d49fc7e033065fd3e46f5955cbea132ec856fe531dcc4563134448671.json`, `a2ee7ea48af693498acef3f98de050b604bc6c4f9ad8b125481407be16460aed.json`, `c5e79fb82e519d9eff3909e7e22315d2aae8b8fcd55ca22c8152555fa7445ee7.json`, `e3058c0dd4d10c19b6f486b0db85f8f95e8dd49b76131541c2b281cbc04ac7c5.json`, `e65fd965942089d439b92745cafb0d210b48bbc6c23fa78a0d5a5573006ce4dd.json`, `e8cb15ce36bfcb9ff1432a327e9318285b9b66d68e0d2a43e2a8ff0758d5e866.json`, `ec50668f77095f0b07069d282a0e66028d2c0ff57e1d1b24104b3ee71107d888.json`, `f521f62f7606f6e37444c46e8babb75db89cd278dbcfc41ef941e0224fae573a.json`, `f5dc4a9aef021d7262b6c8923da5edc9a94438360e8e82f07ac50ba04ebd5f58.json`, `f6c2ef78ae106c19cd5809ae8a97de5dd23704f5540df26cbb56f10d080ef13b.json`, `f83e4c6aeb0f2771bb77c136abd7190d42439f7160d728aaab035680a87c909d.json`, `f89d432f2ca13ba7527157290faaabaa55660c7dfb1b23fcf4bdbd4ee9c3037d.json`, `couleurs-camp-ia-gagne.png`, `couleurs-camp-je-gagne.png`, `verif-tirage-desktop.png`, `verif-tirage-mobile.png`, `plan.md`, `todo.md`, `_tmp_listen.txt`
**Supprimés :** `_chk.txt`
**Modifiés :** `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `server.js`
**Ajoutés :** `avatar_37_1791228486263.jpg`, `avatar_41_1791228540492.png`, `avatar_42_1791228519128.png`, `_sec_probe.js`, `8925c25386a0b5fc50e4e78db48eebc6aab9415fbb9796a3831c4d5689eb2f95.json`
**Modifiés :** `index.html`, `db.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `server.js`, `_inline.js`
**Ajoutés :** `avatar_45_1791228983955.png`, `avatar_46_1791228957683.png`, `_robust_probe.js`, `8615da3689f949ff3957bba77346885a738a43c803e0fea6e1ca7919846ea8cc.json`
**Modifiés :** `plateau_clean.png`, `index.html`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `_inline.js`
**Ajoutés :** `plateau_clean.webp`, `012_perf_indexes.sql`, `avatar_41_1791229182404.jpg`, `avatar_50_1791229510871.png`, `_idxcheck.js`, `_idxlist.js`, `_perf_probe.js`, `_webp_board.py`, `ed03dd62ff1cd77cdb268686603c1ebaef36d065b321673ad643cc33c515791b.json`
**Modifiés :** `db.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `server.js`
**Ajoutés :** `core.js`, `schema.js`, `stores.js`, `9611d1d636fb757e3d10d78530b94f6ebedb40c16fc721bc3bc283a513a91e50.json`, `http.js`, `avatar_45_1791229734060.jpg`, `avatar_53_1791229864593.png`, `avatar_54_1791229842355.png`, `_smoke_db.js`, `_split_db.js`, `_split_http.js`, `0481e8b3f15482d9794c751f7e9326cef48420053405b67825e45fa26f55b0f5.json`, `3413c0a03ef6656c18c965a94a274d66406e946d3afbdddb13abe4188df59b8d.json`
**Modifiés :** `.gitignore`, `index.html`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `package.json`, `_inline.js`
**Ajoutés :** `avatar_53_1791230190475.jpg`, `avatar_58_1791230211704.png`, `avatar_62_1791230239772.png`, `79f989acb00855b9afeeb1bc3a044417f525d859b2bacf420839d9dc2d007883.json`
**Modifiés :** `index.html`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`, `_inline.js`
**Ajoutés :** `d21e8f2cd68d4b9027fcd974ea4302ba44373f85290ac2d5c5914add5ed84523.json`, `avatar_61_1791230480858.jpg`, `_chat_draft_probe.js`, `058e3cac71a08d8abb7ce26f17f8b2b31689394dae8a951231c2adc3286e9a10.json`, `7b43cb533d2423ae50bf3d0f9b15a056147c9988580239d9f86d5054fcfd4ac4.json`

## 2026-09-27
**Modifiés :** `index.html`, `data.js`, `db.js`, `server.js`, `test_scenarios.js`, `test_ui_scenarios.js`, `_inline.js`, `_layout_fill.js`, `_layout_fill_report.txt`, `_p10.js`, `_p12.js`, `_p2.js`, `_p5.js`, `_probe_profil_v3.js`, `_revue_ui.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `last_query_stamp`, `stat-index.json`, `graph.html`, `desktop-1440x900-home.png`, `desktop-1440x900-match-tournois.png`, `desktop-1440x900-match.png`, `desktop-1440x900-ranks.png`, `desktop-1440x900-wallet.png`, `mobile-360x760-home.png`, `mobile-360x760-match.png`, `mobile-390x844-home.png`, `mobile-390x844-match.png`
**Ajoutés :** `009_pion_style.sql`, `avatar_26_1790420152927.jpg`, `avatar_26_1790497374681.jpg`, `avatar_31_1790419628207.png`, `avatar_31_1790419648915.png`, `avatar_31_1790420612982.png`, `_chk_fresh.js`, `_chk_html.txt`, `_probe_boutique_v1.js`, `_probe_ovf_360.js`, `_upd.txt`, `95459f4d73262b8c8d447a35810664bd90e723e2f3606873dacdbe9f0c737b13.json`, `captures.md`, `desktop-jour__chat.png`, `desktop-jour__friends.png`, `desktop-jour__home.png`, `desktop-jour__match.png`, `desktop-jour__notifications.png`, `desktop-jour__plateau-ia-coups.png`, `desktop-jour__plateau-ia.png`, `desktop-jour__plateau-tirage.png`, `desktop-jour__play.png`, `desktop-jour__profile.png`, `desktop-jour__ranks.png`, `desktop-jour__skins.png`, `desktop-jour__tournament.png`, `desktop-jour__wallet.png`, `desktop-nuit__chat.png`, `desktop-nuit__friends.png`, `desktop-nuit__home.png`, `desktop-nuit__match.png`, `desktop-nuit__notifications.png`, `desktop-nuit__plateau-ia-coups.png`, `desktop-nuit__plateau-ia.png`, `desktop-nuit__plateau-tirage.png`, `desktop-nuit__play.png`, `desktop-nuit__profile.png`, `desktop-nuit__ranks.png`, `desktop-nuit__skins.png`, `desktop-nuit__tournament.png`, `desktop-nuit__wallet.png`, `etat__match-defis.png`, `etat__match-tournois.png`, `etat__profil-public.png`, `etat__ranks-province.png`, `etat__tournoi-detail.png`, `etat__wallet-depot.png`, `etat__wallet-retrait.png`, `mesures.json`, `mesures.txt`, `mobile-360__home.png`, `mobile-360__match.png`, `mobile-360__profile.png`, `mobile-360__tournament.png`, `mobile-390__chat.png`, `mobile-390__friends.png`, `mobile-390__home.png`, `mobile-390__match.png`, `mobile-390__notifications.png`, `mobile-390__plateau-ia-coups.png`, `mobile-390__plateau-ia.png`, `mobile-390__plateau-tirage.png`, `mobile-390__play.png`, `mobile-390__profile.png`, `mobile-390__ranks.png`, `mobile-390__skins.png`, `mobile-390__tournament.png`, `mobile-390__wallet.png`, `vide__chat.png`, `vide__friends.png`, `vide__home.png`, `vide__notifications.png`, `vide__tournament.png`, `vide__wallet.png`, `_graphify_ver.txt`
**Modifiés :** `009_pion_style.sql`, `_probe_boutique_v1.js`, `_upd.txt`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`
**Ajoutés :** `avatar_26_1790498412041.jpg`, `avatar_31_1790498197871.png`, `_ctx2.txt`, `_ctx3.txt`, `_fresh.txt`, `_gf.txt`, `_mig.txt`, `_mig2.txt`, `_mig3.txt`, `_migjs.txt`, `_pb.txt`, `_pb2.txt`, `_pbtail.txt`, `_ts.txt`, `_tus.txt`, `_upd2.txt`, `f56bd636274a515ae9d49c4bb2ab416ff4af10b9aea10b682a22863bc75e1f0c.json`
**Modifiés :** `index.html`, `MANIFEST.txt`, `db.js`, `server.js`, `_dbg_elo.js`, `_inline.js`, `_layout_fill.js`, `_layout_fill_report.txt`, `_probe_profil_v3.js`, `_revue_ui.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `desktop-jour__chat.png`, `desktop-jour__friends.png`, `desktop-jour__home.png`, `desktop-jour__match.png`, `desktop-jour__notifications.png`, `desktop-jour__play.png`, `desktop-jour__profile.png`, `desktop-jour__ranks.png`, `desktop-jour__skins.png`, `desktop-jour__wallet.png`, `desktop-nuit__home.png`, `mobile-390__profile.png`, `graph.html`, `desktop-1440x900-home.png`, `desktop-1440x900-match-tournois.png`, `desktop-1440x900-match.png`, `desktop-1440x900-ranks.png`, `desktop-1440x900-wallet.png`, `mobile-360x760-home.png`, `mobile-360x760-match.png`, `mobile-390x844-home.png`, `mobile-390x844-match.png`, `match-defis-jour.png`, `match-live-jour.png`, `match-live-nuit.png`, `match-tournois-jour.png`, `match-tournois-nuit.png`, `captures.md`, `desktop-jour__plateau-ia-coups.png`, `desktop-jour__plateau-ia.png`, `desktop-jour__plateau-tirage.png`, `desktop-jour__tournament.png`, `desktop-nuit__chat.png`, `desktop-nuit__friends.png`, `desktop-nuit__match.png`, `desktop-nuit__notifications.png`, `desktop-nuit__plateau-ia-coups.png`, `desktop-nuit__plateau-ia.png`, `desktop-nuit__plateau-tirage.png`, `desktop-nuit__play.png`, `desktop-nuit__profile.png`, `desktop-nuit__ranks.png`, `desktop-nuit__skins.png`, `desktop-nuit__tournament.png`, `desktop-nuit__wallet.png`, `etat__match-defis.png`, `etat__match-tournois.png`, `etat__profil-public.png`, `etat__ranks-province.png`, `etat__tournoi-detail.png`, `etat__wallet-depot.png`, `etat__wallet-retrait.png`, `mesures.json`, `mesures.txt`, `mobile-360__home.png`, `mobile-360__match.png`, `mobile-360__profile.png`, `mobile-360__tournament.png`, `mobile-390__chat.png`, `mobile-390__friends.png`, `mobile-390__home.png`, `mobile-390__match.png`, `mobile-390__notifications.png`, `mobile-390__plateau-ia-coups.png`, `mobile-390__plateau-ia.png`, `mobile-390__plateau-tirage.png`, `mobile-390__play.png`, `mobile-390__ranks.png`, `mobile-390__skins.png`, `mobile-390__tournament.png`, `mobile-390__wallet.png`, `vide__chat.png`, `vide__friends.png`, `vide__home.png`, `vide__notifications.png`, `vide__tournament.png`, `vide__wallet.png`
**Ajoutés :** `yas-nperf-2025.svg`, `yas-nperf-2025.webp`, `avatar_30_1790532237589.jpg`, `avatar_31_1790531916542.png`, `avatar_35_1790532513497.png`, `avatar_30_1790532709788.jpg`, `avatar_31_1790536319836.jpg`, `avatar_31_1790537290197.jpg`, `avatar_31_1790547485092.jpg`, `avatar_31_1790548434207.jpg`, `avatar_36_1790536100154.png`, `_apercu_pub.js`, `_audit_compare.js`, `_audit_responsive.js`, `_backfill_elo.js`, `_check_elo_reel.js`, `_diag_svg.js`, `_inspect_compte.js`, `_inspect_stats.js`, `_probe_elo_stats.js`, `_probe_formes.js`, `_seed_parties_elo.js`, `_seed_parties_manifest.json`, `_shapes_apply.js`, `_shape_scan.js`, `_sync_compteurs.js`, `_v_cont.err.txt`, `_v_cont.txt`, `_v_elo.err.txt`, `_v_elo.txt`, `_v_formes.err.txt`, `_v_formes.txt`, `_v_ovf.err.txt`, `_v_ovf.txt`, `_v_pv3.err.txt`, `_v_pv3.txt`, `_v_tus.err.txt`, `_v_tus.txt`, `apres__1440__home.png`, `apres__1440__match.png`, `apres__1440__ranks.png`, `apres__1440__wallet.png`, `apres__1920__home.png`, `apres__1920__match.png`, `apres__1920__ranks.png`, `apres__1920__wallet.png`, `apres__360__home.png`, `apres__360__match.png`, `apres__360__ranks.png`, `apres__360__wallet.png`, `apres__768__home.png`, `apres__768__match.png`, `apres__768__ranks.png`, `apres__768__wallet.png`, `avant__1440__home.png`, `avant__1440__match.png`, `avant__1440__ranks.png`, `avant__1440__wallet.png`, `avant__1920__home.png`, `avant__1920__match.png`, `avant__1920__ranks.png`, `avant__1920__wallet.png`, `avant__360__home.png`, `avant__360__match.png`, `avant__360__ranks.png`, `avant__360__wallet.png`, `avant__768__home.png`, `avant__768__match.png`, `avant__768__ranks.png`, `avant__768__wallet.png`, `err-apres.txt`, `err.txt`, `layout-fill-err.txt`, `layout-fill.txt`, `layout-fill2-err.txt`, `layout-fill2.txt`, `mesures-apres.json`, `mesures-avant.json`, `pid-fill.txt`, `pid-revue.txt`, `pid.txt`, `rapport-apres.md`, `rapport-avant.md`, `revue-ui-err.txt`, `revue-ui.txt`, `sortie-apres.txt`, `sortie.txt`, `0fc77c369f78917358e79c7a9077a887751738a0a70855f15cd65e4c38effd61.json`, `2fe73ad56d1e049e00ef54904b1fa9299b33b84d311589981354393cc0484a45.json`, `6d9b6bea1333c10ce92d86a45b4e45c310ec5f6e60443494290a2d74dcce39b0.json`, `a7c45da60b9429560a8172f025245cc1052016406b53df2d604e9021406c32ed.json`, `checkhtml.err`, `courbe-elo-jour.png`, `courbe-elo-nuit.png`, `profil-statistiques.png`, `reel-courbe-jour.png`, `reel-courbe-nuit.png`, `apercu-pid.txt`, `apercu.err`, `officiel.webp`, `probe-apres.txt`, `probe-err.txt`, `probe-pid.txt`, `probe.err`, `probe.txt`, `pub__colonnes.png`, `pub__mobile.png`, `pub__nuit.png`, `rapport.md`, `revue-pid.txt`, `revue-ui-apres.txt`, `revue.err`, `revue2-pid.txt`, `revue2.err`, `mobile-390__profile-pleine-page.png`
**Supprimés :** `_chk_html.txt`, `_ctx2.txt`, `_ctx3.txt`, `_fresh.txt`, `_gf.txt`, `_mig.txt`, `_mig2.txt`, `_mig3.txt`, `_migjs.txt`, `_pb.txt`, `_pb2.txt`, `_pbtail.txt`, `_ts.txt`, `_tus.txt`, `_upd.txt`, `_upd2.txt`

## 2026-09-26
**Modifiés :** `AGENTS.md`, `index.html`, `data.js`, `_check_html.js`, `_inline.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`
**Ajoutés :** `avatar_26_1790191194041.jpg`, `avatar_26_1790193152297.jpg`, `avatar_26_1790194162932.jpg`, `avatar_26_1790194505891.jpg`, `avatar_26_1790195324652.jpg`, `avatar_26_1790196065263.jpg`, `avatar_26_1790203806407.jpg`, `avatar_26_1790205003257.jpg`, `avatar_26_1790206124657.jpg`, `avatar_26_1790206880721.jpg`, `avatar_26_1790208858295.jpg`, `avatar_26_1790210048645.jpg`, `avatar_26_1790212242059.jpg`, `avatar_31_1790208938133.png`, `avatar_31_1790210381261.png`, `_revue_ui.js`, `_s1_analyse.js`, `_s1_compare.js`, `_s2_scope.js`, `_s3_grep.js`, `_s4_cibles.js`, `_s4_pop.js`, `_s5_inv.js`, `_s5_libelles.js`, `_s5_prd.js`, `_s5_seg.js`, `_s5_verif.js`, `_s6_probe.js`, `_s6_scope.js`, `_s6_verif.js`, `_s7_fin.js`, `_s7_probe.js`, `_s7_releve.txt`, `_s8_verif.js`, `_s8_verif.txt`, `17baaec037cd45999fd410444fe5264748b9fe98dbed1815e009e91861fd9251.json`, `20e517f9045d1f96abecda071e51a230aca0bf016561b99a311986bf44a7f8c8.json`, `2ba3cbcf911b2a4f67cbecc52d5a9c12d20eb3ae17f2778dbcb8c95e7f29d941.json`, `32f8b5cb637ffc83321967bf0e2c678b76623423e0410f470c95710bea25c1a4.json`, `4d1845fab5ae80feab6fb2afa6a05866ad1e8a6207e8ee13f60fdd84eff4e229.json`, `4e72caa656b3b41bac31bc6b051911f8ef3090d9e4775a26ae6786be9aba5bee.json`, `52139523403f961047aebe681ab78a0092b46ef82b449ba0571e01266036bb5e.json`, `5d9c07f9b35ca30b3c7b62652cfd01536b0bdb7cbf84561097277a0487ae89f1.json`, `5dcd0b6456e1c6c833f2d7afcf32eda3ba6cb99e4c90aacdced328fb49ab2e9e.json`, `5f9b5a8a07fcafa1e4b5a9f81d54c2056995274d356689dfe7fe0eed209136ba.json`, `612ce16aeb084fa74efa8781e38f8e854083f829ed490af07df96bd6b72e2967.json`, `62393fb10c317e6e09e45b13f3ff63621841620e4e41c25f168a9e4c68d8272c.json`, `91bf00a067676c6f888c487750494296d9102fcd20e74acb4b1de044eda5d84d.json`, `941add216324961a68471e351a654293544a4c871995ea5c54b92434bf53f724.json`, `9719733f51d8a3a992c92da9e3a2ac7ee739a4482ae97fe5914f1fb80a89f58e.json`, `a6a33064a7e05c3c96d1a140a54460b04c436e26c5e60af83bdbc4b4ec9b9b86.json`, `bb0dc647f388ebb9bab4b0048a8456d0790450a82e93946cf919dcce661de044.json`, `bd07530e777d16453771466cd03b18e7e4320c4411a1a5a15d57072e3ce585dc.json`, `bd098e0a3575cd103067ef514a518524d0f96f7d4182a78f38f3a4f28a411217.json`, `c2d577bba0e5059adddf0771db321044d494e7429cafc0b9ad693551a105c67a.json`, `d3330a50567f551924ca7b007acde913fd9bf959cd3ac39bc1db939990d209a7.json`, `d3336ed38caf88c95e483bcbe7214de431ae1b2eb4c855cef0ce19dcd5796b6c.json`, `d78735e8104e0c433fd48b309a9fac95038076991dcad4638a3a640f2b7a35a5.json`, `d931d11dacf9d460547436ba363337a7e8dfc0f175e4241393786c024a77f1cd.json`, `db8bda2b16cb17abeb4481439070c005ed735ff34a85fe5e80236ff9e80d8f06.json`, `def9ff6487f2ee1ba7c49c120247c98c7a8842c2a5feff002c221fad16883854.json`, `f52698b51834ff77efc0fdbc17eef36ea0686d50c662089b92b8e327bae6d810.json`, `REVUE_UI_UX.md`
**Supprimés :** `_e.txt`, `_s1.txt`
**Modifiés :** `index.html`, `_inline.js`, `_layout_fill_report.txt`, `desktop-1440x900-home.png`, `desktop-1440x900-match-tournois.png`, `desktop-1440x900-match.png`, `desktop-1440x900-ranks.png`, `desktop-1440x900-wallet.png`, `mobile-360x760-home.png`, `mobile-360x760-match.png`, `mobile-390x844-home.png`, `mobile-390x844-match.png`
**Ajoutés :** `avatar_26_1790409808937.jpg`, `avatar_26_1790410562555.jpg`, `_dbg_elo.js`, `_dbg_wallet.js`, `_probe_profil_v3.js`, `_shots_profil_v3.js`
**Modifiés :** `index.html`, `_inline.js`, `_probe_profil_v3.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`
**Ajoutés :** `avatar_26_1790413136210.jpg`, `avatar_26_1790413438849.jpg`, `avatar_26_1790415169809.jpg`, `0f76b9824ad97ac7994eb514281bb5f3cb6a62360966301771e463ea96bc6c1c.json`
**Modifiés :** `index.html`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`
**Ajoutés :** `avatar_26_1790416567711.jpg`, `avatar_26_1790416848771.jpg`, `74e65a1c55250d63ca2a9a8568178e87d7adaa0410997ee4a3ac67c6300bd37c.json`

## 2026-09-23
**Modifiés :** `.gitattributes`, `.gitignore`, `AGENTS.md`, `plateau_clean.png`, `plateau_exact.svg`, `index.html`, `README.md`, `check_db.js`, `CONFIGURER.bat`, `data.js`, `db.js`, `DEMARRER.bat`, `diag.js`, `game.js`, `HOTSPOT.bat`, `HOTSPOT.ps1`, `LIEN_REMOTE.bat`, `package-lock.json`, `package.json`, `reset_test_tournament.js`, `server.js`, `setup_firewall.ps1`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `last_query_stamp`, `stat-index.json`, `graph.html`, `GUIDE_LIEN_REMOTE.md`, `maj_journal.bat`, `planif_quotidienne.bat`, `skills-lock.json`



**Ajoutés :** `.env.example`, `auth.js`, `MANIFEST.txt`, `avatar_31_1789326899138.jpg`, `avatar_31_1789326977175.jpg`, `avatar_13_1790018982739.jpg`, `avatar_13_1790019064819.jpg`, `avatar_18_1790029384957.jpg`, `avatar_18_1790029565298.jpg`, `avatar_18_1790029675043.jpg`, `avatar_18_1790030025687.jpg`, `avatar_18_1790030506385.jpg`, `avatar_18_1790030690444.jpg`, `avatar_18_1790030895424.jpg`, `avatar_18_1790031022001.jpg`, `avatar_18_1790031180125.jpg`, `avatar_18_1790031396278.jpg`, `avatar_18_1790031570924.jpg`, `avatar_18_1790031771825.jpg`, `avatar_18_1790031942738.jpg`, `avatar_18_1790032154284.jpg`, `avatar_18_1790032325420.jpg`, `avatar_18_1790032500339.jpg`, `avatar_18_1790032672373.jpg`, `avatar_18_1790041199444.jpg`, `avatar_18_1790041347691.jpg`, `avatar_18_1790041660493.jpg`, `avatar_18_1790041994302.jpg`, `avatar_18_1790042327782.jpg`, `avatar_23_1790029136120.png`, `avatar_23_1790029175652.png`, `avatar_23_1790041435730.png`, `avatar_23_1790041926890.png`, `avatar_23_1790041948706.png`, `backup_db.js`, `check_wallet.js`, `demo_live.js`, `demo_seed.js`, `migrate.js`, `001_auth_credentials.sql`, `002_sessions.sql`, `003_auth_audit.sql`, `004_unique_contact.sql`, `005_skins_foreign_keys.sql`, `006_game_elo_snapshot.sql`, `007_friends_seen.sql`, `008_skins_pions_type.sql`, `reset_password.js`, `SECURITE_AUTH.md`, `test_auth.js`, `test_scenarios.js`, `test_ui_scenarios.fixed.js`, `test_ui_scenarios.js`, `avatar_22_1790131065273.jpg`, `avatar_26_1790131488290.jpg`, `avatar_27_1790130353018.png`, `wipe_db.js`, `_ai_elo.js`, `_back2sum.txt`, `_bounds.txt`, `_build.js`, `_c1.txt`, `_c10.txt`, `_c11.txt`, `_c12.txt`, `_c13.txt`, `_c14.txt`, `_c2.txt`, `_c3.txt`, `_c4.txt`, `_c5.txt`, `_c6.txt`, `_c7.txt`, `_c8.txt`, `_c9.txt`, `_carte.txt`, `_check_html.js`, `_check_match.js`, `_chk.txt`, `_cline_pid.txt`, `_cols.js`, `_contraste.js`, `_data_probe.js`, `_e.txt`, `_ev.txt`, `_exports.txt`, `_f.js`, `_fe.txt`, `_fe2.txt`, `_fe3.txt`, `_g1.txt`, `_g2.txt`, `_inline.js`, `_ins.js`, `_ip.js`, `_layout_fill.js`, `_layout_fill_report.txt`, `_livecheck.js`, `_map3.txt`, `_mapA.txt`, `_mods.txt`, `_notifs.txt`, `_p1.js`, `_p10.js`, `_p11.js`, `_p12.js`, `_p13.js`, `_p14.js`, `_p2.js`, `_p3.js`, `_p4.js`, `_p5.js`, `_p6.js`, `_p7.js`, `_p8.js`, `_p9.js`, `_pc.js`, `_pm.js`, `_prag.txt`, `_probe.js`, `_probe2.err`, `_pubtest.js`, `_pv.txt`, `_pwcheck.txt`, `_repair.js`, `_req.txt`, `_s1.txt`, `_sel1.txt`, `_sel2.txt`, `_sessions_grep.txt`, `_snip.txt`, `_splice.js`, `_struct.js`, `_structure.txt`, `_tail2.txt`, `_tap2.txt`, `_tap3.txt`, `_token.js`, `_tour.js`, `_tour.txt`, `_ui_map.js`, `_ui_map.txt`, `_ui_range.js`, `_ui_range.txt`, `_ui_range2.js`, `_ui_range2.txt`, `_ui_range3.js`, `_ui_range3.txt`, `_ui_recon.js`, `_ui_run.txt`, `_ui_zone.js`, `_ui_zone.txt`, `_verif.txt`, `_ws.js`, `_ws_probe.js`, `_z.txt`, `_z1.txt`, `_z2.txt`, `_z3.txt`, `_z4.txt`, `_zoneA.txt`, `0d823bce59fba23098f1ea7bad9326c1013ac75226882863c7e7f127c4d046b6.json`, `22b4500deb1bc3d1a284e27beef69386dccc6e489b5c0c063651347a8e2bd077.json`, `32634dddcba47f8cfd88ec81837ba46f7837b8c9eec3a43bfcbf0f6a7479f7c2.json`, `3c676e27d7010b2317f6172aea57673bca32e97bf91de28b264f94ca892f8745.json`, `3ea7a88dfd8bb39fdb25d9a1dd82f634ebd7d6262d2523a3c28fdf74f744f431.json`, `402be056b6bda628f73f4caac74afac37383ae72d8c0745d5d72dd1e6068530e.json`, `53556cd2283ccd6909f577c92dfe2de6cb228db50847a04ec00e91261f78cd8c.json`, `59f225baca4fee36f09ea2aaffed99992fd6c98340805985e5168488f7a94afb.json`, `5b5d50716fa3f805c4074f6363394791fe306c7a15ac652528f26064fe3abb73.json`, `6987557aa8862692c89be06014116d5ed19d3d12bd3a27898f546d73880fd7e2.json`, `6e4983cf0821565bac6b233c1d7cbac9c6917ef1144a4327dd5d328cca199d64.json`, `6edb6b4b58345f1c5b7efba49592f7544488deefd5249e788171d9591fb2f88b.json`, `8246268f7b4f0557edccc48040b58d563cd2a6451f92d4d1ca66b934b4d88189.json`, `86192a71cc954947b10d6cc7e11f34e070019e76db8de7db63112ba00aaf756f.json`, `8f284280b48ac997bb3c78f4743b0da059c8f1eea23c77601db460e9e775f599.json`, `96b7c17bf24becf864b303217d936c49ffcd89c115643d0b1663556924dfdd54.json`, `983cdd0989465381cedd0a688bbe19856fe10becd0f620afe0c194e07f3131ac.json`, `a09d2ee84794445a84a40e24230806534a53e6dbcae0ef34ff8ab9819b05b0f2.json`, `a20169bd512888bbacc50d0504df643aebf6c14ae5df328ab7515bfb630d68b3.json`, `a7790dbfea9b49809b826233b60341e697d111094ba32f5d55bc05442ed9c742.json`, `aad28a0f1304273638bc8bf2dbed924ac78cc2af73391bd43d33221431dcfe9c.json`, `bc0fd73256433518fef012f74dfbaa457fd175ab7b19206f9d8c4b8c3b6ce50a.json`, `c4fe18f2662e6beb218549f33cb723dc986d6de07342d5a700690afc52e9d359.json`, `c82a99e5fee56ffdd809bc75ddcb6797125207a18c49f35606b79556dd44c30f.json`, `cbeea0ee16bf57ed8c2da92dad0cb0d9987ddb1423f92077300d208245aee8f9.json`, `d5e50929bec982dcdd855899f54bb338c61c64f083f9158700158aa8f4b75632.json`, `e58512e067fb5b89ce784a363876feabd189e2cd1016dc4969e5dbca50ef1a28.json`, `edf106d2a2883b7bec1e9fd33f59fe3c9b6ed20d0aa328981a2e04547c45a85b.json`, `f3f842472ea184f069b10079e3e16dc178d4ffd98f3228b655006a431773ceda.json`, `fb8dade669eb5a768ca46dbb8dd4e47986956304a2fe2e2a13ebf3a9996822c4.json`, `match-demo-defis-2026-09-19.png`, `match-demo-live-2026-09-19.png`, `match-demo-mobile-2026-09-19.png`, `match-demo-nuit-2026-09-19.png`, `match-demo-tournois-2026-09-19.png`, `desktop-1440x900-home.png`, `desktop-1440x900-match-tournois.png`, `desktop-1440x900-match.png`, `desktop-1440x900-ranks.png`, `desktop-1440x900-wallet.png`, `mobile-360x760-home.png`, `mobile-360x760-match.png`, `mobile-390x844-home.png`, `mobile-390x844-match.png`, `match-defis-jour.png`, `match-defis-nuit.png`, `match-live-jour.png`, `match-live-mobile.png`, `match-live-nuit.png`, `match-tournois-jour.png`, `match-tournois-mobile.png`, `match-tournois-nuit.png`
**Modifiés :** `index.html`, `test_ui_scenarios.js`, `_inline.js`, `_p10.js`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `stat-index.json`, `graph.html`
**Ajoutés :** `avatar_26_1790132810523.jpg`, `ad1966b798b6dcb83181950ed045e83591280355584ea76e8ff77314eb39f4cd.json`, `e4bb738c8c35c29603ed9ef842a884d947a6740c64f9e4efb0d95ffff99655d1.json`

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
